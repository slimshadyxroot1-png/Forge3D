import * as THREE from 'three';
import { save } from '../io/Exporter.js';

const SIZE = 1024;

// copy of a rectangle of an image
function crop(img, x, y, w, h) {
  const out = new ImageData(w, h);
  for (let j = 0; j < h; j++) out.data.set(img.data.subarray(((y + j) * img.width + x) * 4, ((y + j) * img.width + x + w) * 4), j * w * 4);
  return out;
}

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}, ${a})`;
};

// paints straight into the image of the mesh
export class TexPaint {
  constructor(app) {
    this.app = app;
    this.opt = { color: '#d9402b', radius: 24, strength: 1, erase: false };
    const dom = app.engine.renderer.domElement;
    dom.addEventListener('pointerdown', e => this.down(e));
    dom.addEventListener('pointermove', e => { if (this.mesh && e.buttons & 1) this.dab(e); });
    addEventListener('pointerup', () => this.up());
  }

  // the canvas that holds the painting
  canvas(mesh) {
    const m = mesh.material;
    if (m.map?.userData.canvas) return m.map.userData.canvas;
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const x = c.getContext('2d'), old = m.map?.image;
    x.fillStyle = '#' + m.color.getHexString();
    x.fillRect(0, 0, SIZE, SIZE);
    if (old && old.width) x.drawImage(old, 0, 0, SIZE, SIZE); // keep an image that was loaded before
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.userData.canvas = c;
    m.map = tex;
    m.color.set(0xffffff);
    m.needsUpdate = true;
    return c;
  }

  down(e) {
    const a = this.app, m = a.sel, eng = a.engine;
    if (e.button !== 0 || a.mode !== 'texpaint' || e.altKey || eng.space || !m?.isMesh) return;
    if (!eng.hit(e, m)) return; // a click next to the mesh moves the camera
    if (!m.geometry.attributes.uv) return a.say('Unwrap the mesh first (UV Editing)');
    this.mesh = m;
    this.ctx = this.canvas(m).getContext('2d');
    this.before = this.ctx.getImageData(0, 0, SIZE, SIZE);
    this.box = null;
    this.last = null;
    this.dab(e);
  }

  dab(e) {
    const hit = this.app.engine.hit(e, this.mesh), o = this.opt;
    if (!hit?.uv) return;
    const x = hit.uv.x * SIZE, y = (1 - hit.uv.y) * SIZE, r = o.radius;
    if (this.last && Math.hypot(x - this.last[0], y - this.last[1]) < r * 0.25) return;
    this.last = [x, y];
    const color = o.erase ? '#ffffff' : o.color, g = this.ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(color, o.strength));
    g.addColorStop(1, rgba(color, 0));
    this.ctx.fillStyle = g;
    this.ctx.fillRect(x - r, y - r, r * 2, r * 2);
    const b = this.box || [x, y, x, y];
    this.box = [Math.min(b[0], x - r), Math.min(b[1], y - r), Math.max(b[2], x + r), Math.max(b[3], y + r)];
    this.mesh.material.map.needsUpdate = true;
    this.app.engine.invalidate();
  }

  up() {
    if (!this.mesh) return;
    const mesh = this.mesh, ctx = this.ctx, b = this.box;
    this.mesh = null;
    if (!b) return;
    const x = Math.max(0, Math.floor(b[0])), y = Math.max(0, Math.floor(b[1]));
    const w = Math.min(SIZE, Math.ceil(b[2])) - x, h = Math.min(SIZE, Math.ceil(b[3])) - y;
    if (w <= 0 || h <= 0) return;
    this.record(mesh, ctx, x, y, crop(this.before, x, y, w, h), ctx.getImageData(x, y, w, h));
  }

  record(mesh, ctx, x, y, before, after) {
    const put = img => { ctx.putImageData(img, x, y); mesh.material.map.needsUpdate = true; this.app.engine.invalidate(); };
    this.app.history.push({ do: () => put(after), undo: () => put(before) });
  }

  // cover the whole image with one color
  fill(color) {
    const m = this.app.sel;
    if (!m?.isMesh) return;
    const ctx = this.canvas(m).getContext('2d'), before = ctx.getImageData(0, 0, SIZE, SIZE);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, SIZE, SIZE);
    m.material.map.needsUpdate = true;
    this.record(m, ctx, 0, 0, before, ctx.getImageData(0, 0, SIZE, SIZE));
  }

  exportPNG(mesh) {
    const c = mesh.material.map?.userData.canvas;
    if (!c) return this.app.say('Nothing painted yet');
    c.toBlob(blob => save(blob, `${mesh.name}-texture.png`, 'image/png'));
  }
}
