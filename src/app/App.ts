import * as THREE from 'three';
import { DEFAULT_PARAMS, SOURCE_LABELS, type Params } from '../config';
import type { Heightmap } from '../geo/heightmap';
import { loadTerrainAt } from '../geo/load';
import { geocode, type GeocodeResult } from '../geo/geocode';
import { fetchSatellite } from '../geo/satelliteTiles';
import { readUrlState, writeUrlState, parseCoords, formatCoords } from '../url';
import { detectIpLocation } from '../geo/ipLocation';
import {
  t, setLanguage, getLanguage, hasExplicitLanguage, resolveSmartLanguage, type Lang,
} from '../i18n';
import { localMetersToLonLat, lonLatToLocalMeters } from '../geo/projection';
import { POINTS_OF_INTEREST } from '../geo/places';
import { buildSurface, computeSurfaceFields, type SurfaceResult } from '../geo/surface';
import { trackEvent } from '../analytics';
import { stormIntensityMmHr } from '../sim/storm';
import { FloodSimulation } from '../sim/FloodSimulation';
import { Rain } from '../render/Rain';
import { createPin } from '../render/PlaceMarker';
import { SceneManager } from '../render/SceneManager';
import { TerrainMesh } from '../render/TerrainMesh';
import { WaterMesh } from '../render/WaterMesh';
import { MaxFloodOverlay, VelocityField } from '../render/overlays';
import { AddressBar } from '../ui/AddressBar';
import { LanguagePicker } from '../ui/LanguagePicker';
import { ControlsPanel, type ControlCallbacks } from '../ui/ControlsPanel';
import { INITIAL_STATS, formatDuration, formatVolume, type StatsData } from '../ui/stats';
import { showToast } from '../ui/toast';

const MAX_STEPS_PER_FRAME = 48;
const READBACK_INTERVAL = 0.4; // seconds (wall clock)

export class App {
  private readonly params: Params = { ...DEFAULT_PARAMS };
  private readonly stats: StatsData = { ...INITIAL_STATS };
  private readonly scene: SceneManager;
  private readonly group = new THREE.Group();
  private readonly addressBar: AddressBar;
  private readonly languagePicker: LanguagePicker;
  private panel: ControlsPanel;
  private currentLocation?: GeocodeResult;

  private terrain?: TerrainMesh;
  private water?: WaterMesh;
  private maxFlood?: MaxFloodOverlay;
  private velocity?: VelocityField;
  private rain?: Rain;
  private sim?: FloodSimulation;
  private heightmap?: Heightmap;
  private surfaceTexture?: THREE.DataTexture;
  private surfaceRaw?: Pick<SurfaceResult, 'land' | 'osm'>;
  private readback?: Float32Array;

  private waterStored = 0;
  private markers: Array<{
    object: THREE.Group | null;
    head: THREE.Mesh | null;
    label: HTMLDivElement;
    name: string;
    worldFallback: THREE.Vector3;
  }> = [];
  private readonly tmpVec = new THREE.Vector3();
  private readonly readout = document.getElementById('readout') as HTMLDivElement | null;
  private readonly legend = document.getElementById('legend') as HTMLDivElement | null;
  private readonly legendMin = document.getElementById('legend-min');
  private readonly legendMax = document.getElementById('legend-max');
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private pointerInside = false;
  private pointerClientX = 0;
  private pointerClientY = 0;
  private sinceRaycast = 0;

  private simTimeSec = 0;
  private rainedVolume = 0;
  private observedMaxDepth = 1;
  private sinceReadback = 0;
  private fpsEma = 60;
  private lastTime = 0;
  private loading = false;
  private buildToken = 0;
  private readonly credit = document.getElementById('credit');

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new SceneManager(canvas);
    this.scene.scene.add(this.group);

    const url = readUrlState();
    if (url.km) this.params.mapSizeKm = url.km;

    this.addressBar = new AddressBar({
      onSubmit: (text) => this.loadAddress(text),
      onSelect: (lat, lon, label) => this.loadCenter({ lat, lon, displayName: label }),
    });
    this.languagePicker = new LanguagePicker((lang) => this.setLang(lang));
    // The input is filled only once we know what we're loading (after IP detect
    // / geocode), so a default place never flashes for out-of-region visitors.

    this.panel = new ControlsPanel(this.params, this.stats, this.panelCallbacks());

    const dom = this.scene.renderer.domElement;
    dom.addEventListener('pointermove', (e) => {
      const rect = dom.getBoundingClientRect();
      this.pointerNdc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      this.pointerClientX = e.clientX;
      this.pointerClientY = e.clientY;
      this.pointerInside = true;
    });
    dom.addEventListener('pointerleave', () => {
      this.pointerInside = false;
      if (this.readout) this.readout.style.display = 'none';
    });
  }

  start(): void {
    this.lastTime = performance.now();
    void this.bootstrapLocation();
    requestAnimationFrame(this.loop);
  }

  /**
   * Decide the initial center and UI language. Explicit URL state wins; whatever
   * the URL leaves open is filled in from a coarse IP lookup (location + a
   * smart default language), falling back to the built-in default location.
   */
  private async bootstrapLocation(): Promise<void> {
    const url = readUrlState();
    const haveUrlCenter = url.lat !== undefined && url.lon !== undefined;
    const langPinned = hasExplicitLanguage();

    const needIp = !(haveUrlCenter && langPinned);
    if (needIp && !haveUrlCenter) showToast(t('toast.detecting'), false, 0);
    const ip = needIp ? await detectIpLocation() : null;

    if (!langPinned) {
      const smart = resolveSmartLanguage(ip);
      if (smart !== getLanguage()) this.applyDetectedLanguage(smart);
    }

    if (haveUrlCenter) {
      await this.loadCenter({ lat: url.lat!, lon: url.lon!, displayName: formatCoords(url.lat!, url.lon!) });
    } else if (ip) {
      const displayName = ip.city
        ? [ip.city, ip.region].filter(Boolean).join(', ')
        : formatCoords(ip.lat, ip.lon);
      await this.loadCenter({ lat: ip.lat, lon: ip.lon, displayName });
    } else {
      await this.loadAddress(this.params.address);
    }
  }

  private panelCallbacks(): ControlCallbacks {
    return {
      onParamChange: () => this.applyParams(),
      onRebuild: () => this.reloadCurrent(),
      onReset: () => this.resetSim(),
      onStep: () => this.stepOnce(),
      onTogglePlay: () => {
        this.params.running = !this.params.running;
      },
      onDump: () => {
        this.sim?.requestInject(this.params.releaseDepthM);
        this.params.raining = false; // watch it flow & drain, not rain
        this.params.running = true;
        this.applyParams();
        this.panel.refresh();
      },
      onFill: () => {
        if (!this.sim || !this.heightmap) return;
        this.sim.requestFill(this.heightmap.min + this.params.fillLevelM);
        this.params.raining = false;
        this.params.running = true;
        this.applyParams();
        this.panel.refresh();
      },
    };
  }

  private setLang(lang: Lang): void {
    setLanguage(lang); // explicit user choice → persisted
    writeUrlState({ lang });
    this.rebuildForLanguage();
  }

  private applyDetectedLanguage(lang: Lang): void {
    setLanguage(lang, false); // auto-detected → stays re-detectable on next visit
    this.rebuildForLanguage();
  }

  private rebuildForLanguage(): void {
    this.addressBar.retranslate();
    this.languagePicker.retranslate();
    document.documentElement.lang = getLanguage();
    this.panel.dispose();
    this.panel = new ControlsPanel(this.params, this.stats, this.panelCallbacks());
    this.applyParams(); // re-translate legend labels etc.
  }

  private reloadCurrent(): void {
    if (this.currentLocation) this.loadCenter(this.currentLocation);
  }

  private async loadAddress(text: string): Promise<void> {
    if (this.loading) return;
    const coords = parseCoords(text);
    if (coords) {
      await this.loadCenter({ lat: coords.lat, lon: coords.lon, displayName: formatCoords(coords.lat, coords.lon) });
      return;
    }
    this.loading = true;
    this.addressBar.setBusy(true);
    let location: GeocodeResult | null = null;
    try {
      location = await geocode(text);
    } catch (err) {
      showToast((err as Error).message, true);
    }
    this.loading = false;
    this.addressBar.setBusy(false);
    if (location) await this.loadCenter(location);
  }

  /** Build the terrain + surface + sim for an already-resolved center. */
  private async loadCenter(location: GeocodeResult): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.currentLocation = location;
    this.addressBar.setBusy(true);
    const place = location.displayName.split(',')[0];
    showToast(t('toast.loadingPlace', { q: place }), false, 0);
    try {
      const N = this.params.gridResolution;
      const { heightmap, warning, sourceUsed } = await loadTerrainAt(
        location, this.params.mapSizeKm, N, this.params.elevationSource,
      );

      let surface: SurfaceResult | null = null;
      if (this.params.useSurface) {
        showToast(t('toast.loadingSurface'), false, 0);
        surface = await buildSurface(heightmap, this.params); // burns buildings/roads into the DEM
      }

      this.build(heightmap, surface);
      this.stats.location = location.displayName.split(',').slice(0, 3).join(',');
      writeUrlState({ lat: location.lat, lon: location.lon, km: this.params.mapSizeKm });
      this.addressBar.setValue(this.displayLabel(location));
      this.panel.refresh();
      const surfNote = surface ? ` · ${surface.counts.buildings} bld / ${surface.counts.roads} roads` : '';
      showToast(
        warning ?? `${t('toast.loaded', { place })} — ${heightmap.min.toFixed(0)}–${heightmap.max.toFixed(0)} m (${SOURCE_LABELS[sourceUsed]})${surfNote}`,
        !!warning,
      );
      trackEvent('location_loaded', { place, source: sourceUsed, size_km: this.params.mapSizeKm });
    } catch (err) {
      showToast((err as Error).message, true);
    } finally {
      this.loading = false;
      this.addressBar.setBusy(false);
    }
  }

  private displayLabel(location: GeocodeResult): string {
    if (parseCoords(location.displayName)) return location.displayName;
    return location.displayName.split(',').slice(0, 2).map((s) => s.trim()).join(', ');
  }

  private build(heightmap: Heightmap, surface: SurfaceResult | null): void {
    this.disposeWorld();
    this.heightmap = heightmap;
    this.buildToken++;
    const N = heightmap.N;

    if (surface) {
      this.surfaceRaw = { land: surface.land, osm: surface.osm };
      this.surfaceTexture = new THREE.DataTexture(surface.surface, N, N, THREE.RGBAFormat, THREE.FloatType);
      this.surfaceTexture.minFilter = THREE.NearestFilter;
      this.surfaceTexture.magFilter = THREE.NearestFilter;
      this.surfaceTexture.needsUpdate = true;
    }

    this.terrain = new TerrainMesh(heightmap, this.params.wireframe);
    this.sim = new FloodSimulation(
      this.scene.renderer,
      this.terrain.heightTexture,
      N,
      heightmap.sizeMeters,
      this.params,
    );
    this.sim.setSurface(this.params.useSurface && this.surfaceTexture ? this.surfaceTexture : null);
    if (surface) this.terrain.setSurfaceColors(surface.surface, N);
    this.water = new WaterMesh(this.terrain.geometry, this.params);
    this.maxFlood = new MaxFloodOverlay(this.terrain.geometry);
    this.velocity = new VelocityField(heightmap.sizeMeters, this.terrain.heightTexture);
    this.rain = new Rain(heightmap);
    this.readback = new Float32Array(N * N * 4);

    this.group.add(
      this.terrain.mesh, this.water.mesh, this.maxFlood.mesh, this.velocity.mesh, this.rain.object,
    );
    this.buildMarkers(heightmap);

    this.simTimeSec = 0;
    this.rainedVolume = 0;
    this.observedMaxDepth = 1;

    this.applyParams();
    const midHeight = ((heightmap.min + heightmap.max) / 2) * this.params.verticalExaggeration;
    this.scene.fitToTerrain(heightmap.sizeMeters, midHeight);
    this.loadSatellite(this.buildToken, heightmap);
  }

  private loadSatellite(token: number, hm: Heightmap): void {
    fetchSatellite(hm.center, hm.sizeMeters, hm.N)
      .then(({ texture, uvSat }) => {
        if (token !== this.buildToken || !this.terrain) {
          texture.dispose();
          return;
        }
        this.terrain.setSatellite(texture, uvSat);
        this.applyParams();
      })
      .catch((err) => {
        if (token !== this.buildToken) return;
        if (this.params.terrainStyle === 'satellite') {
          showToast(`Satellite imagery unavailable (${(err as Error).message}). Showing elevation tint.`, true);
        }
      });
  }

  private applyParams(): void {
    this.group.scale.y = this.params.verticalExaggeration;
    this.sim?.updateParams(this.params);
    this.refreshSurface();
    this.water?.update(this.params);
    this.terrain?.setWireframe(this.params.wireframe);
    this.terrain?.applyStyle(this.params.terrainStyle);
    this.terrain?.updateWater(this.params.depthColorMax, this.params.imageryDarkening);
    this.scene.setStorm(this.params.storm);
    if (this.maxFlood) this.maxFlood.mesh.visible = this.params.showMaxFlood;
    if (this.velocity) this.velocity.mesh.visible = this.params.showVelocity;
    if (this.credit) {
      const showing = this.params.terrainStyle === 'satellite' && !!this.terrain?.hasSatellite;
      this.credit.style.display = showing ? 'block' : 'none';
    }
    if (this.legend) {
      const heat = this.params.terrainStyle === 'heatmap' && !!this.heightmap;
      this.legend.style.display = heat ? 'block' : 'none';
      if (heat && this.heightmap) {
        const title = this.legend.querySelector('.title');
        if (title) title.textContent = t('legend.elevation');
        if (this.legendMin) this.legendMin.textContent = `${this.heightmap.min.toFixed(0)} m`;
        if (this.legendMax) this.legendMax.textContent = `${this.heightmap.max.toFixed(0)} m`;
      }
    }
  }

  /** Recompute the per-cell drainage/infiltration/roughness fields live (no re-fetch). */
  private refreshSurface(): void {
    if (!this.sim) return;
    if (this.params.useSurface && this.surfaceRaw && this.surfaceTexture && this.heightmap) {
      const data = computeSurfaceFields(this.heightmap, this.surfaceRaw.land, this.surfaceRaw.osm, this.params);
      (this.surfaceTexture.image.data as Float32Array).set(data);
      this.surfaceTexture.needsUpdate = true;
      this.sim.setSurface(this.surfaceTexture);
      this.terrain?.setSurfaceColors(data, this.heightmap.N);
    } else {
      this.sim.setSurface(null);
    }
  }

  private resetSim(): void {
    this.sim?.reset();
    this.simTimeSec = 0;
    this.rainedVolume = 0;
    this.observedMaxDepth = 1;
  }

  private stepOnce(): void {
    if (!this.sim) return;
    const stepDt = this.params.mapSizeKm * 1000 / this.params.gridResolution * 0.1;
    this.sim.step(stepDt);
    this.simTimeSec += stepDt;
  }

  private advanceSim(dtReal: number): void {
    if (!this.sim) return;
    // Drive rain from the storm hyetograph (peaked залповый ливень) over sim time.
    const intensityMmHr = this.params.raining
      ? stormIntensityMmHr(this.params.stormType, this.simTimeSec, this.params.intensityMmPerHr)
      : 0;
    this.sim.setRainRateMmPerHr(intensityMmHr);

    const g = Math.max(0.1, this.params.gravity);
    const cellSize = this.sim.cellSize;
    const refDepth = Math.max(1, this.observedMaxDepth);
    const cflMax = (0.45 * cellSize) / Math.sqrt(g * refDepth);

    const simSeconds = dtReal * this.params.timeScale;
    const stepDt = Math.min(simSeconds / this.params.substeps, cflMax);
    let remaining = simSeconds;
    let steps = 0;
    while (remaining > 1e-6 && steps < MAX_STEPS_PER_FRAME && stepDt > 0) {
      const dt = Math.min(stepDt, remaining);
      this.sim.step(dt);
      remaining -= dt;
      steps++;
    }
    const simulated = simSeconds - remaining;
    this.simTimeSec += simulated;
    this.rainedVolume += (intensityMmHr / 1000 / 3600) * this.rainArea() * simulated;
  }

  private rainArea(): number {
    const size = this.params.mapSizeKm * 1000;
    if (this.params.rainFootprint === 'uniform') return size * size;
    const frac = Math.min(1, Math.PI * this.params.spotRadius * this.params.spotRadius * 0.5);
    return size * size * frac;
  }

  private syncTextures(): void {
    if (!this.sim) return;
    const depthTex = this.sim.waterTexture;
    this.water?.setDepthTexture(depthTex);
    this.terrain?.setDepthTexture(depthTex);
    this.maxFlood?.setDepthTexture(depthTex);
    this.velocity?.setTextures(depthTex, depthTex);
  }

  private updateStats(): void {
    if (!this.sim || !this.readback || !this.heightmap) return;
    this.sim.readWater(this.readback);
    const N = this.sim.N;
    const cellArea = this.sim.cellSize * this.sim.cellSize;
    let stored = 0;
    let flooded = 0;
    let maxNow = 0;
    let maxEver = 0;
    for (let i = 0; i < N * N; i++) {
      const d = this.readback[i * 4];
      const m = this.readback[i * 4 + 1];
      stored += d;
      if (d > 0.05) flooded++;
      if (d > maxNow) maxNow = d;
      if (m > maxEver) maxEver = m;
    }
    this.observedMaxDepth = Math.max(1, maxEver);
    this.waterStored = stored * cellArea;
    this.stats.simTime = formatDuration(this.simTimeSec);
    this.stats.rained = formatVolume(this.rainedVolume);
    this.stats.stored = formatVolume(stored * cellArea);
    this.stats.floodedArea = `${((flooded / (N * N)) * 100).toFixed(1)} %`;
    this.stats.maxDepth = `${maxNow.toFixed(2)} m (max ${maxEver.toFixed(2)})`;
    this.stats.fps = this.fpsEma.toFixed(0);
    this.panel.refresh();
  }

  private loop = (now: number): void => {
    const dt = Math.min(0.05, (now - this.lastTime) / 1000) || 0;
    this.lastTime = now;
    if (dt > 0) this.fpsEma = this.fpsEma * 0.9 + (1 / dt) * 0.1;

    if (this.sim) {
      if (this.params.floodLevelLive && this.heightmap) {
        this.sim.requestFill(this.heightmap.min + this.params.fillLevelM, true);
        this.sim.step(0); // set water exactly to the level, no dynamics
      } else if (this.params.running) {
        this.advanceSim(dt);
      }
      this.syncTextures();
      this.sinceReadback += dt;
      if (this.sinceReadback >= READBACK_INTERVAL) {
        this.sinceReadback = 0;
        this.updateStats();
      }
    }

    this.rain?.update(this.params, now / 1000);
    this.scene.updateStorm(dt);
    this.updateReadout(dt);
    this.updateDrainArrows();
    this.updateMarkers();
    this.scene.render();
    requestAnimationFrame(this.loop);
  };

  private updateDrainArrows(): void {
    // Auto-reveal flow arrows while draining (rain off) so the water's path shows.
    const draining = this.params.running && !this.params.raining && this.waterStored > 1;
    if (this.velocity) this.velocity.mesh.visible = this.params.showVelocity || draining;
  }

  private buildMarkers(hm: Heightmap): void {
    const half = hm.sizeMeters / 2;
    const midElev = (hm.min + hm.max) / 2;
    for (const poi of POINTS_OF_INTEREST) {
      const [mx, my] = lonLatToLocalMeters(hm.center, poi.lon, poi.lat);
      if (Math.hypot(mx, my) > 25000) continue; // only mark places near this area

      let object: THREE.Group | null = null;
      let head: THREE.Mesh | null = null;
      const inBounds = Math.abs(mx) <= half && Math.abs(my) <= half;
      if (inBounds) {
        const u = mx / hm.sizeMeters + 0.5;
        const v = my / hm.sizeMeters + 0.5;
        const pin = createPin(hm.sizeMeters);
        pin.group.position.set(mx, this.sampleElevation(u, v), -my);
        this.group.add(pin.group);
        object = pin.group;
        head = pin.head;
      }

      const label = document.createElement('div');
      label.className = 'poi-label';
      document.body.appendChild(label);
      this.markers.push({
        object, head, label, name: poi.label,
        worldFallback: new THREE.Vector3(mx, midElev, -my),
      });
    }
  }

  private clearMarkers(): void {
    for (const m of this.markers) {
      if (m.object) {
        this.group.remove(m.object);
        m.object.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          if (mesh.material) (mesh.material as THREE.Material).dispose();
        });
      }
      m.label.remove();
    }
    this.markers = [];
  }

  private updateMarkers(): void {
    if (!this.markers.length) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const arrows = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘'];
    for (const m of this.markers) {
      if (m.head) m.head.getWorldPosition(this.tmpVec);
      else this.tmpVec.copy(m.worldFallback);
      this.tmpVec.project(this.scene.camera);

      const behind = this.tmpVec.z > 1;
      const onScreen =
        !behind && Math.abs(this.tmpVec.x) <= 1 && Math.abs(this.tmpVec.y) <= 1;
      m.label.style.display = 'block';

      if (onScreen) {
        m.label.textContent = m.name;
        m.label.style.transform = 'translate(-50%, -130%)';
        m.label.style.left = `${(this.tmpVec.x * 0.5 + 0.5) * w}px`;
        m.label.style.top = `${(-this.tmpVec.y * 0.5 + 0.5) * h}px`;
      } else {
        let bx = this.tmpVec.x;
        let by = this.tmpVec.y;
        if (behind) { bx = -bx; by = -by; }
        const mag = Math.max(Math.abs(bx), Math.abs(by), 1e-3);
        bx /= mag;
        by /= mag;
        const angle = Math.atan2(by, bx);
        const arrow = arrows[(Math.round(angle / (Math.PI / 4)) + 8) % 8];
        m.label.textContent = `${m.name} ${arrow}`;
        m.label.style.transform = 'translate(-50%, -50%)';
        // keep clear of the address bar (top-left) and the control panel (right).
        m.label.style.left = `${THREE.MathUtils.clamp((bx * 0.5 + 0.5) * w, 20, w - 340)}px`;
        m.label.style.top = `${THREE.MathUtils.clamp((-by * 0.5 + 0.5) * h, 100, h - 40)}px`;
      }
    }
  }

  private updateReadout(dt: number): void {
    if (!this.readout || !this.pointerInside || !this.terrain || !this.heightmap) return;
    this.sinceRaycast += dt;
    if (this.sinceRaycast < 0.1) return;
    this.sinceRaycast = 0;

    this.raycaster.setFromCamera(this.pointerNdc, this.scene.camera);
    const hit = this.raycaster.intersectObject(this.terrain.mesh, false)[0];
    if (!hit) {
      this.readout.style.display = 'none';
      return;
    }
    const size = this.heightmap.sizeMeters;
    const u = THREE.MathUtils.clamp(hit.point.x / size + 0.5, 0, 1);
    const v = THREE.MathUtils.clamp(0.5 - hit.point.z / size, 0, 1);
    const elev = this.sampleElevation(u, v);
    const depth = this.sampleDepth(u, v);
    const [lon, lat] = localMetersToLonLat(this.heightmap.center, hit.point.x, -hit.point.z);

    const water = depth > 0.01 ? `  ·  ${t('readout.water')} ${depth.toFixed(2)} m` : '';
    this.readout.textContent = `${t('readout.elev')} ${elev.toFixed(1)} m${water}  ·  ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    this.readout.style.display = 'block';
    this.readout.style.left = `${this.pointerClientX + 14}px`;
    this.readout.style.top = `${this.pointerClientY + 14}px`;
  }

  private sampleElevation(u: number, v: number): number {
    const hm = this.heightmap!;
    const N = hm.N;
    const fx = u * (N - 1);
    const fy = v * (N - 1);
    const x0 = Math.min(N - 2, Math.floor(fx));
    const y0 = Math.min(N - 2, Math.floor(fy));
    const dx = fx - x0;
    const dy = fy - y0;
    const d = hm.data;
    const at = (x: number, y: number) => d[y * N + x];
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * dx;
    const bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * dx;
    return top + (bot - top) * dy;
  }

  private sampleDepth(u: number, v: number): number {
    if (!this.readback || !this.heightmap) return 0;
    const N = this.heightmap.N;
    const ix = Math.round(u * (N - 1));
    const iy = Math.round(v * (N - 1));
    return this.readback[(iy * N + ix) * 4];
  }

  private disposeWorld(): void {
    this.clearMarkers();
    if (this.terrain) this.group.remove(this.terrain.mesh);
    if (this.water) this.group.remove(this.water.mesh);
    if (this.maxFlood) this.group.remove(this.maxFlood.mesh);
    if (this.velocity) this.group.remove(this.velocity.mesh);
    if (this.rain) this.group.remove(this.rain.object);
    this.sim?.dispose();
    this.water?.dispose();
    this.maxFlood?.dispose();
    this.velocity?.dispose();
    this.rain?.dispose();
    this.terrain?.dispose();
    this.surfaceTexture?.dispose();
    this.sim = undefined;
    this.water = undefined;
    this.maxFlood = undefined;
    this.velocity = undefined;
    this.rain = undefined;
    this.terrain = undefined;
    this.surfaceTexture = undefined;
    this.surfaceRaw = undefined;
  }
}
