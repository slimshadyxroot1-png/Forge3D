import * as THREE from 'three';
import { MODIFIERS, toData, copy, subdivide, displace } from './Modifiers.js';
import { makeEvaluator } from './Graph.js';

const empty = () => ({ pos: [], uv: null, col: null, idx: [] });

const SHAPES = {
  Cube: () => new THREE.BoxGeometry(1, 1, 1),
  Sphere: () => new THREE.SphereGeometry(0.5, 16, 8),
  Cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 16).rotateX(Math.PI / 2),
  Cone: () => new THREE.ConeGeometry(0.5, 1, 16).rotateX(Math.PI / 2),
  Torus: () => new THREE.TorusGeometry(0.5, 0.15, 8, 24),
  Plane: () => new THREE.PlaneGeometry(1, 1),
};

// random numbers that give the same result for the same seed
function random(seed) {
  let a = seed * 2654435761 >>> 0;
  return () => {
    a = a + 0x6D2B79F5 >>> 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function join(a, b) {
  const n = a.pos.length / 3, out = {
    pos: a.pos.concat(b.pos), idx: a.idx.slice(),
    uv: a.uv && b.uv ? a.uv.concat(b.uv) : null, col: a.col && b.col ? a.col.concat(b.col) : null };
  for (const i of b.idx) out.idx.push(i + n);
  return out;
}

function transform(d, t, r, s) {
  const rad = THREE.MathUtils.degToRad;
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...t),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(r[0]), rad(r[1]), rad(r[2]))), new THREE.Vector3(...s));
  const out = copy(d), v = new THREE.Vector3();
  for (let i = 0; i < out.pos.length; i += 3) {
    v.set(out.pos[i], out.pos[i + 1], out.pos[i + 2]).applyMatrix4(m);
    out.pos[i] = v.x; out.pos[i + 1] = v.y; out.pos[i + 2] = v.z;
  }
  return out;
}

// random spots on the surface
function distribute(d, count, seed) {
  const rnd = random(seed), tris = d.idx.length / 3, cum = [], P = d.pos;
  let total = 0;
  const at = i => new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
  for (let t = 0; t < tris; t++) {
    const a = at(d.idx[t * 3]), b = at(d.idx[t * 3 + 1]), c = at(d.idx[t * 3 + 2]);
    total += b.sub(a).cross(c.sub(a)).length() / 2;
    cum.push(total);
  }
  const points = [];
  for (let k = 0; k < Math.min(count, 3000) && total > 0; k++) {
    const x = rnd() * total;
    let lo = 0, hi = tris - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < x) lo = mid + 1; else hi = mid; }
    const a = at(d.idx[lo * 3]), b = at(d.idx[lo * 3 + 1]), c = at(d.idx[lo * 3 + 2]), s = Math.sqrt(rnd()), r2 = rnd();
    const p = a.multiplyScalar(1 - s).add(b.multiplyScalar(s * (1 - r2))).add(c.multiplyScalar(s * r2));
    points.push(p.x, p.y, p.z);
  }
  return { points };
}

function instance(pts, geo, min, max, seed) {
  const rnd = random(seed), n = pts.points.length / 3, base = geo.pos.length / 3;
  if (n * base > 1.5e6) throw new Error('Too many instances');
  const out = { pos: [], uv: geo.uv && [], col: geo.col && [], idx: [] };
  for (let k = 0; k < n; k++) {
    const s = min + rnd() * (max - min), start = out.pos.length / 3;
    for (let i = 0; i < base; i++) {
      out.pos.push(geo.pos[i * 3] * s + pts.points[k * 3], geo.pos[i * 3 + 1] * s + pts.points[k * 3 + 1], geo.pos[i * 3 + 2] * s + pts.points[k * 3 + 2]);
      if (out.uv) out.uv.push(geo.uv[i * 2], geo.uv[i * 2 + 1]);
      if (out.col) out.col.push(geo.col[i * 3], geo.col[i * 3 + 1], geo.col[i * 3 + 2]);
    }
    for (const i of geo.idx) out.idx.push(i + start);
  }
  return out;
}

const geo = name => ({ name, kind: 'geo', value: null });
const num = (name, value) => ({ name, kind: 'num', value, socket: false }); // typed in, no dot
const OUT = [{ name: 'Geometry', kind: 'geo' }];

export const GEO_NODES = {
  input: { label: 'Group Input', fixed: true, inputs: [], outputs: OUT, run: (get, ctx) => ({ Geometry: ctx.input }) },
  output: { label: 'Group Output', fixed: true, inputs: [geo('Geometry')], outputs: [], run: () => ({}) },
  primitive: {
    label: 'Mesh Primitive', outputs: OUT,
    inputs: [{ name: 'Shape', kind: 'select', options: Object.keys(SHAPES), value: 'Cube', socket: false }, num('Size', 1)],
    run: get => {
      const d = toData(SHAPES[get('Shape')]()), s = +get('Size');
      d.pos = d.pos.map(v => v * s);
      return { Geometry: d };
    },
  },
  transform: {
    label: 'Transform Geometry', outputs: OUT,
    inputs: [geo('Geometry'), num('Move X', 0), num('Move Y', 0), num('Move Z', 0), num('Rotate X', 0), num('Rotate Y', 0),
      num('Rotate Z', 0), num('Scale X', 1), num('Scale Y', 1), num('Scale Z', 1)],
    run: get => {
      const g = get('Geometry');
      if (!g) return { Geometry: empty() };
      return { Geometry: transform(g, ['Move X', 'Move Y', 'Move Z'].map(k => +get(k)), ['Rotate X', 'Rotate Y', 'Rotate Z'].map(k => +get(k)), ['Scale X', 'Scale Y', 'Scale Z'].map(k => +get(k))) };
    },
  },
  join: {
    label: 'Join Geometry', outputs: OUT, inputs: [geo('A'), geo('B')],
    run: get => ({ Geometry: join(get('A') || empty(), get('B') || empty()) }),
  },
  subdivide: {
    label: 'Subdivide Mesh', outputs: OUT, inputs: [geo('Geometry'), num('Levels', 1), num('Smooth', 0)],
    run: get => ({ Geometry: get('Geometry') ? subdivide(copy(get('Geometry')), { levels: get('Levels'), smooth: get('Smooth') }) : empty() }),
  },
  setposition: {
    label: 'Set Position (Noise)', outputs: OUT, inputs: [geo('Geometry'), num('Strength', 0.2), num('Scale', 1.5)],
    run: get => ({ Geometry: get('Geometry') ? displace(copy(get('Geometry')), { strength: +get('Strength'), scale: +get('Scale') }) : empty() }),
  },
  distribute: {
    label: 'Distribute Points on Faces', outputs: [{ name: 'Points', kind: 'points' }], inputs: [geo('Geometry'), num('Count', 50), num('Seed', 1)],
    run: get => ({ Points: get('Geometry') ? distribute(get('Geometry'), +get('Count'), +get('Seed')) : { points: [] } }),
  },
  instance: {
    label: 'Instance on Points', outputs: OUT,
    inputs: [{ name: 'Points', kind: 'points', value: null }, geo('Instance'), num('Scale Min', 0.2), num('Scale Max', 0.5), num('Seed', 1)],
    run: get => ({ Geometry: get('Points') && get('Instance') ? instance(get('Points'), get('Instance'), +get('Scale Min'), +get('Scale Max'), +get('Seed')) : empty() }),
  },
};

// Group Input connected to Group Output
export const defaultGeoGraph = () => ({
  next: 3, links: [{ from: 1, fromSocket: 'Geometry', to: 2, toSocket: 'Geometry' }],
  nodes: [{ id: 1, type: 'input', x: 30, y: 40, values: {} }, { id: 2, type: 'output', x: 420, y: 40, values: {} }],
});

function runGeoGraph(d, graph) {
  const ev = makeEvaluator(graph, GEO_NODES, { input: d });
  const out = graph.nodes.find(n => n.type === 'output');
  const link = out && graph.links.find(l => l.to === out.id && l.toSocket === 'Geometry');
  return link ? ev.out(ev.byId(link.from), link.fromSocket) : empty();
}

// the node graph is a modifier
MODIFIERS.nodes = {
  label: 'Geometry Nodes', defaults: { graph: null }, fields: [['edit', 'Edit Nodes...', 'button']],
  run: (d, p) => runGeoGraph(d, p.graph || defaultGeoGraph()),
};
