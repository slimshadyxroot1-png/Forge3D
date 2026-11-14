import * as THREE from 'three';

const TEXTURES = new WeakMap();

// Gives every triangle its own points
export function unwrap(mesh, method) {
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  if (!g.attributes.normal) g.computeVertexNormals();
  const pos = g.attributes.position, n = pos.count, uv = new Float32Array(n * 2);
  g.computeBoundingBox();
  const size = g.boundingBox.getSize(new THREE.Vector3()), min = g.boundingBox.min, mid = g.boundingBox.getCenter(new THREE.Vector3());
  // 0 to 1 along one axis of the box around the mesh
  const unit = (value, axis) => (size.getComponent(axis) > 1e-9 ? (value - min.getComponent(axis)) / size.getComponent(axis) : 0);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3(), p = new THREE.Vector3();

  for (let t = 0; t < n; t += 3) {
    A.fromBufferAttribute(pos, t); B.fromBufferAttribute(pos, t + 1); C.fromBufferAttribute(pos, t + 2);
    N.crossVectors(B.clone().sub(A), C.clone().sub(A));
    const axis = [Math.abs(N.x), Math.abs(N.y), Math.abs(N.z)].indexOf(Math.max(Math.abs(N.x), Math.abs(N.y), Math.abs(N.z)));
    for (let k = 0; k < 3; k++) {
      p.fromBufferAttribute(pos, t + k);
      let u, v;
      if (method === 'sphere') {
        const q = p.clone().sub(mid);
        u = Math.atan2(q.y, q.x) / (Math.PI * 2) + 0.5;
        v = Math.acos(THREE.MathUtils.clamp(q.z / (q.length() || 1), -1, 1)) / Math.PI;
      } else if (method === 'cylinder') {
        u = Math.atan2(p.y - mid.y, p.x - mid.x) / (Math.PI * 2) + 0.5;
        v = unit(p.z, 2);
      } else if (method === 'planar') {
        u = unit(p.x, 0);
        v = unit(p.y, 1);
      } else {
        const [ua, va] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
        u = unit(p.getComponent(ua), ua);
        v = unit(p.getComponent(va), va);
        if (method === 'smart') {
          const cell = axis * 2 + (N.getComponent(axis) < 0 ? 1 : 0);
          u = ((cell % 3) + u * 0.94 + 0.03) / 3;
          v = (Math.floor(cell / 3) + v * 0.94 + 0.03) / 2;
        }
      }
      uv[(t + k) * 2] = u;
      uv[(t + k) * 2 + 1] = v;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}

export function unwrapAngle(mesh, angleDeg, margin = 0.02) {
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  if (!g.attributes.normal) g.computeVertexNormals();
  const pos = g.attributes.position, tris = pos.count / 3, limit = Math.cos(THREE.MathUtils.degToRad(angleDeg));
  const spot = i => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const at = i => new THREE.Vector3().fromBufferAttribute(pos, i);

  // face normals, and which faces share an edge
  const normals = [], edgeOf = [], faces = new Map();
  for (let t = 0; t < tris; t++) {
    const a = at(t * 3), b = at(t * 3 + 1), c = at(t * 3 + 2);
    normals.push(b.clone().sub(a).cross(c.clone().sub(a)).normalize());
    edgeOf.push([0, 1, 2].map(k => { const p = spot(t * 3 + k), q = spot(t * 3 + (k + 1) % 3); return p < q ? `${p}|${q}` : `${q}|${p}`; }));
    for (const id of edgeOf[t]) faces.has(id) ? faces.get(id).push(t) : faces.set(id, [t]);
  }

  const island = new Int32Array(tris).fill(-1), islands = [];
  for (let s = 0; s < tris; s++) {
    if (island[s] >= 0) continue;
    const list = [s];
    island[s] = islands.length;
    for (let q = 0; q < list.length; q++) {
      for (const id of edgeOf[list[q]]) {
        for (const u of faces.get(id)) {
          if (island[u] < 0 && normals[u].dot(normals[list[q]]) > limit) { island[u] = islands.length; list.push(u); }
        }
      }
    }
    islands.push(list);
  }

  // flatten every island along its average direction
  const flat = islands.map(list => {
    const n = list.reduce((sum, t) => sum.add(normals[t]), new THREE.Vector3()).normalize();
    const helper = Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const u = helper.cross(n).normalize(), v = n.clone().cross(u);
    const pts = list.flatMap(t => [0, 1, 2].map(k => { const p = at(t * 3 + k); return [t * 3 + k, p.dot(u), p.dot(v)]; }));
    const minU = Math.min(...pts.map(p => p[1])), minV = Math.min(...pts.map(p => p[2]));
    return { pts, minU, minV, w: Math.max(...pts.map(p => p[1])) - minU, h: Math.max(...pts.map(p => p[2])) - minV };
  });

  // put the islands in rows
  const order = flat.map((_, i) => i).sort((a, b) => flat[b].h - flat[a].h);
  const area = flat.reduce((sum, f) => sum + (f.w + margin) * (f.h + margin), 0) || 1;
  const place = new Array(flat.length);
  let scale = Math.sqrt(0.8 / area), fits = false;
  for (let tries = 0; tries < 30 && !fits; tries++, scale *= 0.9) {
    let x = 0, y = 0, row = 0;
    fits = true;
    for (const i of order) {
      const w = flat[i].w * scale + margin, h = flat[i].h * scale + margin;
      if (x + w > 1) { x = 0; y += row; row = 0; }
      place[i] = [x, y];
      x += w;
      row = Math.max(row, h);
    }
    if (y + row > 1) fits = false;
  }
  scale /= 0.9;

  const uv = new Float32Array(pos.count * 2);
  flat.forEach((f, i) => {
    for (const [vertex, pu, pv] of f.pts) {
      uv[vertex * 2] = (pu - f.minU) * scale + place[i][0] + margin / 2;
      uv[vertex * 2 + 1] = (pv - f.minV) * scale + place[i][1] + margin / 2;
    }
  });
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}

// scale and rotate around the middle of the picture
export function uvTransformed(attr, p) {
  const out = attr.array.slice(), r = THREE.MathUtils.degToRad(p.rotate), c = Math.cos(r), s = Math.sin(r);
  for (let i = 0; i < out.length; i += 2) {
    const u = (out[i] - 0.5) * p.scale, v = (out[i + 1] - 0.5) * p.scale;
    out[i] = u * c - v * s + 0.5 + p.du;
    out[i + 1] = u * s + v * c + 0.5 + p.dv;
  }
  return out;
}

// draws the triangles of the UV map on a canvas
export function drawUV(canvas, mesh) {
  const ctx = canvas.getContext('2d'), w = canvas.width, uv = mesh?.geometry.attributes.uv;
  ctx.fillStyle = '#1d1d1d';
  ctx.fillRect(0, 0, w, w);
  ctx.strokeStyle = '#555';
  ctx.strokeRect(0.5, 0.5, w - 1, w - 1);
  if (!uv) {
    ctx.fillStyle = '#999';
    ctx.fillText('No UVs yet. Pick an unwrap method.', 20, w / 2);
    return;
  }
  const index = mesh.geometry.index, count = Math.min(60000, (index ? index.count : uv.count) / 3);
  const at = i => [uv.getX(index ? index.getX(i) : i) * w, (1 - uv.getY(index ? index.getX(i) : i)) * w];
  ctx.strokeStyle = '#e8a060';
  ctx.beginPath();
  for (let t = 0; t < count; t++) {
    const a = at(t * 3), b = at(t * 3 + 1), c = at(t * 3 + 2);
    ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...c); ctx.lineTo(...a);
  }
  ctx.stroke();
}

export function toggleChecker(mesh, engine) {
  const m = mesh.material;
  if (m.map?.userData.checker) m.map = TEXTURES.get(m) || null;
  else {
    TEXTURES.set(m, m.map);
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const x = c.getContext('2d');
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) { x.fillStyle = (i + j) % 2 ? '#8a8a8a' : '#d4d4d4'; x.fillRect(i * 32, j * 32, 32, 32); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.userData.checker = true; // no "src"
    m.map = t;
  }
  m.needsUpdate = true;
  engine.invalidate();
}
