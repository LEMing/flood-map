import { t } from '../i18n';
import type { Heightmap } from '../geo/heightmap';

/** The elevation heatmap legend (min/max swatch labels). Shown only in the
 *  'heatmap' terrain style; reads the live heightmap's range. */
export class HeatLegend {
  private readonly root = document.getElementById('legend') as HTMLDivElement | null;
  private readonly minEl = document.getElementById('legend-min');
  private readonly maxEl = document.getElementById('legend-max');

  update(terrainStyle: string, heightmap: Heightmap | undefined): void {
    if (!this.root) return;
    const show = terrainStyle === 'heatmap' && !!heightmap;
    this.root.style.display = show ? 'block' : 'none';
    if (!show || !heightmap) return;
    const title = this.root.querySelector('.title');
    if (title) title.textContent = t('legend.elevation');
    if (this.minEl) this.minEl.textContent = `${heightmap.min.toFixed(0)} m`;
    if (this.maxEl) this.maxEl.textContent = `${heightmap.max.toFixed(0)} m`;
  }
}
