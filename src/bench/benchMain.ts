import { runBench } from './webgpuBench';

const btn = document.getElementById('run') as HTMLButtonElement | null;
const results = document.getElementById('results') as HTMLElement | null;

if (btn && results) {
  btn.addEventListener('click', () => {
    btn.disabled = true;
    void runBench(results).finally(() => {
      btn.disabled = false;
    });
  });
}
