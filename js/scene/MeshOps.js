
const AX = { x: 0, y: 1, z: 2 };
const OTHERS = { x: [1, 2], y: [2, 0], z: [0, 1] };

// moving a whole mesh

// m is a 4x4 matrix as 16 numbers
export function applyMatrix(d, m) {
  const P = d.pos;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    P[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    P[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    P[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
  if (det < 0) for (let t = 0; t < d.idx.length; t += 3) [d.idx[t + 1], d.idx[t + 2]] = [d.idx[t + 2], d.idx[t + 1]]; // mirrored
  return d;
}

export function bounds(d) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], P = d.pos;
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[i + k]); max[k] = Math.max(max[k], P[i + k]); }
  return { min, max, center: min.map((v, k) => (v + max[k]) / 2), size: min.map((v, k) => max[k] - v) };
}

export function translate(d, x, y, z) {
  for (let i = 0; i < d.pos.length; i += 3) { d.pos[i] += x; d.pos[i + 1] += y; d.pos[i + 2] += z; }
  return d;
}

// two meshes become one
export function join(a, b) {
  const n = a.pos.length / 3;
  const out = {
    pos: a.pos.concat(b.pos),
    idx: a.idx.concat(b.idx.map(i => i + n)),
    uv: a.uv && b.uv ? a.uv.concat(b.uv) : null,
    col: a.col && b.col ? a.col.concat(b.col) : null,
    smoothShade: a.smoothShade && b.smoothShade,
  };
  return out;
}

// deform modifiers

// Twist, Bend, Taper or Bulge along an axis
export function simpleDeform(d, p) {
  const ax = AX[p.axis] ?? 2, [u, v] = OTHERS[p.axis] ?? OTHERS.z, P = d.pos, b = bounds(d);
  const lo = b.min[ax], len = b.size[ax] || 1, mid = b.center[ax];
  const ang = (p.angle || 0) * Math.PI / 180;
  for (let i = 0; i < P.length; i += 3) {
    const t = (P[i + ax] - lo) / len; // 0 at the bottom, 1 at the top
    let a = P[i + u], c = P[i + v], h = P[i + ax];
    if (p.mode === 'twist') {
      const r = ang * (t - 0.5), cs = Math.cos(r), sn = Math.sin(r);
      [a, c] = [a * cs - c * sn, a * sn + c * cs];
    } else if (p.mode === 'taper') {
      const s = 1 + (p.factor || 0) * t;
      a *= s; c *= s;
    } else if (p.mode === 'bulge') {
      const s = 1 + (p.factor || 0) * (1 - (2 * t - 1) ** 2);
      a *= s; c *= s;
    } else if (p.mode === 'bend' && Math.abs(ang) > 1e-4) {
      const R = len / ang, phi = (h - mid) / R;
      h = mid + (R - a) * Math.sin(phi);
      a = R - (R - a) * Math.cos(phi);
    }
    P[i + u] = a; P[i + v] = c; P[i + ax] = h;
  }
  d.smoothShade = d.smoothShade ?? false;
  return d;
}

// pulls
export function cast(d, p) {
  const b = bounds(d), c = b.center, P = d.pos, n = P.length / 3;
  let R = p.radius > 0 ? p.radius : 0;
  if (!R) { for (let i = 0; i < P.length; i += 3) R += Math.hypot(P[i] - c[0], P[i + 1] - c[1], P[i + 2] - c[2]); R /= n || 1; }
  const f = p.factor;
  for (let i = 0; i < P.length; i += 3) {
    const dx = P[i] - c[0], dy = P[i + 1] - c[1], dz = P[i + 2] - c[2], l = Math.hypot(dx, dy, dz) || 1;
    for (let k = 0; k < 3; k++) P[i + k] = P[i + k] * (1 - f) + (c[k] + [dx, dy, dz][k] / l * R) * f;
  }
  return d;
}

// decimate

// points that sit on the same spot get the same number
export function canon(pos, eps = 1e-4) {
  const seen = new Map(), rep = new Int32Array(pos.length / 3);
  for (let i = 0; i < rep.length; i++) {
    const key = `${Math.round(pos[i * 3] / eps)},${Math.round(pos[i * 3 + 1] / eps)},${Math.round(pos[i * 3 + 2] / eps)}`;
    if (!seen.has(key)) seen.set(key, i);
    rep[i] = seen.get(key);
  }
  return rep;
}

export function decimate(d, p) {
  const ratio = Math.min(1, Math.max(0.02, p.ratio)), P = d.pos, rep = canon(P), b = bounds(d);
  let unique = 0;
  for (let i = 0; i < rep.length; i++) if (rep[i] === i) unique++;
  if (ratio >= 0.999) return d;
  const cells = Math.max(2, Math.round(Math.cbrt(unique * ratio) * 1.6)), cell = k => Math.max(1e-9, b.size[k]) / cells;
  const map = new Map(), sum = [], count = [], of = new Int32Array(rep.length).fill(-1);
  for (let i = 0; i < rep.length; i++) {
    if (rep[i] !== i) continue;
    const key = [0, 1, 2].map(k => Math.min(cells - 1, Math.floor((P[i * 3 + k] - b.min[k]) / cell(k)))).join(',');
    let c = map.get(key);
    if (c === undefined) { c = sum.length / 3; map.set(key, c); sum.push(0, 0, 0); count.push(0); }
    of[i] = c; count[c]++;
    for (let k = 0; k < 3; k++) sum[c * 3 + k] += P[i * 3 + k];
  }
  const pos = sum.map((v, i) => v / count[Math.floor(i / 3)]), seen = new Set(), idx = [];
  for (let t = 0; t < d.idx.length; t += 3) {
    const a = of[rep[d.idx[t]]], c = of[rep[d.idx[t + 1]]], e = of[rep[d.idx[t + 2]]];
    if (a === c || c === e || a === e) continue;
    const key = [a, c, e].sort((x, y) => x - y).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    idx.push(a, c, e);
  }
  return { pos, idx, uv: null, col: null, smoothShade: true };
}

// wireframe

// every edge becomes a thin bar
export function wireframe(d, p) {
  const rep = canon(d.pos), P = d.pos, edges = new Map();
  for (let t = 0; t < d.idx.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = rep[d.idx[t + k]], b = rep[d.idx[t + (k + 1) % 3]];
      if (a !== b) edges.set(a < b ? `${a}_${b}` : `${b}_${a}`, a < b ? [a, b] : [b, a]);
    }
  }
  if (edges.size > 60000) throw new Error('Too many edges for Wireframe');
  const r = Math.max(0.0005, p.thickness) / 2, out = { pos: [], idx: [], uv: null, col: null, smoothShade: false };
  for (const [a, b] of edges.values()) {
    const A = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]], B = [P[b * 3], P[b * 3 + 1], P[b * 3 + 2]];
    const dir = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], l = Math.hypot(...dir) || 1;
    dir[0] /= l; dir[1] /= l; dir[2] /= l;
    const h = Math.abs(dir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let n1 = [dir[1] * h[2] - dir[2] * h[1], dir[2] * h[0] - dir[0] * h[2], dir[0] * h[1] - dir[1] * h[0]];
    const l1 = Math.hypot(...n1); n1 = n1.map(v => v / l1 * r);
    const n2 = [dir[1] * n1[2] - dir[2] * n1[1], dir[2] * n1[0] - dir[0] * n1[2], dir[0] * n1[1] - dir[1] * n1[0]];
    const ring = [[1, 1], [-1, 1], [-1, -1], [1, -1]], base = out.pos.length / 3;
    for (const end of [A, B]) for (const [s, t] of ring) out.pos.push(end[0] + n1[0] * s + n2[0] * t, end[1] + n1[1] * s + n2[1] * t, end[2] + n1[2] * s + n2[2] * t);
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      out.idx.push(base + k, base + k2, base + 4 + k2, base + k, base + 4 + k2, base + 4 + k);
    }
    out.idx.push(base, base + 2, base + 1, base, base + 3, base + 2, base + 4, base + 5, base + 6, base + 4, base + 6, base + 7);
  }
  return out;
}

// normals

// selection helpers

// Edit Mode operations on selected points

// boolean

const EPS = 1e-5;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

class Plane {
  constructor(normal, w) { this.n = normal; this.w = w; }
  static from(a, b, c) { const n = unit(cross(sub(b, a), sub(c, a))); return new Plane(n, dot(n, a)); }
  flip() { this.n = this.n.map(v => -v); this.w = -this.w; }
  clone() { return new Plane(this.n.slice(), this.w); }
  split(poly, cf, cb, f, b) {
    let type = 0;
    const types = poly.v.map(p => { const t = dot(this.n, p) - this.w, k = t < -EPS ? 2 : t > EPS ? 1 : 0; type |= k; return k; });
    if (type === 0) (dot(this.n, poly.plane.n) > 0 ? cf : cb).push(poly);
    else if (type === 1) f.push(poly);
    else if (type === 2) b.push(poly);
    else {
      const fv = [], bv = [];
      for (let i = 0; i < poly.v.length; i++) {
        const j = (i + 1) % poly.v.length, ti = types[i], tj = types[j], vi = poly.v[i], vj = poly.v[j];
        if (ti !== 2) fv.push(vi);
        if (ti !== 1) bv.push(vi);
        if ((ti | tj) === 3) {
          const t = (this.w - dot(this.n, vi)) / dot(this.n, sub(vj, vi)), p = lerp(vi, vj, t);
          fv.push(p); bv.push(p);
        }
      }
      if (fv.length >= 3) f.push(new Poly(fv, poly.plane));
      if (bv.length >= 3) b.push(new Poly(bv, poly.plane));
    }
  }
}

class Poly {
  constructor(v, plane) { this.v = v; this.plane = plane || Plane.from(v[0], v[1], v[2]); }
  clone() { return new Poly(this.v.map(p => p.slice()), this.plane.clone()); }
  flip() { this.v.reverse(); this.plane = this.plane.clone(); this.plane.flip(); } // own copy: split pieces share a plane
}

class Node {
  constructor(polys) { this.plane = null; this.front = null; this.back = null; this.polys = []; if (polys) this.build(polys); }
  invert() {
    const stack = [this];
    while (stack.length) {
      const n = stack.pop();
      n.polys.forEach(p => p.flip());
      n.plane?.flip();
      [n.front, n.back] = [n.back, n.front];
      if (n.front) stack.push(n.front);
      if (n.back) stack.push(n.back);
    }
  }
  clip(polys) {
    if (!this.plane) return polys.slice();
    let f = [], b = [];
    for (const p of polys) this.plane.split(p, f, b, f, b);
    f = this.front ? this.front.clip(f) : f;
    b = this.back ? this.back.clip(b) : [];
    return f.concat(b);
  }
  clipTo(bsp) {
    const stack = [this];
    while (stack.length) {
      const n = stack.pop();
      n.polys = bsp.clip(n.polys);
      if (n.front) stack.push(n.front);
      if (n.back) stack.push(n.back);
    }
  }
  all() {
    const out = [], stack = [this];
    while (stack.length) {
      const n = stack.pop();
      for (const p of n.polys) out.push(p);
      if (n.front) stack.push(n.front);
      if (n.back) stack.push(n.back);
    }
    return out;
  }
  // builds the tree without recursion
  build(polys) {
    const todo = [[this, polys]];
    while (todo.length) {
      const [n, list] = todo.pop();
      if (!list.length) continue;
      if (!n.plane) n.plane = list[list.length >> 1].plane.clone();
      const f = [], b = [];
      for (const p of list) n.plane.split(p, n.polys, n.polys, f, b);
      if (f.length) { n.front ||= new Node(); todo.push([n.front, f]); }
      if (b.length) { n.back ||= new Node(); todo.push([n.back, b]); }
    }
  }
}

const toPolys = d => {
  const out = [];
  for (let t = 0; t < d.idx.length; t += 3) {
    const v = [0, 1, 2].map(k => [d.pos[d.idx[t + k] * 3], d.pos[d.idx[t + k] * 3 + 1], d.pos[d.idx[t + k] * 3 + 2]]);
    if (Math.hypot(...cross(sub(v[1], v[0]), sub(v[2], v[0]))) > 1e-12) out.push(new Poly(v));
  }
  return out;
};

// shuffles in a repeatable way so the tree stays shallow
const shuffle = list => {
  let s = 12345;
  for (let i = list.length - 1; i > 0; i--) { s = (s * 1664525 + 1013904223) >>> 0; const j = s % (i + 1); [list[i], list[j]] = [list[j], list[i]]; }
  return list;
};

// op: 'union', 'difference'
export function boolean(a, b, op) {
  const A = new Node(shuffle(toPolys(a))), B = new Node(shuffle(toPolys(b)));
  if (op === 'union') {
    A.clipTo(B); B.clipTo(A); B.invert(); B.clipTo(A); B.invert();
    A.build(B.all());
  } else if (op === 'difference') {
    A.invert(); A.clipTo(B); B.clipTo(A); B.invert(); B.clipTo(A); B.invert();
    A.build(B.all()); A.invert();
  } else {
    A.invert(); B.clipTo(A); B.invert(); A.clipTo(B); B.clipTo(A);
    A.build(B.all()); A.invert();
  }
  const out = { pos: [], idx: [], uv: null, col: null, smoothShade: false }, at = new Map();
  const id = p => {
    const key = `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)},${Math.round(p[2] * 1e5)}`;
    if (!at.has(key)) { at.set(key, out.pos.length / 3); out.pos.push(p[0], p[1], p[2]); }
    return at.get(key);
  };
  for (const poly of A.all()) {
    const ids = poly.v.map(id);
    for (let i = 1; i < ids.length - 1; i++) if (ids[0] !== ids[i] && ids[i] !== ids[i + 1] && ids[0] !== ids[i + 1]) out.idx.push(ids[0], ids[i], ids[i + 1]);
  }
  return out;
}

// bevel
export function bevel(d, p) {
  const width = Math.max(1e-5, p.width), n = Math.max(1, Math.min(8, Math.round(p.segments || 1)));
  const rep = canon(d.pos), P = d.pos, idx = d.idx, tris = idx.length / 3;
  const V = i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  const tv = t => [rep[idx[t * 3]], rep[idx[t * 3 + 1]], rep[idx[t * 3 + 2]]];
  const ekey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const fnorm = t => { const [a, b, c] = tv(t); return unit(cross(sub(V(b), V(a)), sub(V(c), V(a)))); };
  const good = t => { const [a, b, c] = tv(t); return a !== b && b !== c && a !== c; };

  // edges and the faces that use them
  const E = new Map();
  for (let t = 0; t < tris; t++) {
    if (!good(t)) continue;
    const v = tv(t);
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3], key = ekey(a, b);
      if (!E.has(key)) E.set(key, { a: Math.min(a, b), b: Math.max(a, b), f: [] });
      E.get(key).f.push({ t, fwd: a < b });
    }
  }
  // which edges to bevel
  const cut = new Map(), cosA = Math.cos((p.angle ?? 30) * Math.PI / 180);
  for (const [key, e] of E) {
    if (e.f.length !== 2 || e.f[0].fwd === e.f[1].fwd) continue;
    const flat = dot(fnorm(e.f[0].t), fnorm(e.f[1].t)); // 1 when both faces lie in one plane
    const want = p.edges ? p.edges.has(key) && flat < 0.9998 : flat < cosA - 1e-6;
    if (want) cut.set(key, { ...e, f1: e.f.find(x => x.fwd).t, f2: e.f.find(x => !x.fwd).t });
  }
  if (!cut.size) return { pos: P.slice(), idx: idx.slice(), uv: d.uv && d.uv.slice(), col: d.col && d.col.slice(), smoothShade: d.smoothShade };

  // faces around each point
  const around = new Map();
  for (let t = 0; t < tris; t++) if (good(t)) for (const v of tv(t)) { if (!around.has(v)) around.set(v, []); around.get(v).push(t); }

  const out = { pos: [], idx: [], uv: null, col: null, smoothShade: n > 1 };
  const add = (x, y, z) => { out.pos.push(x, y, z); return out.pos.length / 3 - 1; };
  const wedgeOf = new Map(); // `${v}:${t}` -> new point number
  const wedges = new Map(); // v -> [{ id, faces }]
  const vnormal = new Map();
  for (const [v, faces] of around) {
    // join faces that touch along an edge that is not bevelled
    const parent = new Map(faces.map(f => [f, f]));
    const find = f => { while (parent.get(f) !== f) { parent.set(f, parent.get(parent.get(f))); f = parent.get(f); } return f; };
    for (const f of faces) {
      for (const u of tv(f)) {
        if (u === v) continue;
        const key = ekey(v, u), e = E.get(key);
        if (!e || cut.has(key)) continue;
        for (const o of e.f) if (parent.has(o.t)) parent.set(find(o.t), find(f));
      }
    }
    const groups = new Map();
    for (const f of faces) { const r = find(f); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(f); }
    const list = [];
    let vn = [0, 0, 0];
    for (const f of faces) { const fn = fnorm(f); vn = [vn[0] + fn[0], vn[1] + fn[1], vn[2] + fn[2]]; }
    vnormal.set(v, unit(vn));
    for (const fs of groups.values()) {
      const dirs = [], seen = new Set();
      if (groups.size > 1) {
        for (const f of fs) {
          for (const u of tv(f)) {
            if (u === v) continue;
            const key = ekey(v, u);
            if (!cut.has(key) || seen.has(key)) continue;
            seen.add(key);
            const w = tv(f).find(x => x !== v && x !== u), ed = unit(sub(V(u), V(v))), wv = sub(V(w), V(v));
            const along = dot(wv, ed), perp = [wv[0] - ed[0] * along, wv[1] - ed[1] * along, wv[2] - ed[2] * along];
            dirs.push(unit(perp));
          }
        }
      }
      let pos = V(v);
      if (dirs.length >= 2) {
        const s = [dirs[0][0] + dirs[1][0], dirs[0][1] + dirs[1][1], dirs[0][2] + dirs[1][2]], k = width / Math.max(0.25, 1 + dot(dirs[0], dirs[1]));
        pos = [pos[0] + s[0] * k, pos[1] + s[1] * k, pos[2] + s[2] * k];
      } else if (dirs.length === 1) pos = [pos[0] + dirs[0][0] * width, pos[1] + dirs[0][1] * width, pos[2] + dirs[0][2] * width];
      const id = add(...pos);
      list.push({ id, faces: fs });
      for (const f of fs) wedgeOf.set(`${v}:${f}`, id);
    }
    wedges.set(v, list);
  }

  // the faces themselves
  for (let t = 0; t < tris; t++) {
    if (!good(t)) continue;
    const [a, b, c] = tv(t);
    out.idx.push(wedgeOf.get(`${a}:${t}`), wedgeOf.get(`${b}:${t}`), wedgeOf.get(`${c}:${t}`));
  }

  // strips along the bevel edges
  const rings = new Map();
  const arc = (p1, p2, c, t) => [0, 1, 2].map(k => (1 - t) * (1 - t) * p1[k] + 2 * (1 - t) * t * c[k] + t * t * p2[k]);
  const outV = i => [out.pos[i * 3], out.pos[i * 3 + 1], out.pos[i * 3 + 2]];
  for (const [key, e] of cut) {
    const ring = {};
    for (const v of [e.a, e.b]) {
      const i1 = wedgeOf.get(`${v}:${e.f1}`), i2 = wedgeOf.get(`${v}:${e.f2}`), r = [i1];
      if (i1 !== i2) {
        const p1 = outV(i1), p2 = outV(i2), c = V(v);
        for (let k = 1; k < n; k++) r.push(add(...arc(p1, p2, c, k / n)));
        r.push(i2);
      } else for (let k = 1; k <= n; k++) r.push(i1);
      ring[v] = r;
    }
    rings.set(key, ring);
    const A = ring[e.a], B = ring[e.b];
    // f1 walks the edge from a to b
    for (let i = 0; i < n; i++) {
      const q = [B[i], A[i], A[i + 1], B[i + 1]];
      const push = (x, y, z) => { if (x !== y && y !== z && x !== z) out.idx.push(x, y, z); };
      push(q[0], q[1], q[2]); push(q[0], q[2], q[3]);
    }
  }

  // corners where three or more pieces meet
  for (const [v, list] of wedges) {
    if (list.length < 3) continue;
    const links = new Map(list.map(w => [w.id, []]));
    for (const [key, e] of cut) {
      if (e.a !== v && e.b !== v) continue;
      const from = wedgeOf.get(`${v}:${e.f1}`), to = wedgeOf.get(`${v}:${e.f2}`), ids = rings.get(key)[v];
      links.get(from)?.push({ key, to, ids });
      links.get(to)?.push({ key, to: from, ids: ids.slice().reverse() });
    }
    const start = list[0].id, cyc = [], used = new Set();
    let cur = start, ok = true;
    for (let guard = 0; guard < 64; guard++) {
      const step = links.get(cur)?.find(l => !used.has(l.key));
      if (!step) { ok = false; break; }
      used.add(step.key);
      cyc.push(...step.ids.slice(0, -1));
      cur = step.to;
      if (cur === start) break;
    }
    if (!ok || cur !== start || cyc.length < 3) continue;
    // the patch faces the same way as the faces around the point
    const pts = cyc.map(outV);
    let nm = [0, 0, 0];
    for (let i = 0; i < pts.length; i++) { const c2 = cross(pts[i], pts[(i + 1) % pts.length]); nm = [nm[0] + c2[0], nm[1] + c2[1], nm[2] + c2[2]]; }
    if (dot(nm, vnormal.get(v)) < 0) cyc.reverse();
    if (cyc.length === 3) out.idx.push(cyc[0], cyc[1], cyc[2]);
    else {
      const avg = [0, 0, 0];
      for (const q of pts) for (let k = 0; k < 3; k++) avg[k] += q[k] / pts.length;
      const o = V(v), ctr = add(avg[0] + (o[0] - avg[0]) * 0.5, avg[1] + (o[1] - avg[1]) * 0.5, avg[2] + (o[2] - avg[2]) * 0.5);
      for (let i = 0; i < cyc.length; i++) out.idx.push(ctr, cyc[i], cyc[(i + 1) % cyc.length]);
    }
  }
  return out;
}

// loop cut

// bridge two edge loops

