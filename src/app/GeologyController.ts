import * as THREE from 'three';
import type { Params } from '../config';
import type { Heightmap } from '../geo/heightmap';
import { t } from '../i18n';
import {
  defaultColumns, buildColumns, buildRegionalColumns, buildMarineRegionalColumns,
  findRegional, findRegionalMarine, type GeoColumns, type GeoLayer,
} from '../geo/geology';
import { getCrust1Cell } from '../geo/crust1';
import { coarseSeabedElevM } from '../geo/oceanDepth';
import { fetchSoilProfile } from '../geo/soilgrids';
import { GeologyBlock } from '../render/GeologyBlock';

/** Owns the subsurface cross-section block, its column data, soil fetch, and legend DOM. */
export class GeologyController {
  private block?: GeologyBlock;
  private columns: GeoColumns = defaultColumns();
  private legend: HTMLDivElement | null = null;
  private soilRequested = false;
  private soilFetchToken = 0;

  get mesh(): THREE.Mesh | undefined {
    return this.block?.mesh;
  }

  /** (Re)create the block for a freshly built world. */
  build(heightmap: Heightmap, surfaceLand: Uint8Array | null): GeologyBlock {
    this.block = new GeologyBlock(heightmap, surfaceLand);
    this.columns = defaultColumns();
    this.soilRequested = false;
    return this.block;
  }

  dispose(scene: THREE.Scene): void {
    if (!this.block) return;
    scene.remove(this.block.mesh);
    this.block.dispose();
    this.block = undefined;
  }

  /** Update the subsurface cross-section block + legend from current params. */
  update(params: Params, heightmap: Heightmap | undefined, surfaceLand: Uint8Array | null): void {
    if (!this.block || !heightmap) return;
    const on = params.showGeology;
    this.block.setVisible(on);
    if (this.legend) this.legend.classList.toggle('visible', on);
    if (!on) return;
    if (!this.soilRequested) {
      this.soilRequested = true;
      this.fetchGeology(params, heightmap, surfaceLand);
    }
    this.block.update({
      verticalExaggeration: params.verticalExaggeration,
      worldHeight: heightmap.sizeMeters * params.subsurfaceScale,
      depthShownM: params.geologyDepthKm * 1000,
      seaLevelM: params.seaLevelM,
      land: this.columns.land,
      marine: this.columns.marine,
      oceanCell: this.columns.isOcean,
      oceanWaterDepthM: this.columns.oceanWaterDepthM,
      waterTableM: params.waterTableDepthM,
      showWaterTable: params.showWaterTable,
      highlightAquiclude: params.highlightAquiclude,
    });
    this.renderLegend(params);
  }

  /** Build the column for this location: CRUST1.0 cell (global) + live SoilGrids topsoil on land. */
  private fetchGeology(params: Params, hm: Heightmap, surfaceLand: Uint8Array | null): void {
    const token = ++this.soilFetchToken;
    const ci = Math.floor(hm.N / 2) * hm.N + Math.floor(hm.N / 2);
    const centreElev = hm.data[ci];
    const land = surfaceLand;
    const centreWater = land ? land[ci] === 80 : false;
    const sea = params.seaLevelM;

    getCrust1Cell(hm.center.lat, hm.center.lon)
      .then(async (cell0) => {
        if (token !== this.soilFetchToken || !cell0) return undefined; // keep the neutral default
        // The map DEM reads a flat 0 m over water, so a coarse terrarium tile (which
        // still carries the GEBCO/ETOPO seabed) is the authoritative "is this at sea"
        // signal and yields the real water depth; the 1° CRUST1.0 flag and land-cover
        // are fallbacks (the cell flag mis-classifies coastal cells, e.g. SF as sea).
        const seabedElev = await coarseSeabedElevM(hm.center.lat, hm.center.lon);
        if (token !== this.soilFetchToken) return undefined;
        // Coarse GEBCO/ETOPO bathymetry is the authoritative sea/land signal: the
        // bare-earth DEM returns nodata garbage over open water (e.g. ~987 m mid
        // Black Sea), so centreElev can't be trusted there. Fall back to the fine
        // DEM + land-cover + 1° flag only when no bathymetry tile is available.
        const bathyKnown = Number.isFinite(seabedElev);
        const realOcean = bathyKnown
          ? seabedElev < sea - 2
          : centreElev > sea + 1 ? false : centreWater || cell0.isOcean;
        // Prefer a published regional column: land stratigraphy onshore, the
        // sea's sub-seabed column offshore; fall back to the coarse CRUST1.0 cell.
        const region = realOcean ? null : findRegional(hm.center.lat, hm.center.lon);
        const marineRegion = realOcean ? findRegionalMarine(hm.center.lat, hm.center.lon) : null;
        return getCrust1Cell(hm.center.lat, hm.center.lon, realOcean ? 'ocean' : 'land').then((cell) => {
          if (token !== this.soilFetchToken || !cell) return;
          const build = (soil: GeoLayer[] | null): GeoColumns => {
            if (region) return buildRegionalColumns(region, soil, cell);
            if (marineRegion) return buildMarineRegionalColumns(marineRegion, cell);
            return buildColumns(cell, soil, realOcean);
          };
          this.columns = build(null);
          if (realOcean && bathyKnown) {
            this.columns.oceanWaterDepthM = sea - seabedElev;
          }
          if (params.showGeology) this.update(params, hm, surfaceLand);
          if (realOcean) return; // no soil at sea
          void fetchSoilProfile(hm.center.lat, hm.center.lon).then((soil) => {
            if (token !== this.soilFetchToken || !soil) return;
            this.columns = build(soil);
            if (params.showGeology) this.update(params, hm, surfaceLand);
          });
        });
      })
      .catch(() => { /* keep the neutral default column */ });
  }

  /** The column whose legend to show — marine for an offshore centre, else land. */
  private centreColumn(): GeoColumns['land'] {
    return this.columns.isOcean ? this.columns.marine : this.columns.land;
  }

  private renderLegend(params: Params): void {
    if (!this.legend) {
      this.legend = document.createElement('div');
      this.legend.id = 'geo-legend';
      const dock = document.getElementById('chrome-panel') ?? document.body;
      dock.appendChild(this.legend);
    }
    const el = this.legend;
    const depthShownM = params.geologyDepthKm * 1000;
    const rows = this.legendRows().filter((r) => r.topM < depthShownM + 1);
    const fmt = (a: number, b: number): string => (b < 1000
      ? `${a < 10 ? a : Math.round(a)}–${b < 10 ? b : Math.round(b)} m`
      : `${(a / 1000).toFixed(a < 1000 ? 1 : 0)}–${(b / 1000).toFixed(1)} km`);
    const tag = (s: string): string => (s === 'soilgrids' ? t('geo.real') : t('geo.model'));
    const items = rows.map((r) => {
      const sw = `<span class="sw" style="background:#${r.hex.toString(16).padStart(6, '0')}"></span>`;
      return `<div class="row">${sw}<span class="nm">${r.name}</span>`
        + `<span class="dp">${fmt(r.topM, r.botM)}</span><span class="tg ${r.source}">${tag(r.source)}</span></div>`;
    }).join('');
    const isOcean = this.columns.isOcean;
    const seaRow = isOcean
      ? `<div class="row"><span class="sw" style="background:#2a6e96"></span>`
        + `<span class="nm">${t('geo.l.seaWater')}</span><span class="dp">${fmt(0, this.columns.oceanWaterDepthM)}</span>`
        + `<span class="tg model">${t('geo.model')}</span></div>`
      : '';
    const wt = !isOcean && params.showWaterTable
      ? `<div class="row wt"><span class="sw" style="background:#3fb6e0"></span>`
        + `<span class="nm">${t('geo.waterTable')}</span><span class="dp">${Math.round(params.waterTableDepthM)} m</span></div>`
      : '';
    const region = this.columns.regionName;
    const title = region ? `${t('geo.legendTitle')} · ${region}` : t('geo.legendTitle');
    el.innerHTML = `<div class="title">${title}</div>${seaRow}${items}${wt}`
      + `<div class="caveat">${t('geo.caveat')}</div>`;
  }

  /** Legend rows: collapse the SoilGrids sub-bands into one "topsoil (real)" row. */
  private legendRows(): Array<{ name: string; topM: number; botM: number; hex: number; source: string }> {
    const column = this.centreColumn();
    const layers = column.layers;
    const soil = layers.filter((l) => l.source === 'soilgrids');
    const rest: GeoLayer[] = layers.filter((l) => l.source !== 'soilgrids');
    const out: Array<{ name: string; topM: number; botM: number; hex: number; source: string }> = [];
    if (soil.length) {
      out.push({ name: t('geo.l.topsoil'), topM: 0, botM: soil[soil.length - 1].botM, hex: soil[0].hex, source: 'soilgrids' });
    }
    for (const l of rest) {
      if (l.key === 'subsoil' && column.soilReal) continue; // covered by the real soil row
      out.push({ name: l.name ?? t(`geo.l.${l.key}`), topM: l.topM, botM: l.botM, hex: l.hex, source: l.source });
    }
    return out;
  }
}
