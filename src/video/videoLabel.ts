import * as THREE from 'three';
import { readUrlState } from '../url';
import { shortPlaceName } from '../geo/geocode';

// A minimalist corner label baked into the recorded clip: the place name + a
// short link back to where it was generated. Drawn on a 2D canvas, shown as a
// textured quad rendered over the scene during capture (SceneManager.renderOverlay).

const SHARE_HOST = 'krd-flood.web.app'; // canonical public site (not the dev/staging host)

export interface VideoLabel {
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  dispose(): void;
}

/** Build the label overlay sized to the capture buffer (W×H drawing-buffer px). */
export function buildVideoLabel(placeName: string, bufferW: number, bufferH: number): VideoLabel {
  const card = drawLabelCard(shortPlaceName(placeName), shareUrl(), bufferH);

  const tex = new THREE.CanvasTexture(card);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;

  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const geo = new THREE.PlaneGeometry(card.width, card.height);
  const mesh = new THREE.Mesh(geo, mat);
  const margin = Math.round(bufferH * 0.035);
  mesh.position.set(margin + card.width / 2, margin + card.height / 2, 0); // bottom-left (y-up)

  const scene = new THREE.Scene();
  scene.add(mesh);
  const camera = new THREE.OrthographicCamera(0, bufferW, bufferH, 0, -1, 1);

  return {
    scene,
    camera,
    dispose() { geo.dispose(); mat.dispose(); tex.dispose(); },
  };
}

function shareUrl(): string {
  const u = readUrlState();
  const p = new URLSearchParams();
  if (u.lat !== undefined) p.set('lat', u.lat.toFixed(4));
  if (u.lon !== undefined) p.set('lon', u.lon.toFixed(4));
  if (u.km !== undefined) p.set('km', String(u.km));
  return `${SHARE_HOST}/sim?${p.toString()}`;
}

function drawLabelCard(place: string, url: string, bufferH: number): HTMLCanvasElement {
  const titlePx = Math.round(bufferH * 0.026);
  const urlPx = Math.round(bufferH * 0.018);
  const padX = Math.round(titlePx * 0.95);
  const padY = Math.round(titlePx * 0.62);
  const gap = Math.round(titlePx * 0.34);
  const titleFont = `600 ${titlePx}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const urlFont = `500 ${urlPx}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const placeText = `📍 ${place}`;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.font = titleFont;
  const tw = ctx.measureText(placeText).width;
  ctx.font = urlFont;
  const uw = ctx.measureText(url).width;

  const contentW = Math.max(tw, uw);
  canvas.width = Math.ceil(contentW + padX * 2);
  canvas.height = Math.ceil(titlePx + gap + urlPx + padY * 2);

  // Subtle glass backing for legibility over bright/dark scenes alike.
  const radius = Math.round(canvas.height * 0.22);
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, radius);
  ctx.fillStyle = 'rgba(9, 13, 19, 0.46)';
  ctx.fill();

  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = Math.round(titlePx * 0.22);
  ctx.fillStyle = '#ffffff';
  ctx.font = titleFont;
  ctx.fillText(placeText, padX, padY);

  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(206, 222, 240, 0.82)';
  ctx.font = urlFont;
  ctx.fillText(url, padX, padY + titlePx + gap);

  return canvas;
}
