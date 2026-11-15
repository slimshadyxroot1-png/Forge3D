import * as THREE from 'three';
import { makeTexture, applyTiling } from './Textures.js';
import { noise3 } from './Modifiers.js';
import { makeEvaluator } from './Graph.js';

// A color is a hex text, an image
const rgb = v => {
  if (typeof v !== 'string') return [+v || 0, +v || 0, +v || 0];
  const n = parseInt(v.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
};
const asFn = v => (typeof v === 'function' ? v : (c => () => c)(rgb(v)));
const clamp = x => Math.min(1, Math.max(0, x));
const num = v => (typeof v === 'function' ? v(0.5, 0.5)[0] : +v);
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const toHex = c => '#' + c.map(x => Math.round(clamp(x) * 255).toString(16).padStart(2, '0')).join('');

// What a shader node gives to the Material Output
const shader = o => ({
  color: '#aaaaaa', metallic: 0, roughness: 0.5, emission: '#000000', emissionStrength: 0, alpha: 1,
  transmission: 0, ior: 1.45, normal: null, ...o,
});

function mixShader(a, b, t) {
  const out = { ...a };
  for (const k of ['metallic', 'roughness', 'emissionStrength', 'alpha', 'transmission', 'ior']) out[k] = num(a[k]) + (num(b[k]) - num(a[k])) * t;
  for (const k of ['color', 'emission']) {
    if (typeof a[k] === 'string' && typeof b[k] === 'string') out[k] = toHex(mix(rgb(a[k]), rgb(b[k]), t));
    else out[k] = t > 0.5 ? b[k] : a[k];
  }
  out.normal = t > 0.5 ? b.normal : a.normal;
  return out;
}

const input = (name, kind, value, extra = {}) => ({ name, kind, value, ...extra });
const color = (name, value) => input(name, 'color', value);
const number = (name, value) => input(name, 'num', value);
const SHADER = [{ name: 'BSDF', kind: 'shader' }];

export const MATERIAL_NODES = {
  output: {
    label: 'Material Output', fixed: true, outputs: [],
    inputs: [input('Surface', 'shader', null), color('Displacement', '#000000'), input('Displacement Scale', 'num', 0.1, { socket: false })],
    run: () => ({}),
  },
  principled: {
    label: 'Principled BSDF', outputs: SHADER,
    inputs: [color('Base Color', '#aaaaaa'), number('Metallic', 0), number('Roughness', 0.5), color('Emission', '#000000'),
      number('Emission Strength', 1), number('Alpha', 1), number('Transmission', 0), number('IOR', 1.45), color('Normal Map', '#8080ff')],
    run: get => ({ BSDF: shader({
      color: get('Base Color'), metallic: get('Metallic'), roughness: get('Roughness'), emission: get('Emission'),
      emissionStrength: get('Emission Strength'), alpha: get('Alpha'), transmission: get('Transmission'), ior: get('IOR'), normal: get('Normal Map') }) }),
  },
  diffuse: {
    label: 'Diffuse BSDF', outputs: SHADER, inputs: [color('Color', '#cccccc')],
    run: get => ({ BSDF: shader({ color: get('Color'), roughness: 1 }) }),
  },
  glossy: {
    label: 'Glossy BSDF', outputs: SHADER, inputs: [color('Color', '#dddddd'), number('Roughness', 0.15)],
    run: get => ({ BSDF: shader({ color: get('Color'), metallic: 1, roughness: get('Roughness') }) }),
  },
  glass: {
    label: 'Glass BSDF', outputs: SHADER, inputs: [color('Color', '#ffffff'), number('Roughness', 0.02), number('IOR', 1.5)],
    run: get => ({ BSDF: shader({ color: get('Color'), roughness: get('Roughness'), transmission: 1, ior: get('IOR') }) }),
  },
  emission: {
    label: 'Emission', outputs: SHADER, inputs: [color('Color', '#ffd27a'), number('Strength', 2)],
    run: get => ({ BSDF: shader({ color: '#000000', emission: get('Color'), emissionStrength: get('Strength') }) }),
  },
  mixshader: {
    label: 'Mix Shader', outputs: SHADER, inputs: [number('Fac', 0.5), input('A', 'shader', null), input('B', 'shader', null)],
    run: get => ({ BSDF: mixShader(get('A') || shader(), get('B') || shader(), clamp(num(get('Fac')))) }),
  },
  bump: {
    label: 'Bump', outputs: [{ name: 'Normal', kind: 'color' }], inputs: [number('Strength', 1), color('Height', '#808080')],
    run: get => ({ Normal: { bump: get('Height'), strength: num(get('Strength')) } }),
  },
  rgb: {
    label: 'RGB', outputs: [{ name: 'Color', kind: 'color' }], inputs: [color('Color', '#ff8800')],
    run: get => ({ Color: get('Color') }),
  },
  value: {
    label: 'Value', outputs: [{ name: 'Value', kind: 'num' }], inputs: [number('Value', 0.5)],
    run: get => ({ Value: get('Value') }),
  },
  image: {
    label: 'Image Texture', outputs: [{ name: 'Color', kind: 'color' }], inputs: [input('Image', 'file', null, { socket: false })],
    run: get => ({ Color: get('Image') ? { image: get('Image') } : '#ffffff' }),
  },
  noise: {
    label: 'Noise Texture', outputs: [{ name: 'Color', kind: 'color' }], inputs: [number('Scale', 5)],
    run: get => ({ Color: (u, v) => { const s = num(get('Scale')), x = noise3(u * s, v * s, 0) * 0.5 + 0.5; return [x, x, x]; } }),
  },
  voronoi: {
    label: 'Voronoi Texture', outputs: [{ name: 'Color', kind: 'color' }], inputs: [number('Scale', 5)],
    run: get => ({ Color: (u, v) => {
      const s = num(get('Scale')), x = u * s, y = v * s, ix = Math.floor(x), iy = Math.floor(y);
      let best = 9;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const cx = ix + dx, cy = iy + dy;
        best = Math.min(best, Math.hypot(x - (cx + noise3(cx, cy, 11) * 0.5 + 0.5), y - (cy + noise3(cx, cy, 23) * 0.5 + 0.5)));
      }
      const d = clamp(best);
      return [d, d, d];
    } }),
  },
  ramp: {
    label: 'Color Ramp', outputs: [{ name: 'Color', kind: 'color' }],
    inputs: [number('Fac', 0.5), number('Contrast', 1), color('Color 1', '#000000'), color('Color 2', '#ffffff')],
    run: get => ({ Color: (u, v) => {
      const t = clamp((asFn(get('Fac'))(u, v)[0] - 0.5) * num(get('Contrast')) + 0.5);
      return mix(asFn(get('Color 1'))(u, v), asFn(get('Color 2'))(u, v), t);
    } }),
  },
  mix: {
    label: 'Mix', outputs: [{ name: 'Color', kind: 'color' }],
    inputs: [number('Fac', 0.5), color('A', '#ff0000'), color('B', '#0000ff')],
    run: get => ({ Color: (u, v) => mix(asFn(get('A'))(u, v), asFn(get('B'))(u, v), clamp(asFn(get('Fac'))(u, v)[0])) }),
  },
};

// a function of
export function fnTexture(fn, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(size, size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const [r, g, b] = fn(i / size, 1 - j / size), k = (j * size + i) * 4;
      img.data[k] = r * 255; img.data[k + 1] = g * 255; img.data[k + 2] = b * 255; img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.userData.src = canvas.toDataURL();
  t.userData.node = true;
  return t;
}

function setMap(m, slot, v, isColor) {
  if (m[slot]?.userData.node) m[slot].dispose();
  if (typeof v === 'function') m[slot] = fnTexture(v);
  else if (v?.image) { m[slot] = makeTexture(v.image, isColor); m[slot].userData.node = true; }
  else m[slot] = null;
}

// glass needs the "physical" kind of material
export function physicalFor(mesh, need) {
  const m = mesh.material;
  if (!need || m.isMeshPhysicalMaterial) return m;
  const p = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(p, m);
  p.userData = m.userData;
  mesh.material = p;
  m.dispose();
  return p;
}

export function defaultMaterialGraph(mesh) {
  const m = mesh.material;
  return {
    next: 3, links: [{ from: 1, fromSocket: 'BSDF', to: 2, toSocket: 'Surface' }],
    nodes: [
      { id: 1, type: 'principled', x: 40, y: 20, values: { 'Base Color': '#' + m.color.getHexString(), Metallic: m.metalness, Roughness: m.roughness } },
      { id: 2, type: 'output', x: 330, y: 40, values: {} },
    ],
  };
}

// runs the graph and puts the result on the real material
export function applyMaterialGraph(mesh, graph) {
  const ev = makeEvaluator(graph, MATERIAL_NODES, {});
  const out = graph.nodes.find(n => n.type === 'output');
  const link = out && graph.links.find(l => l.to === out.id && l.toSocket === 'Surface');
  const s = link ? ev.out(ev.byId(link.from), link.fromSocket) : null;
  if (!s) return;

  const m = physicalFor(mesh, num(s.transmission) > 0);
  setMap(m, 'map', s.color, true);
  if (typeof s.color === 'string') m.color.set(s.color); else m.color.set(0xffffff);

  // a Bump node makes a bump map, an image makes a normal map
  const n = s.normal;
  setMap(m, 'normalMap', n?.image ? n : null, false);
  setMap(m, 'bumpMap', n?.bump !== undefined && typeof n.bump !== 'string' ? n.bump : null, false);
  m.bumpScale = n?.bump !== undefined ? n.strength * 2 : 1;

  // displacement needs a mesh with many points
  const dl = graph.links.find(l => l.to === out.id && l.toSocket === 'Displacement');
  const disp = dl ? ev.out(ev.byId(dl.from), dl.fromSocket) : null;
  setMap(m, 'displacementMap', disp && typeof disp !== 'string' ? disp : null, false);
  m.displacementScale = num(out.values?.['Displacement Scale'] ?? 0.1);

  m.metalness = num(s.metallic);
  m.roughness = num(s.roughness);
  m.emissive.set(typeof s.emission === 'string' ? s.emission : '#000000');
  m.emissiveIntensity = num(s.emissionStrength);
  m.opacity = num(s.alpha);
  m.transparent = m.opacity < 1;
  if (m.isMeshPhysicalMaterial) {
    m.transmission = num(s.transmission);
    m.ior = Math.min(2.333, Math.max(1, num(s.ior)));
    m.thickness = 0.5;
  }
  applyTiling(m);
  m.needsUpdate = true;
}
