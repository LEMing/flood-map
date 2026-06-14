import { Pane } from 'tweakpane';
import { STORM_LABELS, type Params } from '../config';
import type { StatsData } from './stats';

const STORM_OPTIONS = Object.fromEntries(
  Object.entries(STORM_LABELS).map(([value, label]) => [label, value]),
);

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
    this.pane = new Pane({ title: 'Flood Map' });
    const change = () => cb.onParamChange();

    // --- Simulation controls ---
    const sim = this.pane.addFolder({ title: 'Simulation', expanded: true });
    this.playButton = sim.addButton({ title: params.running ? 'Pause ⏸' : 'Play ▶' });
    (this.playButton as ReturnType<Pane['addButton']>).on('click', () => {
      cb.onTogglePlay();
      this.refreshPlay(params);
    });
    sim.addButton({ title: 'Step ⏭' }).on('click', () => cb.onStep());
    sim.addButton({ title: 'Reset ⟳' }).on('click', () => cb.onReset());
    sim.addBinding(params, 'releaseDepthM', { min: 0.5, max: 15, step: 0.5, label: 'dump depth (m)' });
    sim.addButton({ title: 'Dump water 💧 (flash flood)' }).on('click', () => cb.onDump());
    sim.addBinding(params, 'fillLevelM', { min: 0, max: 50, step: 0.1, label: 'flood level (+m)' }).on('change', change);
    sim.addBinding(params, 'floodLevelLive', { label: 'live flood level' }).on('change', change);
    sim.addButton({ title: 'Fill to level 🌊 (one-shot)' }).on('click', () => cb.onFill());
    sim.addBinding(params, 'timeScale', { min: 1, max: 3000, step: 1, label: 'time × (sim s/s)' }).on('change', change);
    sim.addBinding(params, 'substeps', { min: 1, max: 12, step: 1, label: 'substeps' }).on('change', change);

    // --- Rain ---
    const rain = this.pane.addFolder({ title: 'Rain', expanded: true });
    rain.addBinding(params, 'raining', { label: 'raining' }).on('change', change);
    rain.addBinding(params, 'stormType', { label: 'storm event', options: STORM_OPTIONS }).on('change', () => { change(); cb.onReset(); });
    rain.addBinding(params, 'storm', { label: 'clouds ⛈ + lightning' }).on('change', change);
    rain.addBinding(params, 'intensityMmPerHr', { min: 0, max: 400, step: 1, label: 'constant mm/hr' }).on('change', change);
    rain.addBinding(params, 'rainFootprint', { label: 'footprint', options: { Uniform: 'uniform', 'Storm cell': 'spot' } }).on('change', change);
    rain.addBinding(params, 'spotX', { min: 0, max: 1, step: 0.01, label: 'cell x' }).on('change', change);
    rain.addBinding(params, 'spotY', { min: 0, max: 1, step: 0.01, label: 'cell y' }).on('change', change);
    rain.addBinding(params, 'spotRadius', { min: 0.02, max: 0.6, step: 0.01, label: 'cell radius' }).on('change', change);

    // --- Urban surface model (land cover + OSM) ---
    const urban = this.pane.addFolder({ title: 'Urban model', expanded: true });
    urban.addBinding(params, 'useSurface', { label: 'surface model' }).on('change', () => cb.onRebuild());
    urban.addBinding(params, 'burnBuildings', { label: 'buildings as walls' }).on('change', () => cb.onRebuild());
    urban.addBinding(params, 'drainageCapacityMmPerHr', { min: 0, max: 60, step: 1, label: 'storm sewer (mm/hr)' }).on('change', change);
    urban.addBinding(params, 'groundwaterHigh', { label: 'high groundwater' }).on('change', change);

    // --- Soil / atmosphere ---
    const soil = this.pane.addFolder({ title: 'Soil & evaporation', expanded: false });
    soil.addBinding(params, 'infiltrationMmPerHr', { min: 0, max: 100, step: 1, label: 'soil infiltr. (mm/hr)' }).on('change', change);
    soil.addBinding(params, 'evaporationPerHr', { min: 0, max: 1, step: 0.01, label: 'evaporation (/hr)' }).on('change', change);

    // --- Physics ---
    const phys = this.pane.addFolder({ title: 'Physics', expanded: false });
    phys.addBinding(params, 'gravity', { min: 1, max: 25, step: 0.01, label: 'gravity (m/s²)' }).on('change', change);
    phys.addBinding(params, 'pipeArea', { min: 0.1, max: 4, step: 0.05, label: 'flow coefficient' }).on('change', change);
    phys.addBinding(params, 'friction', { min: 0, max: 1, step: 0.01, label: 'friction' }).on('change', change);
    phys.addBinding(params, 'boundary', { label: 'edges', options: { 'Open (drains)': 'open', 'Closed (walls)': 'closed' } }).on('change', change);

    // --- Map (requires rebuild) ---
    const map = this.pane.addFolder({ title: 'Map (reload)', expanded: false });
    map.addBinding(params, 'elevationSource', {
      label: 'elevation',
      options: { 'Copernicus GLO-30': 'glo30', 'FABDEM (bare-earth)': 'fabdem', 'SRTM (terrarium)': 'terrarium' },
    }).on('change', () => cb.onRebuild());
    map.addBinding(params, 'mapSizeKm', { min: 0.5, max: 20, step: 0.5, label: 'size (km)' });
    map.addBinding(params, 'gridResolution', { label: 'grid', options: { '128': 128, '256': 256, '512': 512, '1024': 1024 } });
    map.addButton({ title: 'Apply size / grid ⟲' }).on('click', () => cb.onRebuild());

    // --- Visualization ---
    const viz = this.pane.addFolder({ title: 'Visualization', expanded: false });
    viz.addBinding(params, 'terrainStyle', {
      label: 'terrain',
      options: { Satellite: 'satellite', 'Elevation tint': 'hypsometric', 'Height heatmap': 'heatmap', 'Surface (flood risk)': 'surface' },
    }).on('change', change);
    viz.addBinding(params, 'imageryDarkening', { min: 0, max: 1, step: 0.05, label: 'depth darkening' }).on('change', change);
    viz.addBinding(params, 'verticalExaggeration', { min: 1, max: 5, step: 0.1, label: 'vertical ×' }).on('change', change);
    viz.addBinding(params, 'waterOpacity', { min: 0.1, max: 1, step: 0.01, label: 'water opacity' }).on('change', change);
    viz.addBinding(params, 'depthColorMax', { min: 0.2, max: 10, step: 0.1, label: 'depth color max (m)' }).on('change', change);
    viz.addBinding(params, 'showMaxFlood', { label: 'max flood extent' }).on('change', change);
    viz.addBinding(params, 'showVelocity', { label: 'flow arrows' }).on('change', change);
    viz.addBinding(params, 'wireframe', { label: 'wireframe terrain' }).on('change', change);

    // --- Stats (read-only) ---
    const s = this.pane.addFolder({ title: 'Stats', expanded: true });
    s.addBinding(stats, 'location', { readonly: true, label: 'location' });
    s.addBinding(stats, 'simTime', { readonly: true, label: 'sim time' });
    s.addBinding(stats, 'rained', { readonly: true, label: 'rain in' });
    s.addBinding(stats, 'stored', { readonly: true, label: 'water stored' });
    s.addBinding(stats, 'floodedArea', { readonly: true, label: 'flooded area' });
    s.addBinding(stats, 'maxDepth', { readonly: true, label: 'max depth' });
    s.addBinding(stats, 'fps', { readonly: true, label: 'fps' });
  }

  private refreshPlay(params: Params): void {
    this.playButton.title = params.running ? 'Pause ⏸' : 'Play ▶';
    this.pane.refresh();
  }

  refresh(): void {
    this.pane.refresh();
  }
}
