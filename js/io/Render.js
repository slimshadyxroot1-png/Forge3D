import * as THREE from 'three';
import { hideGizmos } from '../scene/Lights.js';

export const VIEW_LIST = [
  ['viewport', 'Current View'], ['front', 'Front'], ['back', 'Back'], ['left', 'Left'], ['right', 'Right'],
  ['top', 'Top'], ['bottom', 'Bottom'], ['frontleft', 'Front Left'], ['frontright', 'Front Right'],
  ['backleft', 'Back Left'], ['backright', 'Back Right'], ['topperspective', 'Top Perspective'], ['camera', 'Scene Camera'],
];
const NAMES = Object.fromEntries(VIEW_LIST);

// the direction each preset looks from
const DIRS = {
  front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0], top: [0, -0.001, 1], bottom: [0, -0.001, -1],
  frontleft: [-1, -1, 0.5], frontright: [1, -1, 0.5], backleft: [-1, 1, 0.5], backright: [1, 1, 0.5], topperspective: [1, -1, 1.4],
};

// a camera placed so the whole model fits in the picture
function presetCamera(id, box, aspect) {
  const sphere = box.getBoundingSphere(new THREE.Sphere()), fov = 35, rad = THREE.MathUtils.degToRad(fov) / 2;
  const radius = Math.max(sphere.radius, 0.5);
  const half = Math.min(rad, Math.atan(Math.tan(rad) * aspect)); // the smaller of up-down and left-right
  const dist = radius / Math.sin(half) * 1.1;
  const cam = new THREE.PerspectiveCamera(fov, aspect, Math.max(dist / 100, 0.01), dist * 10 + radius);
  cam.up.set(0, 0, 1);
  cam.position.copy(sphere.center).addScaledVector(new THREE.Vector3(...DIRS[id]).normalize(), dist);
  cam.lookAt(sphere.center);
  return cam;
}

function cameraFor(engine, id, active, box, aspect) {
  if (id === 'viewport' && engine.camView) { id = 'camera'; active = engine.camView; }
  if (id === 'viewport') {
    const cam = engine.camera.clone();
    if (cam.isPerspectiveCamera) cam.aspect = aspect;
    else {
      const half = (cam.top - cam.bottom) / 2;
      cam.left = -half * aspect;
      cam.right = half * aspect;
    }
    cam.updateProjectionMatrix();
    return cam;
  }
  if (id === 'camera') {
    if (!active) return null;
    const cam = new THREE.PerspectiveCamera(active.fov, aspect, active.near, active.far);
    active.updateWorldMatrix(true, false);
    active.matrixWorld.decompose(cam.position, cam.quaternion, cam.scale);
    return cam;
  }
  return presetCamera(id, box, aspect);
}

// reads the pixels back into a normal canvas
function readCanvas(r, rt, w, h, transparent) {
  const buf = new Uint8Array(w * h * 4), out = new Uint8ClampedArray(w * h * 4);
  r.readRenderTargetPixels(rt, 0, 0, w, h, buf);
  for (let y = 0; y < h; y++) { // the image comes out upside down
    const from = (h - 1 - y) * w * 4, to = y * w * 4;
    for (let x = 0; x < w * 4; x += 4) {
      const a = buf[from + x + 3];
      // soft edges are mixed with black, this undoes it
      const k = transparent && a > 0 && a < 255 ? 255 / a : 1;
      out[to + x] = buf[from + x] * k;
      out[to + x + 1] = buf[from + x + 1] * k;
      out[to + x + 2] = buf[from + x + 2] * k;
      out[to + x + 3] = a;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0);
  return canvas;
}

// renders every view in the list
export async function renderViews(engine, views, opt, activeCamera) {
  const r = engine.renderer, max = Math.min(r.capabilities.maxTextureSize, 8192);
  const w = Math.min(max, Math.max(16, Math.round(opt.width) || 1920));
  const h = Math.min(max, Math.max(16, Math.round(opt.height) || 1080));
  await new Promise(done => setTimeout(done, 30)); // let the page show "Rendering..." first

  // hide everything that is only for editing
  const editOnly = [engine.grid, engine.box, engine.tc, engine.cursor, engine.cursorObj, engine.measureObj].filter(Boolean).map(o => [o, o.visible]);
  editOnly.forEach(([o]) => { o.visible = false; });
  const showIcons = opt.helpers ? () => {} : hideGizmos(engine.world);

  const lookBack = engine.finalLook();
  const scene = engine.scene, oldBg = scene.background, oldTarget = r.getRenderTarget();
  const oldColor = r.getClearColor(new THREE.Color()), oldAlpha = r.getClearAlpha();
  const samples = Math.min(opt.samples ?? 4, r.capabilities.maxSamples);
  const rt = new THREE.WebGLRenderTarget(w, h, { samples, colorSpace: THREE.SRGBColorSpace });
  const out = [];

  try {
    const box = new THREE.Box3();
    engine.world.traverse(o => { if (o.isMesh && o.visible) box.expandByObject(o); });
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));

    scene.background = opt.transparent ? null : new THREE.Color(opt.background);
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 0);
    for (const id of views) {
      const cam = cameraFor(engine, id, activeCamera, box, w / h);
      if (!cam) continue;
      r.render(scene, cam);
      out.push({ id, name: NAMES[id], canvas: readCanvas(r, rt, w, h, opt.transparent) });
    }
  } finally {
    scene.background = oldBg;
    r.setRenderTarget(oldTarget);
    r.setClearColor(oldColor, oldAlpha);
    editOnly.forEach(([o, v]) => { o.visible = v; });
    showIcons();
    lookBack();
    rt.dispose();
    engine.invalidate();
  }
  return out;
}

// all images in one picture, with their names under them
export function contactSheet(shots, opt) {
  const cols = Math.ceil(Math.sqrt(shots.length)), rows = Math.ceil(shots.length / cols);
  const cw = Math.min(480, shots[0].canvas.width), ch = Math.round(cw * shots[0].canvas.height / shots[0].canvas.width);
  const pad = 8, label = 18;
  const c = document.createElement('canvas');
  c.width = cols * (cw + pad) + pad;
  c.height = rows * (ch + label + pad) + pad;
  const x = c.getContext('2d');
  if (!opt.transparent) { x.fillStyle = opt.background; x.fillRect(0, 0, c.width, c.height); }
  x.font = '12px sans-serif';
  x.fillStyle = '#999999';
  shots.forEach((shot, i) => {
    const px = pad + (i % cols) * (cw + pad), py = pad + Math.floor(i / cols) * (ch + label + pad);
    x.drawImage(shot.canvas, px, py, cw, ch);
    x.fillText(shot.name, px, py + ch + 13);
  });
  return c;
}

// canvas -> png, jpeg or webp file
export function encode(canvas, opt) {
  const mime = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }[opt.format] || 'image/png';
  let c = canvas;
  if (mime === 'image/jpeg') { // jpeg can't be see-through
    c = document.createElement('canvas');
    c.width = canvas.width;
    c.height = canvas.height;
    const x = c.getContext('2d');
    x.fillStyle = opt.background;
    x.fillRect(0, 0, c.width, c.height);
    x.drawImage(canvas, 0, 0);
  }
  return new Promise(done => c.toBlob(done, mime, opt.quality));
}
