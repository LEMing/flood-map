import * as THREE from 'three';
import { DEFAULT_PARAMS, GRID_RESOLUTIONS, type Params } from '../config';
import type { Heightmap } from '../geo/heightmap';
import { readUrlState, writeUrlState } from '../url';
import { t, setLanguage, getLanguage, loadLanguage, type Lang } from '../i18n';
import { computeSurfaceFields, type SurfaceResult } from '../geo/surface';
import { trackEvent } from '../analytics';
import { stormIntensityMmHr } from '../sim/storm';
import { Rain } from '../render/Rain';
import { SceneManager } from '../render/SceneManager';
import { TerrainMesh } from '../render/TerrainMesh';
import { WaterMesh } from '../render/WaterMesh';
import { MaxFloodOverlay, VelocityField } from '../render/overlays';
import { FloodOverlay } from '../render/FloodOverlay';
import { SeaMesh } from '../render/SeaMesh';
import { GeologyController } from './GeologyController';
import { MarkerLayer } from './MarkerLayer';
import { PointerController } from './PointerController';
import { SimDriver } from './SimDriver';
import { WorldBuilder, type BuiltWorld } from './WorldBuilder';
import { AddressBar } from '../ui/AddressBar';
import { LanguagePicker } from '../ui/LanguagePicker';
import { PourTool } from '../ui/PourTool';
import { ControlsPanel, type ControlCallbacks } from '../ui/ControlsPanel';
import { INITIAL_STATS, type StatsData } from '../ui/stats';
import { showToast } from '../ui/toast';

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
  private readonly pointer: PointerController;
  private readonly simDriver: SimDriver;
  private readonly worldBuilder: WorldBuilder;

  private terrain?: TerrainMesh;
  private water?: WaterMesh;
  private floodOverlay?: FloodOverlay;
  private maxFlood?: MaxFloodOverlay;
  private velocity?: VelocityField;
  private rain?: Rain;
  private sea?: SeaMesh;
  private readonly geology = new GeologyController();
  private heightmap?: Heightmap;
  private surfaceTexture?: THREE.DataTexture;
  private surfaceRaw?: Pick<SurfaceResult, 'land' | 'osm'>;

  private readonly resBuf = new THREE.Vector2();
  private readonly spotBuf = new THREE.Vector2();
  private readonly seaCloudColor = new THREE.Color(0.34, 0.36, 0.42);
  private readonly legend = document.getElementById('legend') as HTMLDivElement | null;
  private readonly legendMin = document.getElementById('legend-min');
  private readonly legendMax = document.getElementById('legend-max');

  private weatherClock = 0; // advances only while running, so rain/storm freeze on pause
  private fpsEl: HTMLDivElement | null = null;
  private lastFpsShown = 0;
  private lowFpsTime = 0;
  private fpsEma = 60;
  private lastTime = 0;
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
      onSubmit: (text) => this.worldBuilder.loadAddress(text),
      onSelect: (lat, lon, label) => this.worldBuilder.loadCenter({ lat, lon, displayName: label }),
    });
    this.languagePicker = new LanguagePicker((lang) => void this.setLang(lang));
    this.pourTool = new PourTool({ onToggle: (active) => this.setPourMode(active) });
    // The input is filled only once we know what we're loading (after IP detect
    // / geocode), so a default place never flashes for out-of-region visitors.

    this.panel = new ControlsPanel(this.params, this.stats, this.panelCallbacks());
    this.setupChromeToggle();

    this.simDriver = new SimDriver(this.params, this.stats, {
      refreshPanel: () => this.panel.refresh(),
      syncTextures: () => this.syncTextures(),
      fps: () => this.fpsEma,
    });

    this.pointer = new PointerController({
      camera: this.scene.camera,
      dom: this.scene.renderer.domElement,
      getTerrainMesh: () => this.terrain?.mesh,
      getHeightmap: () => this.heightmap,
      getReadback: () => this.simDriver.readback,
      isPourMode: () => this.params.pourMode,
      pour: (u, v) => this.pour(u, v),
    });

    this.worldBuilder = new WorldBuilder({
      scene: this.scene,
      group: this.group,
      params: this.params,
      addressBar: this.addressBar,
      simDriver: this.simDriver,
      geology: this.geology,
      markerLayer: this.markerLayer,
      disposeWorld: () => this.disposeWorld(),
      setBuiltWorld: (w) => this.setBuiltWorld(w),
      getTerrain: () => this.terrain,
      applyParams: () => this.applyParams(),
      applyDetectedLanguage: (lang) => this.applyDetectedLanguage(lang),
      refreshPanel: () => this.panel.refresh(),
      setStatsLocation: (label) => { this.stats.location = label; },
    });

    // GPU context loss (driver reset, OOM): freeze, then rebuild the current
    // world once the browser restores the context (a clean known-good state).
    this.scene.onLost = () => { this.params.running = false; };
    this.scene.onRestored = () => { this.worldBuilder.reloadCurrent(); };
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

  /** Inject water at a picked terrain cell (called by the PointerController). */
  private pour(u: number, v: number): void {
    if (!this.heightmap || !this.simDriver.hasSim) return;
    const size = this.heightmap.sizeMeters;
    this.simDriver.requestPointInject(u, v, this.params.pourDepthM, this.params.pourRadiusM / size);
    this.params.floodLevelLive = false;
    this.params.running = true;
    trackEvent('pour_water', { depth: this.params.pourDepthM });
  }

  start(): void {
    this.lastTime = performance.now();
    void this.worldBuilder.bootstrap();
    requestAnimationFrame(this.loop);
  }

  private panelCallbacks(): ControlCallbacks {
    return {
      onParamChange: () => this.applyParams(),
      onRebuild: () => this.worldBuilder.reloadCurrent(),
      onReset: () => this.simDriver.reset(),
      onStep: () => this.simDriver.stepOnce(),
      onTogglePlay: () => {
        this.params.running = !this.params.running;
      },
      onDump: () => {
        this.simDriver.requestInject(this.params.releaseDepthM);
        this.params.raining = false; // watch it flow & drain, not rain
        this.params.running = true;
        this.applyParams();
        this.panel.refresh();
      },
      onFill: () => {
        if (!this.simDriver.hasSim || !this.heightmap) return;
        this.simDriver.requestFill(this.heightmap.min + this.params.fillLevelM);
        this.params.raining = false;
        this.params.running = true;
        this.applyParams();
        this.panel.refresh();
      },
      onPrecompute: () => {
        this.simDriver.beginPrecompute();
        this.applyParams();
        this.panel.refresh();
      },
      onScrub: () => this.simDriver.scrub(),
      onTimelinePlay: () => this.simDriver.toScrubIfReady(),
      onLive: () => {
        this.simDriver.setLive();
        this.params.timelinePlaying = false;
        this.simDriver.reset();
        this.applyParams();
        this.panel.refresh();
      },
      onDemoToggle: () => this.setDemoMode(this.params.demoMode),
    };
  }

  private setDemoMode(on: boolean): void {
    this.params.demoMode = on;
    writeUrlState({ demo: on });
    this.simDriver.setLive();
    this.params.timelinePlaying = false;
    this.rebuildPanel();
    this.applyParams();
  }

  private rebuildPanel(): void {
    this.panel.dispose();
    this.panel = new ControlsPanel(this.params, this.stats, this.panelCallbacks());
  }

  private async setLang(lang: Lang): Promise<void> {
    await loadLanguage(lang); // lazy locale chunk — fetch before re-rendering
    setLanguage(lang); // explicit user choice → persisted
    writeUrlState({ lang });
    this.rebuildForLanguage();
  }

  private async applyDetectedLanguage(lang: Lang): Promise<void> {
    await loadLanguage(lang);
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

  /** Adopt a freshly built world from the WorldBuilder as the live scene. */
  private setBuiltWorld(w: BuiltWorld): void {
    this.heightmap = w.heightmap;
    this.terrain = w.terrain;
    this.water = w.water;
    this.sea = w.sea;
    this.floodOverlay = w.floodOverlay;
    this.maxFlood = w.maxFlood;
    this.velocity = w.velocity;
    this.rain = w.rain;
    this.surfaceTexture = w.surfaceTexture;
    this.surfaceRaw = w.surfaceRaw;
  }

  private applyParams(): void {
    this.group.scale.y = this.params.verticalExaggeration;
    this.simDriver.updateParams(this.params);
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
    if (!this.simDriver.hasSim) return;
    if (this.params.useSurface && this.surfaceRaw && this.surfaceTexture && this.heightmap) {
      const data = computeSurfaceFields(this.heightmap, this.surfaceRaw.land, this.surfaceRaw.osm, this.params);
      (this.surfaceTexture.image.data as Float32Array).set(data);
      this.surfaceTexture.needsUpdate = true;
      this.simDriver.setSurface(this.surfaceTexture);
      this.terrain?.setSurfaceColors(data, this.heightmap.N);
    } else {
      this.simDriver.setSurface(null);
    }
  }

  /** Wire the sim's (or scrubbed timeline's) depth texture into the render meshes. */
  private syncTextures(): void {
    const depthTex = this.simDriver.currentDepthTexture();
    if (!depthTex) return;
    this.water?.setDepthTexture(depthTex);
    this.terrain?.setDepthTexture(depthTex);
    this.floodOverlay?.setDepthTexture(depthTex);
    this.maxFlood?.setDepthTexture(depthTex);
    this.velocity?.setTextures(depthTex, depthTex);
  }

  private loop = (now: number): void => {
    const dt = Math.min(0.05, (now - this.lastTime) / 1000) || 0;
    this.lastTime = now;
    if (this.scene.contextLost) { // GPU gone: skip stepping/rendering until restored
      requestAnimationFrame(this.loop);
      return;
    }
    if (dt > 0) this.fpsEma = this.fpsEma * 0.9 + (1 / dt) * 0.1;

    this.simDriver.tick(dt);

    // Pause freezes the weather too: the rain/storm clock only advances while
    // running, and lightning/drift are gated, so Pause gives a still scene.
    if (this.params.running) this.weatherClock += dt;
    this.rain?.update(this.params, this.weatherClock);
    if (this.rain) this.rain.object.visible = this.params.raining && this.params.running;
    this.scene.setWetness(this.params.raining && this.params.running ? 0.9 : 0);
    this.scene.updateStorm(dt, this.params.running);
    this.showFps(now);
    this.updateWaterLook(dt);
    this.pointer.update(dt);
    this.updateDrainArrows();
    this.markerLayer.update(this.scene.camera);
    if (this.simDriver.mode === 'live') this.autoQualityCheck(dt);
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
      ? stormIntensityMmHr(this.params.stormType, this.simDriver.simTimeSec, this.params.intensityMmPerHr)
      : 0;
    const amount = this.params.rainSplashes && this.params.raining
      ? THREE.MathUtils.clamp(mmHr / 120, 0, 1) : 0;
    const spot = this.params.rainFootprint === 'spot';
    this.spotBuf.set((this.params.spotX - 0.5) * size, (0.5 - this.params.spotY) * size);
    this.water.setRain(amount, spot, this.spotBuf, spot ? this.params.spotRadius * size : 1e9);
  }

  private updateDrainArrows(): void {
    // Auto-reveal flow arrows while draining (rain off) so the water's path shows.
    const draining = this.params.running && !this.params.raining && this.simDriver.waterStored > 1;
    if (this.velocity) this.velocity.mesh.visible = this.params.showVelocity || draining;
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
    this.simDriver.dispose();
    this.water?.dispose();
    this.floodOverlay?.dispose();
    this.maxFlood?.dispose();
    this.velocity?.dispose();
    this.rain?.dispose();
    this.terrain?.dispose();
    this.surfaceTexture?.dispose();
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
