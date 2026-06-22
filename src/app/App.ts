import * as THREE from 'three';
import { DEFAULT_PARAMS, type Params } from '../config';
import type { Heightmap } from '../geo/heightmap';
import type { GeocodeResult } from '../geo/geocode';
import { VideoMode } from './VideoMode';
import { AmbientHero } from './AmbientHero';
import { videoCaptureSupported } from '../video/Recorder';
import { readUrlState, writeUrlState } from '../url';
import { ScenarioUrl } from './ScenarioUrl';
import { t, setLanguage, loadLanguage, applyDocumentLang, type Lang } from '../i18n';
import { computeSurfaceFields, computeSewerFields, type SurfaceResult } from '../geo/surface';
import { SoilInfiltration } from './SoilInfiltration';
import { upsertFloatTexture } from './floatTexture';
import { trackEvent } from '../analytics';
import { stormIntensityMmHr } from '../sim/storm';
import { Rain } from '../render/Rain';
import { SceneManager } from '../render/SceneManager';
import { TerrainMesh } from '../render/TerrainMesh';
import { WaterMesh } from '../render/WaterMesh';
import { MaxFloodOverlay, VelocityField } from '../render/overlays';
import { FloodOverlay } from '../render/FloodOverlay';
import { SeaMesh } from '../render/SeaMesh';
import { BuildingsMesh } from '../render/BuildingsMesh';
import { GeologyController } from './GeologyController';
import { MarkerLayer } from './MarkerLayer';
import { PointerController } from './PointerController';
import { SimDriver } from './SimDriver';
import { WorldBuilder, type BuiltWorld } from './WorldBuilder';
import { AddressBar } from '../ui/AddressBar';
import { GameUI } from '../ui/GameUI';
import { ControlsPanel, type ControlCallbacks } from '../ui/ControlsPanel';
import { INITIAL_STATS, type StatsData } from '../ui/stats';
import { showToast } from '../ui/toast';
import { setupChromeToggle } from '../ui/chromeToggle';
import { FpsBadge } from '../ui/FpsBadge';
import { HeatLegend } from '../ui/HeatLegend';

export class App {
  private readonly params: Params = { ...DEFAULT_PARAMS };
  private readonly stats: StatsData = { ...INITIAL_STATS };
  private readonly scene: SceneManager;
  private readonly group = new THREE.Group();
  private readonly markerLayer = new MarkerLayer(this.group);
  private readonly addressBar: AddressBar;
  private readonly gameUI: GameUI;
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
  private buildings?: BuildingsMesh;
  private readonly geology = new GeologyController();
  private readonly soil = new SoilInfiltration(); // SoilGrids → per-cell Ks + Green-Ampt suction
  private heightmap?: Heightmap;
  private surfaceTexture?: THREE.DataTexture;
  private sewerTexture?: THREE.DataTexture;
  private surfaceRaw?: Pick<SurfaceResult, 'land' | 'osm'>;

  private readonly resBuf = new THREE.Vector2();
  private readonly spotBuf = new THREE.Vector2();
  private readonly seaCloudColor = new THREE.Color(0.34, 0.36, 0.42);
  private readonly heatLegend = new HeatLegend();
  private readonly fpsBadge = new FpsBadge();

  private weatherClock = 0; // advances only while running, so rain/storm freeze on pause
  private lowFpsTime = 0;
  private fpsEma = 60;
  private lastTime = 0;
  // Render-on-demand: a static paused/idle scene must not re-render every frame
  // (that pins the GPU → fan/heat). The loop only draws when this is set or
  // something is genuinely moving (sim, camera, an ease). framesRendered is a
  // diagnostic counter (read via the dev `window.app`).
  private needsRender = true;
  private framesRendered = 0;
  private readonly credit = document.getElementById('credit');
  private readonly scenarioUrl = new ScenarioUrl(this.params, () => this.stats.location || this.params.address);

  // Routing lifecycle: the loop is kicked once (started), but only steps/renders
  // while `active` (this view is the live /sim, not the hidden landing) and not
  // `capturing` (the video recorder drives frames manually, so the rAF loop
  // steps aside to avoid double-stepping the sim).
  private started = false;
  private active = false;
  private capturing = false;
  private videoMode?: VideoMode;
  /** The landing's ambient-flood backdrop + the seamless handoff into the interactive sim. */
  readonly ambient: AmbientHero;
  // Bumped on every route change (setActive); an async build captures it and bails
  // its post-build enterVideoMode() if the user navigated away meanwhile.
  private navToken = 0;
  // Set when video capture was requested before the world finished building; the
  // render loop starts it once the build completes.
  private pendingVideo = false;

  /** Total GPU frames actually drawn — should plateau when the scene is idle. */
  get rendered(): number { return this.framesRendered; }

  /** Whether the render loop has been kicked (the router uses this to avoid
   *  re-bootstrapping a kept-alive App on a Forward navigation to /sim). */
  get isStarted(): boolean { return this.started; }

  constructor(canvas: HTMLCanvasElement, private readonly onLanguageChange?: (lang: Lang) => void) {
    this.scene = new SceneManager(canvas);
    this.scene.scene.add(this.group);

    const url = readUrlState();
    if (url.demo) this.params.demoMode = true;
    this.scenarioUrl.applyFromUrl(url);

    this.addressBar = new AddressBar({
      onSubmit: (text) => this.worldBuilder.loadAddress(text),
      onSelect: (lat, lon, label) => this.worldBuilder.loadCenter({ lat, lon, displayName: label }),
    });
    this.gameUI = new GameUI({
      onStart: () => this.startSimulation(),
      onTogglePause: () => this.togglePause(),
      onRestart: () => this.restartSimulation(),
      onSpeedSet: (ts) => { this.params.timeScale = ts; this.applyParams(); },
    });
    // The input is filled only once we know what we're loading (after IP detect
    // / geocode), so a default place never flashes for out-of-region visitors.

    this.panel = new ControlsPanel(this.params, this.stats, this.panelCallbacks());
    setupChromeToggle();

    this.simDriver = new SimDriver(this.params, this.stats, {
      refreshPanel: () => { this.panel.refresh(); this.gameUI.setTime(this.stats.simTime); },
      syncTextures: () => this.syncTextures(),
      fps: () => this.fpsEma,
    });

    this.pointer = new PointerController({
      camera: this.scene.camera,
      dom: this.scene.renderer.domElement,
      getTerrainMesh: () => this.terrain?.mesh,
      getHeightmap: () => this.heightmap,
      getReadback: () => this.simDriver.readback,
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
      setStatsLocation: (label) => { this.stats.location = label; this.gameUI.setSubtitle(label); },
    });
    this.ambient = new AmbientHero({
      params: this.params, simDriver: this.simDriver, scene: this.scene, worldBuilder: this.worldBuilder,
      applyParams: () => this.applyParams(),
      renderCaptureFrame: (dt) => this.renderCaptureFrame(dt),
      requestLoop: () => { this.ensureLoop(); this.needsRender = true; },
    });
    this.ambient.applyScale(url.km, url.grid); // URL deep-link scale (card scale comes via the router)

    // GPU context loss (driver reset, OOM): freeze, then rebuild the current
    // world once the browser restores the context (a clean known-good state).
    // Freeze and re-gate Play (the world is gone until the rebuild) on context loss;
    // the restore rebuild calls setReady(true) again via setBuiltWorld.
    this.scene.onLost = () => { this.params.running = false; this.gameUI.setReady(false); };
    this.scene.onRestored = () => { this.worldBuilder.reloadCurrent(); };

    // Repaint once after a resize; resume cleanly when the tab becomes visible
    // again (reset the clock so dt doesn't spike after a long hidden stretch).
    window.addEventListener('resize', () => { this.needsRender = true; });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { this.lastTime = performance.now(); this.needsRender = true; }
    });
  }

  /** Launch button: start the rain and run the sim from dry ground. */
  private startSimulation(): void {
    this.params.raining = this.params.running = true;
    this.applyParams();
    this.panel.refresh(); this.gameUI.setRunning(true);
    trackEvent('sim_start');
  }

  private togglePause(): void {
    this.params.running = !this.params.running;
    this.needsRender = true; // render the transition frame (then the wet/rain ease carries it)
    this.gameUI.setRunning(this.params.running);
    this.panel.refresh();
  }

  private restartSimulation(): void {
    this.simDriver.reset();
    this.params.running = this.needsRender = true;
    this.gameUI.setRunning(true);
    this.panel.refresh();
  }

  /** Deep-link / refresh entry: pick the center from URL/IP, then run live (or go
   *  straight into the video capture for a /video deep-link). */
  start(opts: { cinematic?: boolean } = {}): void {
    this.active = true;
    const gen = this.navToken;
    this.ensureLoop();
    void this.worldBuilder.bootstrap()
      .then(() => { if (opts.cinematic && gen === this.navToken) this.enterVideoMode(); });
  }

  /** Entry from the landing page: load an already-resolved place, optionally
   *  going straight into the cinematic video capture once it's built. */
  startAt(location: GeocodeResult, opts: { cinematic?: boolean } = {}): void {
    this.active = true;
    this.lastTime = performance.now();
    this.ensureLoop();
    void this.enterLocation(location, opts);
  }

  private async enterLocation(location: GeocodeResult, opts: { cinematic?: boolean }): Promise<void> {
    const gen = this.navToken;
    await this.worldBuilder.loadCenter(location);
    if (opts.cinematic && gen === this.navToken) this.enterVideoMode();
  }

  /** Show/hide this view: while the landing is up the sim is paused (no step,
   *  no render) so a backgrounded 3D scene never burns the GPU. */
  setActive(active: boolean): void {
    this.navToken++;
    this.active = active;
    if (active) this.lastTime = performance.now();
  }

  private ensureLoop(): void {
    if (this.started) return;
    this.started = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  /** Stop and tear down an in-progress video capture (router left /video). */
  exitVideoMode(): void {
    this.pendingVideo = false;
    this.videoMode?.cancel();
    this.videoMode = undefined;
  }

  /** Record an accelerated storm over the current world to a downloadable clip.
   *  If the world is still building (deep-link/Back to /video mid-load), defer:
   *  the render loop retries this once `worldBuilder.isLoading` clears, so the
   *  precompute never starts against a half-built sim (which would stall at 0%). */
  enterVideoMode(): void {
    if (this.videoMode || !this.active) return;
    if (!videoCaptureSupported()) { showToast(t('video.unsupported'), true); return; }
    if (!this.simDriver.hasSim || this.worldBuilder.isLoading) {
      this.pendingVideo = true;
      return;
    }
    this.pendingVideo = false;
    this.videoMode = new VideoMode({
      params: this.params,
      simDriver: this.simDriver,
      scene: this.scene,
      placeName: () => this.stats.location || this.params.address,
      applyParams: () => this.applyParams(),
      refreshPanel: () => this.panel.refresh(),
      renderCaptureFrame: (dt) => this.renderCaptureFrame(dt),
      setCapturing: (on) => this.setCapturing(on),
      onExit: () => { this.videoMode = undefined; },
      replay: () => this.enterVideoMode(),
    });
    void this.videoMode.run();
  }

  /** Start a capture that was deferred until the world finished building. */
  private startDeferredVideoIfReady(): boolean {
    if (!this.pendingVideo || this.videoMode) return false;
    if (!this.simDriver.hasSim || this.worldBuilder.isLoading) return false;
    this.enterVideoMode();
    return true;
  }

  private panelCallbacks(): ControlCallbacks {
    return {
      onParamChange: () => this.applyParams(),
      onRebuild: () => this.worldBuilder.reloadCurrent(),
      onReset: () => { this.simDriver.reset(); this.needsRender = true; },
      onStep: () => { this.simDriver.stepOnce(); this.needsRender = true; },
      onTogglePlay: () => {
        this.params.running = !this.params.running;
        this.needsRender = true;
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
      onWaterLevel: (level) => {
        // Hold a static "+N m underwater" view: floodLevelLive pins the bathtub
        // level every frame (overriding the storm), rain off for a clean snapshot.
        // Off (null) drains back to dry ground rather than leaving a frozen flood.
        this.simDriver.setLive();
        this.params.timelinePlaying = false;
        this.params.floodLevelLive = level !== null;
        if (level === null) { this.simDriver.reset(); this.params.running = false; }
        else { this.params.fillLevelM = level; this.params.raining = false; }
        this.applyParams();
        this.panel.refresh();
      },
      onPrecompute: () => {
        this.simDriver.beginPrecompute();
        this.applyParams();
        this.panel.refresh();
      },
      onScrub: () => { this.simDriver.scrub(); this.needsRender = true; },
      onTimelinePlay: () => { this.simDriver.toScrubIfReady(); this.needsRender = true; },
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

  private async applyDetectedLanguage(lang: Lang): Promise<void> {
    await loadLanguage(lang);
    setLanguage(lang, false); // auto-detected → stays re-detectable on next visit
    this.retranslateForLanguage();
    this.onLanguageChange?.(lang); // let the router refresh the shared language picker
  }

  /** Re-render every translated piece of the sim UI in the current language.
   *  The language picker lives in the router now, so it isn't touched here. */
  retranslateForLanguage(): void {
    this.addressBar.retranslate();
    this.gameUI.retranslate();
    this.scenarioUrl.translate(); // refresh the share tooltip in the new language
    applyDocumentLang();
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
    this.buildings = w.buildings;
    this.surfaceTexture = w.surfaceTexture;
    this.surfaceRaw = w.surfaceRaw;
    this.gameUI.setReady(true); // world exists — the launch button is now safe to press
    this.soil.load(this.heightmap, (ks) => {
      this.params.infiltrationMmPerHr = ks; // real Saxton-Rawls Ks for this location's soil
      this.applyParams();
      this.panel.refresh();
    });
  }

  private applyParams(): void {
    this.needsRender = true; // single choke point for every param/viz/world change
    this.group.scale.y = this.params.verticalExaggeration;
    this.buildings?.setVerticalExaggeration(this.params.verticalExaggeration);
    this.params.sorptivityM = this.soil.sorptivityM(this.params.groundwaterHigh); // soil S or undefined
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
    this.applyOverlayVisibility();
    this.heatLegend.update(this.params.terrainStyle, this.heightmap);
    this.geology.update(this.params, this.heightmap, this.surfaceRaw?.land ?? null);
    this.scenarioUrl.queueSync();
  }

  /** Toggle the optional overlay meshes + the satellite credit per the viz flags. */
  private applyOverlayVisibility(): void {
    if (this.maxFlood) this.maxFlood.mesh.visible = this.params.showMaxFlood;
    if (this.velocity) this.velocity.mesh.visible = this.params.showVelocity;
    this.buildings?.setVisible(this.params.buildings3D);
    if (this.credit) {
      const showing = this.params.terrainStyle === 'satellite' && !!this.terrain?.hasSatellite;
      this.credit.style.display = showing ? 'block' : 'none';
    }
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
      const sewer = computeSewerFields(this.heightmap, this.surfaceRaw.osm, data);
      this.sewerTexture = upsertFloatTexture(this.sewerTexture, sewer, this.heightmap.N);
      this.simDriver.setSewer(this.sewerTexture);
    } else {
      this.simDriver.setSurface(null);
      this.simDriver.setSewer(null);
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
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.lastTime) / 1000) || 0;
    this.lastTime = now;
    // GPU gone, tab hidden, parked on the landing, or the recorder is driving
    // frames itself: don't step or render (saves the battery/fan when
    // backgrounded — browsers don't throttle occluded-but-visible windows).
    if (this.scene.contextLost || document.hidden || !this.active || this.capturing) return;
    if (this.startDeferredVideoIfReady()) return; // VideoMode now drives frames itself
    if (dt > 0) this.fpsEma = this.fpsEma * 0.9 + (1 / dt) * 0.1;

    const stepped = this.simDriver.tick(dt);
    const cameraMoved = this.scene.tickControls(); // advances damping every frame; true while moving
    if (this.params.running) this.weatherClock += dt;

    // Cheap DOM-only readouts run every frame (hover info + FPS), independent of
    // the GPU render gate below.
    this.showFps(now);
    this.pointer.update(dt);

    // Render-on-demand: skip the whole two-pass + post pipeline when the frame
    // can't differ from the last (paused, idle, camera at rest, eases settled).
    const animating = this.params.running || this.scene.isSettling();
    if (!(this.needsRender || stepped || cameraMoved || animating)) return;
    this.needsRender = false;

    this.composeAndRender(dt, this.params.running, this.params.running);
  };

  /** Update the rain/storm/water look and draw one frame. `rainActive` gates the
   *  rain particles + wet-lens; `animate` advances cloud drift + lightning. The
   *  live loop ties both to `running`; the video recorder drives them itself. */
  private composeAndRender(dt: number, rainActive: boolean, animate: boolean): void {
    this.rain?.update(this.params, this.weatherClock);
    if (this.rain) this.rain.object.visible = this.params.raining && rainActive;
    this.scene.setWetness(this.params.raining && rainActive ? 0.9 : 0);
    this.scene.updateStorm(dt, animate);
    this.updateWaterLook(dt);
    this.updateDrainArrows();
    this.markerLayer.update(this.scene.camera);
    if (this.simDriver.mode === 'live') this.autoQualityCheck(dt);
    this.scene.render(this.water, this.sea);
    this.framesRendered++;
  }

  /** One unconditional frame for the video recorder (bypasses the on-demand gate);
   *  advances the weather clock so rain/clouds animate during the capture. */
  renderCaptureFrame(dt: number): void {
    this.weatherClock += dt;
    this.composeAndRender(dt, true, true);
  }

  /** Let the recorder take over (or hand back) the frame loop. */
  setCapturing(on: boolean): void {
    this.capturing = on;
    if (!on) this.lastTime = performance.now();
  }

  /** Refresh the FPS badge on its throttled cadence. */
  private showFps(now: number): void {
    this.fpsBadge.update(now, this.fpsEma);
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

    this.sea?.setFrame({ ...this.scene.frameBasis(this.resBuf), cloudColor: this.seaCloudColor });
    if (!this.water) return;
    this.water.setFrame({
      ...this.scene.frameBasis(this.resBuf),
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
    this.detachWorldMeshes();
    this.geology.dispose(this.scene.scene);
    this.simDriver.dispose();
    this.freeWorldMeshes();
  }

  /** Remove every world mesh from the render group (sea is removed + freed here
   *  since it has no separate field reset below). */
  private detachWorldMeshes(): void {
    if (this.terrain) this.group.remove(this.terrain.mesh);
    if (this.water) this.group.remove(this.water.mesh, this.water.skirt);
    if (this.sea) { this.group.remove(this.sea.mesh); this.sea.dispose(); this.sea = undefined; }
    if (this.floodOverlay) this.group.remove(this.floodOverlay.mesh);
    if (this.maxFlood) this.group.remove(this.maxFlood.mesh);
    if (this.velocity) this.group.remove(this.velocity.mesh);
    if (this.rain) this.group.remove(this.rain.object);
    if (this.buildings) this.group.remove(this.buildings.mesh);
  }

  /** Free GPU resources for the detached meshes and drop the references. */
  private freeWorldMeshes(): void {
    this.water?.dispose();
    this.floodOverlay?.dispose();
    this.maxFlood?.dispose();
    this.velocity?.dispose();
    this.rain?.dispose();
    this.buildings?.dispose();
    this.terrain?.dispose();
    this.surfaceTexture?.dispose();
    this.sewerTexture?.dispose();
    this.water = undefined;
    this.floodOverlay = undefined;
    this.maxFlood = undefined;
    this.velocity = undefined;
    this.rain = undefined;
    this.buildings = undefined;
    this.terrain = undefined;
    this.surfaceTexture = undefined;
    this.sewerTexture = undefined;
    this.surfaceRaw = undefined;
  }
}
