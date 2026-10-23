// PixiJS without runtime code generation, so the strict Content-Security-Policy
// (no 'unsafe-eval') served by nginx.conf works.
import 'pixi.js/unsafe-eval';
import '../styles/main.css';
import { GameController } from './game-controller';

function showBootError(root: HTMLElement, message: string): void {
  const p = document.createElement('p');
  p.className = 'boot-error';
  p.textContent = message;
  root.replaceChildren(p);
}

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;
  if (
    typeof Promise === 'undefined' ||
    typeof requestAnimationFrame !== 'function' ||
    !('crypto' in window)
  ) {
    showBootError(root, 'Bu tarayıcı desteklenmiyor. Lütfen güncel bir tarayıcı kullanın.');
    return;
  }
  try {
    await new GameController(root).init();
  } catch (err) {
    console.error(err);
    showBootError(root, 'Oyun yüklenemedi. Sayfayı yenilemeyi deneyin.');
  }
}

/**
 * Offline play: register the service worker in production builds served over
 * HTTPS (or localhost). Test runs (`?e2e`) skip it so every run starts clean.
 */
function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  if (new URLSearchParams(location.search).has('e2e')) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err: unknown) => {
      console.warn('Çevrimdışı oyun etkinleştirilemedi', err);
    });
  });
}

registerServiceWorker();
void boot();
