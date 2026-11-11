import * as THREE from 'three';
import { simpleDeform, cast, decimate, wireframe, bevel } from './MeshOps.js';

// The original mesh
const bases = new WeakMap();

export const hasModifiers = mesh => !!mesh?.userData.modifiers?.length;
export const baseOf = mesh => (hasModifiers(mesh) ? bases.get(mesh) : mesh.geometry);

// geometry as plain arrays, easier to change

export function toData(g) {
  const n = g.attributes.position.count;
  return {
    pos: Array.from(g.attributes.position.array),
    uv: g.attributes.uv ? Array.from(g.attributes.uv.array) : null,
    col: g.attributes.color ? Array.from(g.attributes.color.array) : null,
    idx: g.index ? Array.from(g.index.array) : Array.from({ length: n }, (_, i) => i),
  };
}

export function fromData(d) {
  if (d.pos.length / 3 > 2e6) throw new Error('Too many points');
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
  if (d.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
  if (d.col) g.setAttribute('color', new THREE.Float32BufferAttribute(d.col, 3));
  g.setIndex(d.idx);
  g.computeVertexNormals();
  if (d.smoothShade) {
    // points on the same spot share one normal
    const rep = canonical(d.pos), nrm = normalsOf(d, rep), out = new Float32Array(rep.length * 3);
    for (let i = 0; i < rep.length; i++) out.set(nrm.subarray(rep[i] * 3, rep[i] * 3 + 3), i * 3);
    g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  }
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export const copy = d => ({ pos: d.pos.slice(), uv: d.uv && d.uv.slice(), col: d.col && d.col.slice(), idx: d.idx.slice(), smoothShade: d.smoothShade });

function push(dst, src, i, x, y, z) {
  dst.pos.push(x, y, z);
  if (dst.uv) dst.uv.push(src.uv[i * 2], src.uv[i * 2 + 1]);
  if (dst.col) dst.col.push(src.col[i * 3], src.col[i * 3 + 1], src.col[i * 3 + 2]);
  return dst.pos.length / 3 - 1;
}

// points on the same spot get the same number
function canonical(pos) {
  const seen = new Map(), rep = new Int32Array(pos.length / 3);
  for (let i = 0; i < rep.length; i++) {
    const key = `${Math.round(pos[i * 3] * 1e4)},${Math.round(pos[i * 3 + 1] * 1e4)},${Math.round(pos[i * 3 + 2] * 1e4)}`;
    if (!seen.has(key)) seen.set(key, i);
    rep[i] = seen.get(key);
  }
  return rep;
}

// smooth normal for every shared point
function normalsOf(d, rep) {
  const nrm = new Float32Array(rep.length * 3), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  const at = (v, i) => v.set(d.pos[i * 3], d.pos[i * 3 + 1], d.pos[i * 3 + 2]);
  for (let t = 0; t < d.idx.length; t += 3) {
    const a = d.idx[t], b = d.idx[t + 1], c = d.idx[t + 2];
    const f = B.copy(at(B, b)).sub(at(A, a)).cross(C.copy(at(C, c)).sub(A));
    for (const i of [a, b, c]) { nrm[rep[i] * 3] += f.x; nrm[rep[i] * 3 + 1] += f.y; nrm[rep[i] * 3 + 2] += f.z; }
  }
  for (let i = 0; i < rep.length; i++) {
    const l = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]) || 1;
    nrm[i * 3] /= l; nrm[i * 3 + 1] /= l; nrm[i * 3 + 2] /= l;
  }
  return nrm;
}

// the modifiers

// merges points that are closer than dist
export function weld(d, dist) {
  dist = Math.max(dist, 1e-6);
  const seen = new Map(), map = new Int32Array(d.pos.length / 3);
  const out = { pos: [], uv: d.uv && [], col: d.col && [], idx: [], smoothShade: d.smoothShade };
  for (let i = 0; i < map.length; i++) {
    const key = [0, 1, 2].map(k => Math.round(d.pos[i * 3 + k] / dist)).join(',');
    if (!seen.has(key)) seen.set(key, push(out, d, i, d.pos[i * 3], d.pos[i * 3 + 1], d.pos[i * 3 + 2]));
    map[i] = seen.get(key);
  }
  for (let t = 0; t < d.idx.length; t += 3) {
    const a = map[d.idx[t]], b = map[d.idx[t + 1]], c = map[d.idx[t + 2]];
    if (a !== b && b !== c && a !== c) out.idx.push(a, b, c); // drop triangles that collapsed
  }
  return out;
}

function mirror(d, p) {
  const axis = 'xyz'.indexOf(p.axis), n = d.pos.length / 3, out = copy(d);
  for (let i = 0; i < n; i++) {
    const v = [d.pos[i * 3], d.pos[i * 3 + 1], d.pos[i * 3 + 2]];
    v[axis] = -v[axis];
    push(out, d, i, ...v);
  }
  for (let t = 0; t < d.idx.length; t += 3) out.idx.push(d.idx[t] + n, d.idx[t + 2] + n, d.idx[t + 1] + n);
  return p.merge > 0 ? weld(out, p.merge) : out;
}

function array(d, p) {
  const n = d.pos.length / 3, out = copy(d), count = Math.min(100, Math.max(1, Math.round(p.count)));
  for (let c = 1; c < count; c++) {
    for (let i = 0; i < n; i++) push(out, d, i, d.pos[i * 3] + p.x * c, d.pos[i * 3 + 1] + p.y * c, d.pos[i * 3 + 2] + p.z * c);
    for (const i of d.idx) out.idx.push(i + n * c);
  }
  return out;
}

// moves every point toward the average of its neighbours
function smoothData(d, factor, iterations) {
  const rep = canonical(d.pos), n = rep.length, near = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < d.idx.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = rep[d.idx[t + k]], b = rep[d.idx[t + (k + 1) % 3]];
      if (a !== b) { near[a].add(b); near[b].add(a); }
    }
  }
  for (let it = 0; it < iterations; it++) {
    const out = d.pos.slice();
    for (let c = 0; c < n; c++) {
      if (rep[c] !== c || !near[c].size) continue;
      for (let k = 0; k < 3; k++) {
        let sum = 0;
        for (const j of near[c]) sum += d.pos[j * 3 + k];
        out[c * 3 + k] = d.pos[c * 3 + k] + (sum / near[c].size - d.pos[c * 3 + k]) * factor;
      }
    }
    // copies of the same point move together
    for (let i = 0; i < n; i++) if (rep[i] !== i) for (let k = 0; k < 3; k++) out[i * 3 + k] = out[rep[i] * 3 + k];
    d.pos = out;
  }
  d.smoothShade = true;
  return d;
}

function smooth(d, p) { return smoothData(d, p.factor, Math.min(20, Math.max(1, Math.round(p.iterations)))); }

// every triangle becomes 4 smaller ones
export function subdivide(d, p) {
  const levels = Math.min(4, Math.max(1, Math.round(p.levels)));
  for (let l = 0; l < levels; l++) {
    if (d.idx.length / 3 > 400000) break; // already heavy enough
    const cache = new Map(), idx = [];
    const mid = (a, b) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (cache.has(key)) return cache.get(key);
      const i = push(d, d, a, (d.pos[a * 3] + d.pos[b * 3]) / 2, (d.pos[a * 3 + 1] + d.pos[b * 3 + 1]) / 2, (d.pos[a * 3 + 2] + d.pos[b * 3 + 2]) / 2);
      if (d.uv) { d.uv[i * 2] = (d.uv[a * 2] + d.uv[b * 2]) / 2; d.uv[i * 2 + 1] = (d.uv[a * 2 + 1] + d.uv[b * 2 + 1]) / 2; }
      if (d.col) for (let k = 0; k < 3; k++) d.col[i * 3 + k] = (d.col[a * 3 + k] + d.col[b * 3 + k]) / 2;
      cache.set(key, i);
      return i;
    };
    for (let t = 0; t < d.idx.length; t += 3) {
      const a = d.idx[t], b = d.idx[t + 1], c = d.idx[t + 2], ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      idx.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    d.idx = idx;
    if (p.smooth > 0) smoothData(d, p.smooth * 0.5, 1);
  }
  return d;
}

function solidify(d, p) {
  const rep = canonical(d.pos), n = rep.length, nrm = normalsOf(d, rep), out = copy(d), edges = new Map();
  for (let i = 0; i < n; i++) {
    const r = rep[i];
    push(out, d, i, d.pos[i * 3] - nrm[r * 3] * p.thickness, d.pos[i * 3 + 1] - nrm[r * 3 + 1] * p.thickness, d.pos[i * 3 + 2] - nrm[r * 3 + 2] * p.thickness);
  }
  for (let t = 0; t < d.idx.length; t += 3) {
    const a = d.idx[t], b = d.idx[t + 1], c = d.idx[t + 2];
    out.idx.push(a + n, c + n, b + n); // inner shell faces the other way
    for (const [x, y] of [[a, b], [b, c], [c, a]]) {
      const key = rep[x] < rep[y] ? `${rep[x]}_${rep[y]}` : `${rep[y]}_${rep[x]}`, e = edges.get(key);
      edges.set(key, e ? { ...e, count: e.count + 1 } : { x, y, count: 1 });
    }
  }
  for (const { x, y, count } of edges.values()) if (count === 1) out.idx.push(x, x + n, y + n, x, y + n, y);
  return out;
}

// smooth random numbers from -1 to 1
function hash(x, y, z) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1103515245);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295 * 2 - 1;
}

export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const ease = t => t * t * (3 - 2 * t), u = ease(x - xi), v = ease(y - yi), w = ease(z - zi);
  const lerp = (a, b, t) => a + (b - a) * t, c = (dx, dy, dz) => hash(xi + dx, yi + dy, zi + dz);
  return lerp(lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
              lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v), w);
}

// pushes points in or out along their normal using noise
export function displace(d, p) {
  const rep = canonical(d.pos), nrm = normalsOf(d, rep);
  for (let i = 0; i < rep.length; i++) {
    const h = noise3(d.pos[i * 3] * p.scale, d.pos[i * 3 + 1] * p.scale, d.pos[i * 3 + 2] * p.scale) * p.strength;
    for (let k = 0; k < 3; k++) d.pos[i * 3 + k] += nrm[rep[i] * 3 + k] * h;
  }
  d.smoothShade = true;
  return d;
}

// kinds of fields: 'num'
export const MODIFIERS = {
  mirror: {
    label: 'Mirror', run: mirror, defaults: { axis: 'x', merge: 0.001 },
    fields: [['axis', 'Axis', 'select', ['x', 'y', 'z']], ['merge', 'Merge Distance', 'num', { step: 0.001, min: 0 }]],
  },
  array: {
    label: 'Array', run: array, defaults: { count: 3, x: 2.2, y: 0, z: 0 },
    fields: [['count', 'Count', 'num', { step: 1, min: 1 }], ['x', 'Offset X', 'num', { step: 0.1 }], ['y', 'Offset Y', 'num', { step: 0.1 }], ['z', 'Offset Z', 'num', { step: 0.1 }]],
  },
  subdivide: {
    label: 'Subdivide', run: subdivide, defaults: { levels: 1, smooth: 0.5 },
    fields: [['levels', 'Levels (max 4)', 'num', { step: 1, min: 1 }], ['smooth', 'Smoothness', 'num', { step: 0.1, min: 0 }]],
  },
  solidify: {
    label: 'Solidify', run: solidify, defaults: { thickness: 0.2 },
    fields: [['thickness', 'Thickness', 'num', { step: 0.05 }]],
  },
  smooth: {
    label: 'Smooth', run: smooth, defaults: { factor: 0.5, iterations: 2 },
    fields: [['factor', 'Factor', 'num', { step: 0.1, min: 0 }], ['iterations', 'Repeat', 'num', { step: 1, min: 1 }]],
  },
  displace: {
    label: 'Displace', run: displace, defaults: { strength: 0.2, scale: 1.5 },
    fields: [['strength', 'Strength', 'num', { step: 0.05 }], ['scale', 'Noise Scale', 'num', { step: 0.1, min: 0.01 }]],
  },
  bevel: {
    label: 'Bevel', run: (d, p) => bevel(copy(d), p), defaults: { width: 0.1, segments: 3, angle: 30 },
    fields: [['width', 'Width', 'num', { step: 0.01, min: 0.001 }], ['segments', 'Segments', 'num', { step: 1, min: 1 }], ['angle', 'Bevel edges sharper than (degrees)', 'num', { step: 5, min: 1 }]],
  },
  deform: {
    label: 'Simple Deform', run: (d, p) => simpleDeform(copy(d), p), defaults: { mode: 'twist', axis: 'z', angle: 90, factor: 0.5 },
    fields: [['mode', 'Mode', 'select', ['twist', 'bend', 'taper', 'bulge']], ['axis', 'Axis', 'select', ['x', 'y', 'z']],
      ['angle', 'Angle (Twist, Bend)', 'num', { step: 5 }], ['factor', 'Factor (Taper, Bulge)', 'num', { step: 0.1 }]],
  },
  cast: {
    label: 'Cast', run: (d, p) => cast(copy(d), p), defaults: { factor: 0.5, radius: 0 },
    fields: [['factor', 'Factor (1 = sphere)', 'num', { step: 0.1 }], ['radius', 'Radius (0 = automatic)', 'num', { step: 0.1, min: 0 }]],
  },
  decimate: {
    label: 'Decimate', run: (d, p) => decimate(copy(d), p), defaults: { ratio: 0.5 },
    fields: [['ratio', 'Ratio (0.05 to 1)', 'num', { step: 0.05, min: 0.02 }]],
  },
  wireframe: {
    label: 'Wireframe', run: (d, p) => wireframe(copy(d), p), defaults: { thickness: 0.03 },
    fields: [['thickness', 'Thickness', 'num', { step: 0.01, min: 0.001 }]],
  },
  weld: {
    label: 'Weld', run: (d, p) => weld(d, p.distance), defaults: { distance: 0.001 },
    fields: [['distance', 'Distance', 'num', { step: 0.001, min: 0 }]],
  },
};

export function build(base, list) {
  let d = toData(base);
  for (const m of list) if (m.enabled) d = MODIFIERS[m.type].run(d, m);
  return fromData(d);
}

// rebuilds what the mesh shows
export function evaluate(mesh) {
  const base = bases.get(mesh);
  if (!base) return;
  const old = mesh.geometry, active = (mesh.userData.modifiers || []).filter(m => m.enabled);
  let g = base;
  if (active.length) {
    try { g = build(base, active); } catch (err) { console.error(err); }
  }
  mesh.geometry = g;
  if (old !== g && old !== base) old.dispose();
}

// sets a new list of modifiers
export function applyStack(mesh, stack, base) {
  if (base) bases.set(mesh, base);
  else if (!hasModifiers(mesh)) bases.set(mesh, mesh.geometry);
  mesh.userData.modifiers = stack;
  evaluate(mesh);
}

// for duplicate: the copy gets its own base
export function copyModifiers(src, dst) {
  if (!hasModifiers(src)) return;
  bases.set(dst, baseOf(src).clone());
  dst.userData.modifiers = JSON.parse(JSON.stringify(src.userData.modifiers));
  evaluate(dst);
}
