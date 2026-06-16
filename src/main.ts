import './styles.css';
import { App } from './app/App';
import { initAnalytics } from './analytics';
import { showToast } from './ui/toast';

const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error('Canvas #scene not found');
}

initAnalytics();

try {
  const app = new App(canvas);
  app.start();
  if (import.meta.env.DEV) (window as unknown as { app: App }).app = app;
} catch (err) {
  console.error(err);
  showToast(`Failed to start: ${(err as Error).message}`, true, 0);
}
