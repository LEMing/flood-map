import { Pane } from 'tweakpane';
import { STORM_LABELS, type Params, type StormType } from '../config';
import { t } from '../i18n';
import type { StatsData } from './stats';

const STORM_TYPES = Object.keys(STORM_LABELS) as StormType[];

function stormOptions(): Record<string, StormType> {
  return Object.fromEntries(STORM_TYPES.map((value) => [t(`storm.${value}`), value]));
}

export interface ControlCallbacks {
  onParamChange(): void; // live params (rain, physics, viz)
  onRebuild(): void; // map size / grid resolution change -> reload terrain
  onReset(): void;
  onStep(): void;
  onTogglePlay(): void;
  onDump(): void; // pour a one-shot batch of water
  onFill(): void; // flood ground up to a chosen level
}

export class ControlsPanel {
  private readonly pane: Pane;
  private readonly playButton: { title: string };

  constructor(params: Params, stats: StatsData, cb: ControlCallbacks) {
    this.pane = new Pane({ title: t('panel.title') });
    const change = () => cb.onParamChange();

    // --- Simulation controls ---
    const sim = this.pane.addFolder({ title: t('sim.title'), expanded: true });
    this.playButton = sim.addButton({ title: params.running ? t('sim.pause') : t('sim.play') });
    (this.playButton as ReturnType<Pane['addButton']>).on('click', () => {
      cb.onTogglePlay();
      this.refreshPlay(params);
    });
    sim.addButton({ title: t('sim.step') }).on('click', () => cb.onStep());
    sim.addButton({ title: t('sim.reset') }).on('click', () => cb.onReset());
    sim.addBinding(params, 'releaseDepthM', { min: 0.5, max: 15, step: 0.5, label: t('sim.dumpDepth') });
    sim.addButton({ title: t('sim.dump') }).on('click', () => cb.onDump());
    sim.addBinding(params, 'fillLevelM', { min: 0, max: 50, step: 0.1, label: t('sim.floodLevel') }).on('change', change);
    sim.addBinding(params, 'floodLevelLive', { label: t('sim.liveFlood') }).on('change', change);
    sim.addButton({ title: t('sim.fill') }).on('click', () => cb.onFill());
    sim.addBinding(params, 'timeScale', { min: 1, max: 3000, step: 1, label: t('sim.timescale') }).on('change', change);
    sim.addBinding(params, 'substeps', { min: 1, max: 12, step: 1, label: t('sim.substeps') }).on('change', change);

    // --- Rain ---
    const rain = this.pane.addFolder({ title: t('rain.title'), expanded: true });
    rain.addBinding(params, 'raining', { label: t('rain.raining') }).on('change', change);
    rain.addBinding(params, 'stormType', { label: t('rain.stormEvent'), options: stormOptions() }).on('change', () => { change(); cb.onReset(); });
    rain.addBinding(params, 'storm', { label: t('rain.clouds') }).on('change', change);
    rain.addBinding(params, 'intensityMmPerHr', { min: 0, max: 400, step: 1, label: t('rain.constant') }).on('change', change);
    rain.addBinding(params, 'rainFootprint', { label: t('rain.footprint'), options: { [t('rain.footprintUniform')]: 'uniform', [t('rain.footprintSpot')]: 'spot' } }).on('change', change);
    rain.addBinding(params, 'spotX', { min: 0, max: 1, step: 0.01, label: t('rain.cellX') }).on('change', change);
    rain.addBinding(params, 'spotY', { min: 0, max: 1, step: 0.01, label: t('rain.cellY') }).on('change', change);
    rain.addBinding(params, 'spotRadius', { min: 0.02, max: 0.6, step: 0.01, label: t('rain.cellRadius') }).on('change', change);

    // --- Urban surface model (land cover + OSM) ---
    const urban = this.pane.addFolder({ title: t('urban.title'), expanded: true });
    urban.addBinding(params, 'useSurface', { label: t('urban.surface') }).on('change', () => cb.onRebuild());
    urban.addBinding(params, 'burnBuildings', { label: t('urban.buildings') }).on('change', () => cb.onRebuild());
    urban.addBinding(params, 'drainageCapacityMmPerHr', { min: 0, max: 60, step: 1, label: t('urban.sewer') }).on('change', change);
    urban.addBinding(params, 'groundwaterHigh', { label: t('urban.groundwater') }).on('change', change);

    // --- Soil / atmosphere ---
    const soil = this.pane.addFolder({ title: t('soil.title'), expanded: false });
    soil.addBinding(params, 'infiltrationMmPerHr', { min: 0, max: 100, step: 1, label: t('soil.infiltration') }).on('change', change);
    soil.addBinding(params, 'evaporationPerHr', { min: 0, max: 1, step: 0.01, label: t('soil.evaporation') }).on('change', change);

    // --- Physics ---
    const phys = this.pane.addFolder({ title: t('physics.title'), expanded: false });
    phys.addBinding(params, 'gravity', { min: 1, max: 25, step: 0.01, label: t('physics.gravity') }).on('change', change);
    phys.addBinding(params, 'pipeArea', { min: 0.1, max: 4, step: 0.05, label: t('physics.flow') }).on('change', change);
    phys.addBinding(params, 'friction', { min: 0, max: 1, step: 0.01, label: t('physics.friction') }).on('change', change);
    phys.addBinding(params, 'boundary', { label: t('physics.edges'), options: { [t('physics.edgesOpen')]: 'open', [t('physics.edgesClosed')]: 'closed' } }).on('change', change);

    // --- Map (requires rebuild) ---
    const map = this.pane.addFolder({ title: t('map.title'), expanded: false });
    map.addBinding(params, 'elevationSource', {
      label: t('map.elevation'),
      options: { 'Copernicus GLO-30': 'glo30', 'FABDEM (bare-earth)': 'fabdem', 'SRTM (terrarium)': 'terrarium' },
    }).on('change', () => cb.onRebuild());
    map.addBinding(params, 'mapSizeKm', { min: 0.5, max: 20, step: 0.5, label: t('map.size') });
    map.addBinding(params, 'gridResolution', { label: t('map.grid'), options: { '128': 128, '256': 256, '512': 512, '1024': 1024 } });
    map.addButton({ title: t('map.apply') }).on('click', () => cb.onRebuild());

    // --- Visualization ---
    const viz = this.pane.addFolder({ title: t('viz.title'), expanded: false });
    viz.addBinding(params, 'terrainStyle', {
      label: t('viz.terrain'),
      options: { [t('viz.terrainSatellite')]: 'satellite', [t('viz.terrainHypso')]: 'hypsometric', [t('viz.terrainHeatmap')]: 'heatmap', [t('viz.terrainSurface')]: 'surface' },
    }).on('change', change);
    viz.addBinding(params, 'imageryDarkening', { min: 0, max: 1, step: 0.05, label: t('viz.darkening') }).on('change', change);
    viz.addBinding(params, 'verticalExaggeration', { min: 1, max: 5, step: 0.1, label: t('viz.vertical') }).on('change', change);
    viz.addBinding(params, 'waterOpacity', { min: 0.1, max: 1, step: 0.01, label: t('viz.opacity') }).on('change', change);
    viz.addBinding(params, 'depthColorMax', { min: 0.2, max: 10, step: 0.1, label: t('viz.depthMax') }).on('change', change);
    viz.addBinding(params, 'showMaxFlood', { label: t('viz.maxFlood') }).on('change', change);
    viz.addBinding(params, 'showVelocity', { label: t('viz.arrows') }).on('change', change);
    viz.addBinding(params, 'wireframe', { label: t('viz.wireframe') }).on('change', change);
    viz.addBinding(params, 'waterQuality', {
      label: t('viz.waterQuality'),
      options: { [t('viz.qLow')]: 'low', [t('viz.qMedium')]: 'medium', [t('viz.qHigh')]: 'high' },
    }).on('change', change);
    viz.addBinding(params, 'waterReflections', { label: t('viz.reflections') }).on('change', change);
    viz.addBinding(params, 'waterRefraction', { label: t('viz.refraction') }).on('change', change);
    viz.addBinding(params, 'rippleStrength', { min: 0, max: 1, step: 0.01, label: t('viz.ripples') }).on('change', change);
    viz.addBinding(params, 'flowSpeed', { min: 0, max: 3, step: 0.05, label: t('viz.flowSpeed') }).on('change', change);
    viz.addBinding(params, 'foamAmount', { min: 0, max: 1, step: 0.01, label: t('viz.foam') }).on('change', change);
    viz.addBinding(params, 'sunGlint', { min: 0, max: 2, step: 0.05, label: t('viz.glint') }).on('change', change);
    viz.addBinding(params, 'shorelineSoftness', { min: 0, max: 5, step: 0.1, label: t('viz.shoreline') }).on('change', change);
    viz.addBinding(params, 'skirtEnabled', { label: t('viz.skirt') }).on('change', change);
    viz.addBinding(params, 'floodOverlay', { label: t('viz.floodOverlay') }).on('change', change);
    viz.addBinding(params, 'floodGrid', { label: t('viz.floodGrid') }).on('change', change);

    // --- Atmosphere / post-processing ---
    const atmo = this.pane.addFolder({ title: t('atmo.title'), expanded: false });
    atmo.addBinding(params, 'postProcessing', { label: t('atmo.post') }).on('change', change);
    atmo.addBinding(params, 'exposure', { min: 0.3, max: 2.0, step: 0.01, label: t('atmo.exposure') }).on('change', change);
    atmo.addBinding(params, 'bloom', { min: 0, max: 2, step: 0.01, label: t('atmo.bloom') }).on('change', change);
    atmo.addBinding(params, 'ssao', { label: t('atmo.ssao') }).on('change', change);
    atmo.addBinding(params, 'vignette', { min: 0, max: 1, step: 0.01, label: t('atmo.vignette') }).on('change', change);
    atmo.addBinding(params, 'wetness', { min: 0, max: 1, step: 0.01, label: t('atmo.wetness') }).on('change', change);
    atmo.addBinding(params, 'cloudShadows', { min: 0, max: 1, step: 0.01, label: t('atmo.cloudShadows') }).on('change', change);
    atmo.addBinding(params, 'godRays', { min: 0, max: 1, step: 0.01, label: t('atmo.godRays') }).on('change', change);
    atmo.addBinding(params, 'groundHaze', { min: 0, max: 1, step: 0.01, label: t('atmo.haze') }).on('change', change);
    atmo.addBinding(params, 'rainSplashes', { label: t('atmo.splashes') }).on('change', change);

    // --- Stats (read-only) ---
    const s = this.pane.addFolder({ title: t('stats.title'), expanded: true });
    s.addBinding(stats, 'location', { readonly: true, label: t('stats.location') });
    s.addBinding(stats, 'simTime', { readonly: true, label: t('stats.simTime') });
    s.addBinding(stats, 'rained', { readonly: true, label: t('stats.rainIn') });
    s.addBinding(stats, 'stored', { readonly: true, label: t('stats.stored') });
    s.addBinding(stats, 'floodedArea', { readonly: true, label: t('stats.flooded') });
    s.addBinding(stats, 'maxDepth', { readonly: true, label: t('stats.maxDepth') });
    s.addBinding(stats, 'fps', { readonly: true, label: t('stats.fps') });
  }

  private refreshPlay(params: Params): void {
    this.playButton.title = params.running ? t('sim.pause') : t('sim.play');
    this.pane.refresh();
  }

  refresh(): void {
    this.pane.refresh();
  }

  dispose(): void {
    this.pane.dispose();
  }
}
