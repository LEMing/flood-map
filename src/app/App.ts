import * as THREE from 'three';
import { DEFAULT_PARAMS, GRID_RESOLUTIONS, SOURCE_LABELS, type Params } from '../config';
import type { Heightmap } from '../geo/heightmap';
import { loadTerrainAt } from '../geo/load';
import { geocode, type GeocodeResult } from '../geo/geocode';
import { fetchSatellite } from '../geo/satelliteTiles';
import { readUrlState, writeUrlState, parseCoords, formatCoords } from '../url';
import { detectIpLocation } from '../geo/ipLocation';
import {
  t, setLanguage, getLanguage, hasExplicitLanguage, resolveSmartLanguage, type Lang,
} from '../i18n';
import { localMetersToLonLat } from '../geo/projection';
import { buildSurface, computeSurfaceFields, type SurfaceResult } from '../geo/surface';
import { trackEvent } from '../analytics';
import { stormIntensityMmHr } from '../sim/storm';
import { FloodSimulation } from '../sim/FloodSimulation';
import { Timeline } from '../sim/Timeline';
import { Rain } from '../render/Rain';
import { SceneManager } from '../render/SceneManager';
import { TerrainMesh } from '../render/TerrainMesh';
import { WaterMesh } from '../render/WaterMesh';
import { MaxFloodOverlay, VelocityField } from '../render/overlays';
import { FloodOverlay } from '../render/FloodOverlay';
import { SeaMesh } from '../render/SeaMesh';
import { GeologyController } from './GeologyController';
import { MarkerLayer } from './MarkerLayer';
import { sampleElevation, sampleDepth } from './terrainSampling';
import { AddressBar } from '../ui/AddressBar';
import { LanguagePicker } from '../ui/LanguagePicker';
import { PourTool } from '../ui/PourTool';
import { ControlsPanel, type ControlCallbacks } from '../ui/ControlsPanel';
import { INITIAL_STATS, formatDuration, formatVolume, type StatsData } from '../ui/stats';
import { showToast } from '../ui/toast';

const MAX_STEPS_PER_FRAME = 48;
const READBACK_INTERVAL = 0.4; // seconds (wall clock)
const DEMO_SIM_SECONDS = 2.5 * 3600; // storm length precomputed for the demo timeline
const MAX_PRECOMPUTE_STEPS = 600; // sim substeps per captured frame
const TIMELINE_PLAY_SECONDS = 12; // real seconds to play the whole precomputed timeline

export class App {
  private readonly params: Params = { ...DEFAULT_PARAMS };
  private readonly stats: StatsData = { ...INITIAL_STATS };
  private readonly scene: SceneManager;
  private readonly group = new THREE.Group();
  private readonly markerLayer = new MarkerLayer(this.group);
  private readonly addressBar: AddressBar;
  private readonly languagePicker: LanguagePicker;
  private readonly pourTool: PourTool;
  private panel: ControlsPanel;
  private pourDownX = 0;
  private pourDownY = 0;
  private currentLocation?: GeocodeResult;

  private terrain?: TerrainMesh;
  private water?: WaterMesh;
  private floodOverlay?: FloodOverlay;
  private maxFlood?: MaxFloodOverlay;
  private velocity?: VelocityField;
  private rain?: Rain;
  private sim?: FloodSimulation;
  private sea?: SeaMesh;
  private readonly geology = new GeologyController();
  private timeline?: Timeline;
  private timelineMode: 'live' | 'computing' | 'scrub' = 'live';
  private precomputeTargetFrames = 0;
  private precomputeFrameSec = 0;
  private heightmap?: Heightmap;
  private surfaceTexture?: THREE.DataTexture;
  private surfaceRaw?: Pick<SurfaceResult, 'land' | 'osm'>;
  private readback?: Float32Array;

  private waterStored = 0;
  private readonly resBuf = new THREE.Vector2();
  private readonly spotBuf = new THREE.Vector2();
  private readonly seaCloudColor = new THREE.Color(0.34, 0.36, 0.42);
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
  private weatherClock = 0; // advances only while running, so rain/storm freeze on pause
  private fpsEl: HTMLDivElement | null = null;
  private lastFpsShown = 0;
  private rainedVolume = 0;
  private observedMaxDepth = 1;
  private sinceReadback = 0;
  private readbackPending = false;
  private lowFpsTime = 0;
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
    if (url.grid && (GRID_RESOLUTIONS as readonly number[]).includes(url.grid)) {
      this.params.gridResolution = url.grid;
    }
    if (url.demo) this.params.demoMode = true;

    this.addressBar = new AddressBar({
      onSubmit: (text) => this.loadAddress(text),
      onSelect: (lat, lon, label) => this.loadCenter({ lat, lon, displayName: label }),
    });
    this.languagePicker = new LanguagePicker((lang) => this.setLang(lang));
    this.pourTool = new PourTool({ onToggle: (active) => this.setPourMode(active) });
    // The input is filled only once we know what we're loading (after IP detect
    // / geocode), so a default place never flashes for out-of-region visitors.

    this.panel = new ControlsPanel(this.params, this.stats, this.panelCallbacks());
    this.setupChromeToggle();

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
    // Click-to-pour: a click (not a drag, which rotates the camera) pours water.
    dom.addEventListener('pointerdown', (e) => {
      this.pourDownX = e.clientX;
      this.pourDownY = e.clientY;
    });
    dom.addEventListener('pointerup', (e) => {
      if (!this.params.pourMode) return;
      if (Math.hypot(e.clientX - this.pourDownX, e.clientY - this.pourDownY) > 6) return;
      this.pourAt(e.clientX, e.clientY);
    });
  }

  /** Mobile-only: a hamburger toggle that opens/closes the controls drawer. */
  private setupChromeToggle(): void {
    const toggle = document.getElementById('chrome-toggle');
    if (!toggle) return;
    const setOpen = (open: boolean): void => {
      document.body.classList.toggle('chrome-open', open);
      toggle.textContent = open ? '✕' : '☰';
      toggle.setAttribute('aria-expanded', String(open));
    };
    toggle.addEventListener('click', () => {
      setOpen(!document.body.classList.contains('chrome-open'));
    });
  }

  private setPourMode(active: boolean): void {
    this.params.pourMode = active;
    this.pourTool.setActive(active);
    this.scene.renderer.domElement.style.cursor = active ? 'crosshair' : '';
  }

  private pourAt(clientX: number, clientY: number): void {
    if (!this.terrain || !this.heightmap || !this.sim) return;
    const dom = this.scene.renderer.domElement;
    const rect = dom.getBoundingClientRect();
    this.pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointerNdc, this.scene.camera);
    const hit = this.raycaster.intersectObject(this.terrain.mesh, false)[0];
    if (!hit) return;
    const size = this.heightmap.sizeMeters;
    const u = THREE.MathUtils.clamp(hit.point.x / size + 0.5, 0, 1);
    const v = THREE.MathUtils.clamp(0.5 - hit.point.z / size, 0, 1);
    this.sim.requestPointInject(u, v, this.params.pourDepthM, this.params.pourRadiusM / size);
    this.params.floodLevelLive = false;
    this.params.running = true;
    this.timelineMode = 'live';
    trackEvent('pour_water', { depth: this.params.pourDepthM });
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

    if (url.lat !== undefined && url.lon !== undefined) {
      await this.loadCenter({
        lat: url.lat,
        lon: url.lon,
        displayName: formatCoords(url.lat, url.lon),
      });
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
      onPrecompute: () => this.startPrecompute(),
      onScrub: () => {
        if (!this.timeline?.ready) return;
        this.timelineMode = 'scrub';
        this.params.timelinePlaying = false;
        this.showTimelineFrame();
      },
      onTimelinePlay: () => {
        if (this.timeline?.ready) this.timelineMode = 'scrub';
      },
      onLive: () => {
        this.timelineMode = 'live';
        this.params.timelinePlaying = false;
        this.resetSim();
        this.applyParams();
        this.panel.refresh();
      },
      onDemoToggle: () => this.setDemoMode(this.params.demoMode),
    };
  }

  private setDemoMode(on: boolean): void {
    this.params.demoMode = on;
    writeUrlState({ demo: on });
    this.timelineMode = 'live';
    this.params.timelinePlaying = false;
    this.rebuildPanel();
    this.applyParams();
  }

  private rebuildPanel(): void {
    this.panel.dispose();
    this.panel = new ControlsPanel(this.params, this.stats, this.panelCallbacks());
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
    this.pourTool.retranslate();
    document.documentElement.lang = getLanguage();
    this.rebuildPanel();
    this.applyParams(); // re-translate legend labels etc.
  }

  private reloadCurrent(): void {
    if (this.currentLocation) void this.loadCenter(this.currentLocation);
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
      writeUrlState({
        lat: location.lat, lon: location.lon,
        km: this.params.mapSizeKm, grid: this.params.gridResolution,
      });
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
    this.terrain.setWeatherUniforms(this.scene.weather);
    this.sim = new FloodSimulation(
      this.scene.renderer,
      this.terrain.heightTexture,
      N,
      heightmap.sizeMeters,
      this.params,
    );
    this.sim.setSurface(this.params.useSurface && this.surfaceTexture ? this.surfaceTexture : null);
    if (surface) this.terrain.setSurfaceColors(surface.surface, N);
    this.water = new WaterMesh(
      this.terrain.geometry, this.terrain.heightTexture, heightmap.min, N, heightmap.sizeMeters, this.params,
    );
    this.water.setWeatherUniforms(this.scene.weather);
    this.sea = new SeaMesh(this.terrain.geometry, heightmap, surface?.land ?? null, this.params);
    this.sea.setWeatherUniforms(this.scene.weather);
    this.floodOverlay = new FloodOverlay(
      this.terrain.geometry,
      this.terrain.heightTexture,
      N,
      heightmap.sizeMeters,
      this.params,
    );
    this.maxFlood = new MaxFloodOverlay(this.terrain.geometry);
    this.velocity = new VelocityField(heightmap.sizeMeters, this.terrain.heightTexture);
    this.rain = new Rain(heightmap);
    this.readback = new Float32Array(N * N * 4);
    this.timeline = new Timeline(N);
    this.timelineMode = 'live';

    this.group.add(
      this.terrain.mesh, this.sea.mesh, this.water.mesh, this.water.skirt, this.floodOverlay.mesh,
      this.maxFlood.mesh, this.velocity.mesh, this.rain.object,
    );
    // The geology block lives in world space (not the terrain group) so its deep
    // vertical scale is independent of the terrain's exaggeration.
    const geologyMesh = this.geology.build(heightmap, surface?.land ?? null).mesh;
    this.scene.scene.add(geologyMesh);
    // Keep above-water overlays (and the opaque geology block below) out of the
    // refraction source so they don't get baked under the water surface.
    this.scene.setRefractionExcludes([
      this.floodOverlay.mesh, this.maxFlood.mesh, this.velocity.mesh, this.rain.object, geologyMesh,
    ]);
    this.markerLayer.build(heightmap);

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
    this.sea?.update(this.params);
    this.floodOverlay?.update(this.params);
    this.terrain?.setWireframe(this.params.wireframe);
    this.terrain?.applyStyle(this.params.terrainStyle);
    // When the water shader owns depth colour (medium/high), don't double-darken the
    // terrain beneath it; the refracted bottom should be the un-darkened satellite.
    const waterOwnsDepth = this.params.waterQuality !== 'low';
    this.terrain?.updateWater(this.params.depthColorMax, waterOwnsDepth ? 0 : this.params.imageryDarkening);
    this.scene.setStorm(this.params.storm);
    this.terrain?.setSkyTint(this.scene.skyTopColor);
    this.scene.applyPostParams(this.params);
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
    this.geology.update(this.params, this.heightmap, this.surfaceRaw?.land ?? null);
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
    this.stepSimSeconds(dtReal * this.params.timeScale, MAX_STEPS_PER_FRAME);
  }

  /** Advance the sim by a fixed number of simulated seconds (CFL-substepped). */
  private stepSimSeconds(simSeconds: number, maxSteps: number): void {
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

    const stepDt = Math.min(simSeconds / this.params.substeps, cflMax);
    let remaining = simSeconds;
    let steps = 0;
    while (remaining > 1e-6 && steps < maxSteps && stepDt > 0) {
      const dt = Math.min(stepDt, remaining);
      this.sim.step(dt);
      remaining -= dt;
      steps++;
    }
    const simulated = simSeconds - remaining;
    this.simTimeSec += simulated;
    this.rainedVolume += (intensityMmHr / 1000 / 3600) * this.rainArea() * simulated;
  }

  // --- demo timeline: precompute the storm into scrubbable frames ---
  private startPrecompute(): void {
    if (!this.sim || !this.timeline) return;
    this.resetSim();
    this.params.raining = true;
    this.params.floodLevelLive = false;
    this.params.timelinePlaying = false;
    this.params.timelinePos = 0;
    this.timeline.begin();
    this.timelineMode = 'computing';
    const N = this.sim.N;
    this.precomputeTargetFrames = Math.max(24, Math.min(72, Math.floor(150e6 / (N * N * 16))));
    this.precomputeFrameSec = DEMO_SIM_SECONDS / this.precomputeTargetFrames;
    this.applyParams();
    this.panel.refresh();
  }

  private tickPrecompute(): void {
    if (!this.sim || !this.timeline || !this.readback) return;
    this.stepSimSeconds(this.precomputeFrameSec, MAX_PRECOMPUTE_STEPS);
    this.sim.readWater(this.readback);
    let maxEver = 1;
    for (let i = 1; i < this.readback.length; i += 4) {
      if (this.readback[i] > maxEver) maxEver = this.readback[i];
    }
    this.observedMaxDepth = maxEver;
    this.timeline.capture(this.readback, this.simTimeSec);
    this.timeline.progress = this.timeline.count / this.precomputeTargetFrames;
    if (this.timeline.count >= this.precomputeTargetFrames) {
      this.timeline.finish();
      this.timelineMode = 'scrub';
      this.params.timelinePos = 0;
      this.params.timelinePlaying = true; // auto-play the finished scene once
      this.showTimelineFrame();
      this.panel.refresh();
    }
  }

  private showTimelineFrame(): void {
    if (!this.timeline || !this.readback) return;
    const f = this.timeline.showAt(this.params.timelinePos);
    if (!f) return;
    this.readback.set(f.rgba);
    this.computeStatsFromReadback(f.time);
  }

  private timelineStatus(): string {
    if (this.timelineMode === 'computing' && this.timeline) {
      return t('demo.stComputing', { pct: Math.round(this.timeline.progress * 100) });
    }
    if (this.timelineMode === 'scrub') return t('demo.stReady');
    return t('demo.stLive');
  }

  private rainArea(): number {
    const size = this.params.mapSizeKm * 1000;
    if (this.params.rainFootprint === 'uniform') return size * size;
    const frac = Math.min(1, Math.PI * this.params.spotRadius * this.params.spotRadius * 0.5);
    return size * size * frac;
  }

  private syncTextures(): void {
    if (!this.sim) return;
    const depthTex = this.timelineMode === 'scrub' && this.timeline
      ? this.timeline.tex
      : this.sim.waterTexture;
    this.water?.setDepthTexture(depthTex);
    this.terrain?.setDepthTexture(depthTex);
    this.floodOverlay?.setDepthTexture(depthTex);
    this.maxFlood?.setDepthTexture(depthTex);
    this.velocity?.setTextures(depthTex, depthTex);
  }

  private updateStats(): void {
    if (!this.sim || !this.readback || !this.heightmap) return;
    this.sim.readWater(this.readback);
    this.computeStatsFromReadback(this.simTimeSec);
  }

  /** Non-blocking stats: poll a finished async readback, then kick the next one.
   * Avoids the ~26ms gl.readPixels stall (at 1024) every refresh interval. */
  private pumpStatsReadback(dt: number): void {
    if (!this.sim || !this.readback) return;
    if (this.readbackPending && this.sim.pollReadback(this.readback)) {
      this.readbackPending = false;
      this.computeStatsFromReadback(this.simTimeSec);
    }
    this.sinceReadback += dt;
    if (!this.readbackPending && this.sinceReadback >= READBACK_INTERVAL) {
      this.sinceReadback = 0;
      if (this.sim.requestReadback()) this.readbackPending = true;
      else this.updateStats(); // no WebGL2 fence support → sync fallback
    }
  }

  private computeStatsFromReadback(simTime: number): void {
    if (!this.sim || !this.readback) return;
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
    if (this.timelineMode !== 'scrub') this.observedMaxDepth = Math.max(1, maxEver);
    this.waterStored = stored * cellArea;
    this.stats.simTime = formatDuration(simTime);
    this.stats.rained = formatVolume(this.rainedVolume);
    this.stats.stored = formatVolume(stored * cellArea);
    this.stats.floodedArea = `${((flooded / (N * N)) * 100).toFixed(1)} %`;
    this.stats.maxDepth = `${maxNow.toFixed(2)} m (max ${maxEver.toFixed(2)})`;
    this.stats.fps = this.fpsEma.toFixed(0);
    this.stats.timelineStatus = this.timelineStatus();
    this.panel.refresh();
  }

  private loop = (now: number): void => {
    const dt = Math.min(0.05, (now - this.lastTime) / 1000) || 0;
    this.lastTime = now;
    if (dt > 0) this.fpsEma = this.fpsEma * 0.9 + (1 / dt) * 0.1;

    if (this.sim) {
      if (this.timelineMode === 'computing') {
        this.tickPrecompute(); // fills this.readback synchronously + captures
        this.computeStatsFromReadback(this.simTimeSec);
        this.syncTextures();
      } else if (this.timelineMode === 'scrub') {
        if (this.params.timelinePlaying) {
          this.params.timelinePos += dt / TIMELINE_PLAY_SECONDS;
          if (this.params.timelinePos > 1) this.params.timelinePos = 0; // loop
          this.panel.refresh();
        }
        this.showTimelineFrame();
        this.syncTextures();
      } else {
        if (this.params.floodLevelLive && this.heightmap) {
          this.sim.requestFill(this.heightmap.min + this.params.fillLevelM, true);
          this.sim.step(0); // set water exactly to the level, no dynamics
        } else if (this.params.running) {
          this.advanceSim(dt);
        }
        this.syncTextures();
        this.pumpStatsReadback(dt);
      }
    }

    // Pause freezes the weather too: the rain/storm clock only advances while
    // running, and lightning/drift are gated, so Pause gives a still scene.
    if (this.params.running) this.weatherClock += dt;
    this.rain?.update(this.params, this.weatherClock);
    if (this.rain) this.rain.object.visible = this.params.raining && this.params.running;
    this.scene.setWetness(this.params.raining && this.params.running ? 0.9 : 0);
    this.scene.updateStorm(dt, this.params.running);
    this.showFps(now);
    this.updateWaterLook(dt);
    this.updateReadout(dt);
    this.updateDrainArrows();
    this.markerLayer.update(this.scene.camera);
    if (this.timelineMode === 'live') this.autoQualityCheck(dt);
    this.scene.render(this.water, this.sea);
    requestAnimationFrame(this.loop);
  };

  /** Always-visible FPS badge (the panel's stat is collapsible/buried). */
  private showFps(now: number): void {
    if (now - this.lastFpsShown < 200) return;
    this.lastFpsShown = now;
    if (!this.fpsEl) {
      this.fpsEl = document.createElement('div');
      this.fpsEl.id = 'fps-meter';
      document.body.appendChild(this.fpsEl);
    }
    const f = Math.round(this.fpsEma);
    this.fpsEl.textContent = `${f} fps`;
    this.fpsEl.style.color = f >= 50 ? '#86e08a' : f >= 30 ? '#e0cf86' : '#e08a86';
  }

  /** One-way quality degradation when FPS stays low, so weak GPUs stay usable. */
  private autoQualityCheck(dt: number): void {
    if (!this.params.autoQuality) return;
    this.lowFpsTime = this.fpsEma < 30 ? this.lowFpsTime + dt : Math.max(0, this.lowFpsTime - dt * 2);
    if (this.lowFpsTime < 2.5) return;
    this.lowFpsTime = 0;
    const p = this.params;
    let changed = true;
    if (p.renderScale > 0.75) p.renderScale = 0.7;
    else if (p.ssao) p.ssao = false;
    else if (p.waterRefraction && p.waterQuality !== 'low') p.waterRefraction = false;
    else if (p.bloom > 0.01) p.bloom = 0;
    else changed = false;
    if (changed) {
      this.applyParams();
      this.panel.refresh();
      showToast(t('toast.autoQuality'), false);
    }
  }

  private updateWaterLook(_dt: number): void {
    // wet-look is gated per-cell by proximity to water in the terrain shader, so
    // it follows the flood (and persists after the rain stops) — just pass intensity.
    this.terrain?.setWetness(this.params.wetness);

    this.sea?.setFrame({
      resolution: this.scene.getResolution(this.resBuf),
      cameraNear: this.scene.camera.near,
      cameraFar: this.scene.camera.far,
      sunDir: this.scene.sunDirection,
      sunColor: this.scene.sunColorLinear,
      skyTop: this.scene.skyTopColor,
      skyHorizon: this.scene.skyHorizonColor,
      cloudColor: this.seaCloudColor,
    });
    if (!this.water) return;
    this.water.setFrame({
      resolution: this.scene.getResolution(this.resBuf),
      cameraNear: this.scene.camera.near,
      cameraFar: this.scene.camera.far,
      sunDir: this.scene.sunDirection,
      sunColor: this.scene.sunColorLinear,
      skyTop: this.scene.skyTopColor,
      skyHorizon: this.scene.skyHorizonColor,
      cloudReflect: this.params.storm ? 0.5 : 0.15,
    });

    const size = this.params.mapSizeKm * 1000;
    const mmHr = this.params.raining
      ? stormIntensityMmHr(this.params.stormType, this.simTimeSec, this.params.intensityMmPerHr)
      : 0;
    const amount = this.params.rainSplashes && this.params.raining
      ? THREE.MathUtils.clamp(mmHr / 120, 0, 1) : 0;
    const spot = this.params.rainFootprint === 'spot';
    this.spotBuf.set((this.params.spotX - 0.5) * size, (0.5 - this.params.spotY) * size);
    this.water.setRain(amount, spot, this.spotBuf, spot ? this.params.spotRadius * size : 1e9);
  }

  private updateDrainArrows(): void {
    // Auto-reveal flow arrows while draining (rain off) so the water's path shows.
    const draining = this.params.running && !this.params.raining && this.waterStored > 1;
    if (this.velocity) this.velocity.mesh.visible = this.params.showVelocity || draining;
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
    const elev = sampleElevation(this.heightmap, u, v);
    const depth = this.readback ? sampleDepth(this.readback, this.heightmap.N, u, v) : 0;
    const [lon, lat] = localMetersToLonLat(this.heightmap.center, hit.point.x, -hit.point.z);

    const water = depth > 0.01 ? `  ·  ${t('readout.water')} ${depth.toFixed(2)} m` : '';
    this.readout.textContent = `${t('readout.elev')} ${elev.toFixed(1)} m${water}  ·  ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    this.readout.style.display = 'block';
    this.readout.style.left = `${this.pointerClientX + 14}px`;
    this.readout.style.top = `${this.pointerClientY + 14}px`;
  }

  private disposeWorld(): void {
    this.markerLayer.clear();
    if (this.terrain) this.group.remove(this.terrain.mesh);
    if (this.water) this.group.remove(this.water.mesh, this.water.skirt);
    if (this.sea) { this.group.remove(this.sea.mesh); this.sea.dispose(); this.sea = undefined; }
    if (this.floodOverlay) this.group.remove(this.floodOverlay.mesh);
    if (this.maxFlood) this.group.remove(this.maxFlood.mesh);
    if (this.velocity) this.group.remove(this.velocity.mesh);
    if (this.rain) this.group.remove(this.rain.object);
    this.geology.dispose(this.scene.scene);
    this.sim?.dispose();
    this.timeline?.dispose();
    this.timeline = undefined;
    this.water?.dispose();
    this.floodOverlay?.dispose();
    this.maxFlood?.dispose();
    this.velocity?.dispose();
    this.rain?.dispose();
    this.terrain?.dispose();
    this.surfaceTexture?.dispose();
    this.sim = undefined;
    this.water = undefined;
    this.floodOverlay = undefined;
    this.maxFlood = undefined;
    this.velocity = undefined;
    this.rain = undefined;
    this.terrain = undefined;
    this.surfaceTexture = undefined;
    this.surfaceRaw = undefined;
  }
}
