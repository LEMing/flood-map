import './styles.css';
import { App } from './app/App';
import { initAnalytics } from './analytics';
import { getLanguage, loadLanguage } from './i18n';
import { showToast } from './ui/toast';

const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error('Canvas #scene not found');
}

initAnalytics();

try {
  // Pull the active locale's lazy chunk in before the first render so the UI
  // builds translated (not an English flash). English is bundled as the fallback.
  await loadLanguage(getLanguage());
  const app = new App(canvas);
  app.start();
  if (import.meta.env.DEV) (window as unknown as { app: App }).app = app;
} catch (err) {
  console.error(err);
  showToast(`Failed to start: ${(err as Error).message}`, true, 0);
}
