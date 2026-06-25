import { MiniFlood } from './MiniFlood';
import { LabWorld } from './LabWorld';
import { rioSpec } from './labRio';
import { krasnodarSpec } from './labKrasnodar';
import { TopView } from './TopView';
import { UrbanView } from './UrbanView';

// Mount the landing's interactive physics labs onto their containers, if present:
// the Rio topography lab (relief-driven flooding) and the flat-city lab (buildings +
// street grid driving the flood). Each pairs one LabWorld with its renderer.
export function initLabs(): MiniFlood[] {
  const labs: MiniFlood[] = [];
  const rio = document.getElementById('lp-lab');
  if (rio) { const w = new LabWorld(rioSpec()); labs.push(new MiniFlood(rio, w, new TopView(w))); }
  const city = document.getElementById('lp-lab-city');
  if (city) { const w = new LabWorld(krasnodarSpec()); labs.push(new MiniFlood(city, w, new UrbanView(w))); }
  return labs;
}
