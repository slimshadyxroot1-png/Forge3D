import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { disposeObject, uniqueName } from '../scene/Primitives.js';
import { weld } from '../scene/Modifiers.js';
import { linkedFaces, growVerts, shrinkVerts, smoothSelected, toSphere, shrinkFatten, fillPoints, recalcNormals, bevel, planeCut, bridgeLoops } from '../scene/MeshOps.js';

const key = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
const range = (from, to) => Array.from({ length: to - from }, (_, i) => from + i);

// a geometry from plain arrays: pos
function build(d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
  if (d.col) g.setAttribute('color', new THREE.Float32BufferAttribute(d.col, 3));
  g.setIndex(d.idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  g.userData.ready = !!d.col; // sculpt and paint can use it as it is
  return g;
}

// throws away points that no triangle uses
function compactData(d) {
  const map = new Int32Array(d.pos.length / 3).fill(-1);
  let n = 0;
  for (const i of d.idx) if (map[i] < 0) map[i] = n++;
  const pos = new Array(n * 3), col = d.col ? new Array(n * 3) : null;
  for (let i = 0; i < map.length; i++) {
    if (map[i] < 0) continue;
    for (let k = 0; k < 3; k++) {
      pos[map[i] * 3 + k] = d.pos[i * 3 + k];
      if (col) col[map[i] * 3 + k] = d.col[i * 3 + k];
    }
  }
  d.pos = pos;
  d.col = col;
  d.idx = d.idx.map(i => map[i]);
}

// cuts one triangle using new middle points
function split(a, b, c, ab, bc, ca, out) {
  const count = (ab >= 0) + (bc >= 0) + (ca >= 0);
  if (count === 0) out.push(a, b, c);
  else if (count === 3) out.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  else if (count === 1) {
    if (bc >= 0) return split(b, c, a, bc, ca, ab, out); // turn it so the cut edge comes first
    if (ca >= 0) return split(c, a, b, ca, ab, bc, out);
    out.push(a, ab, c, ab, b, c);
  } else {
    if (ab < 0) return split(b, c, a, bc, ca, ab, out); // turn it so the missing edge comes last
    if (bc < 0) return split(c, a, b, ca, ab, bc, out);
    out.push(ab, b, bc, a, ab, c, ab, bc, c);
  }
}

// Edit Mode works on triangles
export class EditMode {
  constructor(app) {
    this.app = app;
    this.mesh = null;
    this.selMode = 'vertex'; // vertex, edge or face
    this.opt = { extrude: 0.3, inset: 0.2, mirror: false, prop: false, propR: 1, shrink: 0.1, bevel: 0.1, bsegs: 3, cutAxis: 2, cutPos: 0 };
    this.clear();
    this.pivot = new THREE.Object3D();
    app.engine.scene.add(this.pivot);

    const eng = app.engine, dom = eng.renderer.domElement, host = dom.parentElement;
    this.rect = document.createElement('div');
    this.rect.id = 'boxsel';
    host.appendChild(this.rect);

    let down = null;
    dom.addEventListener('pointerdown', e => {
      down = e.button === 0 && this.mesh && !eng.tc.axis && !e.altKey && !eng.space ? { x: e.clientX, y: e.clientY, moved: false } : null;
    });
    addEventListener('pointermove', e => {
      if (!down || (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4)) return;
      down.moved = true;
      const r = host.getBoundingClientRect();
      Object.assign(this.rect.style, {
        display: 'block', left: Math.min(down.x, e.clientX) - r.left + 'px', top: Math.min(down.y, e.clientY) - r.top + 'px',
        width: Math.abs(e.clientX - down.x) + 'px', height: Math.abs(e.clientY - down.y) + 'px' });
    });
    addEventListener('pointerup', e => {
      const d = down;
      down = null;
      this.rect.style.display = 'none';
      if (!d || !this.mesh) return;
      if (d.moved) this.boxSelect(d.x, d.y, e.clientX, e.clientY, e.shiftKey);
      else this.click(e);
    });
    eng.tc.addEventListener('dragging-changed', e => { if (this.mesh) (e.value ? this.startDrag() : this.endDrag()); });
    eng.tc.addEventListener('objectChange', () => this.drag());
  }

  enter(mesh) {
    this.mesh = mesh;
    this.app.engine.offMeshOrbit = false;
    // weld the points so neighbours share them
    const old = mesh.geometry;
    old.deleteAttribute('normal');
    old.deleteAttribute('uv');
    mesh.geometry = mergeVertices(old);
    old.dispose();
    this.d = {
      pos: Array.from(mesh.geometry.attributes.position.array),
      col: mesh.geometry.attributes.color ? Array.from(mesh.geometry.attributes.color.array) : null,
      idx: Array.from(mesh.geometry.index.array),
    };
    this.write();
    mesh.material.polygonOffset = true; // so the lines do not flicker on the faces
    mesh.material.polygonOffsetFactor = 1;
    mesh.material.polygonOffsetUnits = 1;
    this.clear();
    this.topology();
    this.refresh();
  }

  exit() {
    if (!this.mesh) return;
    this.dropOverlay();
    this.mesh.material.polygonOffset = false;
    this.app.engine.offMeshOrbit = true;
    this.mesh = null;
    this.clear();
    const eng = this.app.engine;
    eng.pivot = null;
    eng.sync();
  }

  clear() {
    this.verts = new Set();
    this.edges = new Set();
    this.faces = new Set();
  }

  // puts the arrays into the real geometry
  write() {
    const old = this.mesh.geometry;
    this.mesh.geometry = build(this.d);
    old.dispose();
  }

  // list of edges with the triangles that use them
  topology() {
    this.edgeMap = new Map();
    const idx = this.d.idx;
    for (let t = 0; t < idx.length / 3; t++) {
      for (let k = 0; k < 3; k++) {
        const a = idx[t * 3 + k], b = idx[t * 3 + (k + 1) % 3], id = key(a, b);
        if (!this.edgeMap.has(id)) this.edgeMap.set(id, { a: Math.min(a, b), b: Math.max(a, b), faces: [] });
        this.edgeMap.get(id).faces.push(t);
      }
    }
  }

  // the three selections always agree with each other
  syncSel() {
    const idx = this.d.idx, tris = idx.length / 3, tri = t => [0, 1, 2].map(k => idx[t * 3 + k]);
    if (this.selMode === 'face') {
      this.verts = new Set();
      this.edges = new Set();
      for (const t of this.faces) {
        const [a, b, c] = tri(t);
        [a, b, c].forEach(i => this.verts.add(i));
        [key(a, b), key(b, c), key(c, a)].forEach(k => this.edges.add(k));
      }
    } else if (this.selMode === 'edge') {
      this.verts = new Set();
      for (const k of this.edges) { const e = this.edgeMap.get(k); this.verts.add(e.a); this.verts.add(e.b); }
      this.faces = new Set(range(0, tris).filter(t => { const [a, b, c] = tri(t); return [key(a, b), key(b, c), key(c, a)].every(k => this.edges.has(k)); }));
    } else {
      this.edges = new Set([...this.edgeMap].filter(([, e]) => this.verts.has(e.a) && this.verts.has(e.b)).map(([k]) => k));
      this.faces = new Set(range(0, tris).filter(t => tri(t).every(i => this.verts.has(i))));
    }
  }

  setSelMode(mode) {
    if (!this.mesh) return;
    this.selMode = mode;
    this.syncSel();
    this.refresh();
  }

  // everything that can be selected in the current mode
  universe() {
    if (this.selMode === 'vertex') return range(0, this.d.pos.length / 3);
    return this.selMode === 'edge' ? [...this.edgeMap.keys()] : range(0, this.d.idx.length / 3);
  }

  get main() { return { vertex: 'verts', edge: 'edges', face: 'faces' }[this.selMode]; }

  selectAll() { this[this.main] = new Set(this.universe()); this.syncSel(); this.refresh(); }
  selectNone() { this.clear(); this.syncSel(); this.refresh(); }
  invert() {
    const now = this[this.main];
    this[this.main] = new Set(this.universe().filter(x => !now.has(x)));
    this.syncSel();
    this.refresh();
  }

  click(e) {
    const hit = this.app.engine.hit(e, this.mesh);
    if (!hit) { if (!e.shiftKey) { this.clear(); this.refresh(); } return; }
    const P = this.d.pos, idx = this.d.idx, t = hit.faceIndex, p = this.mesh.worldToLocal(hit.point.clone());
    const tri = [0, 1, 2].map(k => idx[t * 3 + k]), at = i => new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    let item;
    if (this.selMode === 'face') item = t;
    else if (this.selMode === 'vertex') item = tri.reduce((best, i) => (at(i).distanceTo(p) < at(best).distanceTo(p) ? i : best));
    else {
      const sides = [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]];
      const dist = ([a, b]) => new THREE.Line3(at(a), at(b)).closestPointToPoint(p, true, new THREE.Vector3()).distanceTo(p);
      item = key(...sides.reduce((best, s) => (dist(s) < dist(best) ? s : best)));
    }
    const set = this[this.main];
    if (!e.shiftKey) this.clear();
    if (e.shiftKey && set.has(item)) set.delete(item); else this[this.main].add(item);
    this.syncSel();
    this.refresh();
  }

  // Draws the depth of the mesh into a hidden image
  depthLookup() {
    const eng = this.app.engine, r = eng.renderer, cam = eng.camera, mesh = this.mesh;
    const w = r.domElement.clientWidth, h = r.domElement.clientHeight;
    const rt = new THREE.WebGLRenderTarget(w, h), scene = new THREE.Scene();
    const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: mesh.material.side });
    const copy = new THREE.Mesh(mesh.geometry, mat);
    copy.matrixAutoUpdate = false;
    mesh.updateWorldMatrix(true, false);
    copy.matrix.copy(mesh.matrixWorld);
    scene.add(copy);

    const oldTarget = r.getRenderTarget(), oldColor = r.getClearColor(new THREE.Color()), oldAlpha = r.getClearAlpha();
    r.setRenderTarget(rt);
    r.setClearColor(0xffffff, 1); // white means "nothing here"
    r.render(scene, cam);
    const buf = new Uint8Array(w * h * 4);
    r.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    r.setRenderTarget(oldTarget);
    r.setClearColor(oldColor, oldAlpha);
    rt.dispose();
    mat.dispose();

    // the depth comes packed in the 4 color bytes of every pixel
    const depthAt = (px, py) => {
      const k = ((h - 1 - py) * w + px) * 4;
      return (buf[k + 3] / 255 + buf[k + 2] / 255 / 256 + buf[k + 1] / 255 / 65536 + buf[k] / 255 / 16777216) * 255 / 256;
    };
    const distance = z => {
      const n = cam.near, f = cam.far, ndc = z * 2 - 1;
      return cam.isPerspectiveCamera ? (2 * n * f) / (f + n - ndc * (f - n)) : n + (ndc + 1) / 2 * (f - n);
    };
    return {
      visible: (sx, sy, z) => {
        const px = Math.round(sx), py = Math.round(sy);
        if (px < 0 || py < 0 || px >= w || py >= h) return true;
        let far = 0; // look at the pixels around too
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const x = Math.min(w - 1, Math.max(0, px + dx)), y = Math.min(h - 1, Math.max(0, py + dy));
            far = Math.max(far, depthAt(x, y));
          }
        }
        const seen = distance(Math.min(far, 1));
        return distance(z) <= seen + seen * 0.004 + 0.01;
      },
    };
  }

  // Selects the points inside the dragged box
  boxSelect(x1, y1, x2, y2, add) {
    const eng = this.app.engine, cam = eng.camera, r = eng.renderer.domElement.getBoundingClientRect();
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2), minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    this.mesh.updateWorldMatrix(true, false);
    cam.updateMatrixWorld();
    const P = this.d.pos, n = P.length / 3, v = new THREE.Vector3();
    const front = new Uint8Array(n), sx = new Float32Array(n), sy = new Float32Array(n), sz = new Float32Array(n);
    for (let i = 0; i < n; i++) { // where every point is on the screen
      v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(this.mesh.matrixWorld);
      if (v.clone().applyMatrix4(cam.matrixWorldInverse).z > 0) continue; // behind the camera
      v.project(cam);
      sx[i] = (v.x + 1) / 2 * r.width + r.left;
      sy[i] = (1 - v.y) / 2 * r.height + r.top;
      sz[i] = v.z * 0.5 + 0.5; // depth from 0
      front[i] = 1;
    }
    const inBox = (x, y) => x >= minX && x <= maxX && y >= minY && y <= maxY;
    // the depth image is only made when it is needed
    let lookup = null;
    const seeThrough = eng.shading !== 'solid';
    const open = (x, y, z) => seeThrough || (lookup ||= this.depthLookup()).visible(x - r.left, y - r.top, z);
    const pointIn = i => front[i] && inBox(sx[i], sy[i]) && open(sx[i], sy[i], sz[i]);

    if (!add) this.clear();
    const idx = this.d.idx;
    if (this.selMode === 'vertex') {
      for (let i = 0; i < n; i++) if (pointIn(i)) this.verts.add(i);
    } else if (this.selMode === 'edge') {
      for (const [k, e] of this.edgeMap) if (pointIn(e.a) && pointIn(e.b)) this.edges.add(k); // both ends inside
    } else {
      for (let t = 0; t < idx.length / 3; t++) {
        const [a, b, c] = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
        if (!front[a] || !front[b] || !front[c]) continue;
        const cx = (sx[a] + sx[b] + sx[c]) / 3, cy = (sy[a] + sy[b] + sy[c]) / 3;
        if (inBox(cx, cy) && open(cx, cy, (sz[a] + sz[b] + sz[c]) / 3)) this.faces.add(t);
      }
    }
    this.syncSel();
    this.refresh();
  }

  // redraw the lines, points and gizmo
  refresh() {
    this.buildOverlay();
    this.movePivot();
    this.app.props.sync();
    this.app.engine.invalidate();
  }

  dropOverlay() {
    if (!this.overlay) return;
    this.mesh.remove(this.overlay);
    this.overlay.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    this.overlay = null;
  }

  buildOverlay() {
    this.dropOverlay();
    const P = this.d.pos, group = new THREE.Group();
    group.userData.gizmo = true; // hidden in renders and exports
    const lines = (list, color, depth) => {
      const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
      group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, depthTest: depth })));
    };
    const points = (ids, color, size, depth) => {
      const list = ids.flatMap(i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
      const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
      group.add(new THREE.Points(geo, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: depth })));
    };
    const edge = (list, e) => list.push(P[e.a * 3], P[e.a * 3 + 1], P[e.a * 3 + 2], P[e.b * 3], P[e.b * 3 + 1], P[e.b * 3 + 2]);

    const all = [], chosen = [];
    for (const e of this.edgeMap.values()) edge(all, e);
    for (const k of this.edges) edge(chosen, this.edgeMap.get(k));
    lines(all, 0x151515, true);
    if (chosen.length) lines(chosen, 0xff9a1f, false);
    if (this.selMode === 'vertex') points(range(0, P.length / 3), 0x151515, 4, true);
    if (this.verts.size && this.selMode !== 'face') points([...this.verts], 0xff9a1f, 7, false);

    if (this.faces.size) { // selected triangles are painted orange
      const list = [];
      for (const t of this.faces) for (let k = 0; k < 3; k++) { const i = this.d.idx[t * 3 + k]; list.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); }
      group.add(new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(list, 3)),
        new THREE.MeshBasicMaterial({ color: 0xff9a1f, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide,
          polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })));
    }
    this.mesh.add(group);
    this.overlay = group;
  }

  // the gizmo sits in the middle of the selected points
  movePivot() {
    const eng = this.app.engine;
    if (!this.verts.size) { eng.pivot = null; eng.sync(); return; }
    const c = new THREE.Vector3(), P = this.d.pos;
    if (this.app.tool === 'scale') this.mesh.geometry.boundingBox.getCenter(c);
    else {
      for (const i of this.verts) c.add(new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
      c.divideScalar(this.verts.size);
    }
    this.mesh.updateWorldMatrix(true, false);
    this.pivot.position.copy(this.mesh.localToWorld(c));
    this.pivot.quaternion.identity();
    this.pivot.scale.set(1, 1, 1);
    this.pivot.updateMatrixWorld(true);
    eng.pivot = this.pivot;
    eng.sync();
  }

  // while the gizmo is dragged, the selected points follow it
  startDrag() {
    if (this.app.engine.pivot !== this.pivot) return;
    this.pivot.updateMatrixWorld(true);
    this.startMatrix = this.pivot.matrixWorld.clone();
    this.startPos = new Map([...this.verts].map(i => [i, this.d.pos.slice(i * 3, i * 3 + 3)]));
    this.before = this.d.pos.slice();

    // Proportional Editing
    this.near = [];
    if (this.opt.prop && this.verts.size) {
      const P = this.d.pos, sel = [...this.verts], step = Math.max(1, Math.floor(sel.length / 200)), R = Math.max(1e-4, this.opt.propR);
      const probe = sel.filter((_, k) => k % step === 0);
      for (let i = 0; i < P.length / 3; i++) {
        if (this.verts.has(i)) continue;
        let best = Infinity, src = -1;
        for (const j of probe) {
          const dd = Math.hypot(P[i * 3] - P[j * 3], P[i * 3 + 1] - P[j * 3 + 1], P[i * 3 + 2] - P[j * 3 + 2]);
          if (dd < best) { best = dd; src = j; }
        }
        if (best >= R) continue;
        const t = 1 - best / R;
        this.near.push({ i, src, w: t * t * (3 - 2 * t), at: P.slice(i * 3, i * 3 + 3) });
      }
      for (const n of this.near) if (!this.startPos.has(n.src)) this.startPos.set(n.src, this.d.pos.slice(n.src * 3, n.src * 3 + 3));
    }

    this.partners = new Map();
    if (this.opt.mirror) {
      const P = this.d.pos, where = new Map(), id = (x, y, z) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
      for (let i = 0; i < P.length / 3; i++) where.set(id(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]), i);
      for (const i of this.verts) {
        const j = where.get(id(-P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
        if (j !== undefined && j !== i && !this.verts.has(j)) this.partners.set(i, j);
      }
    }
  }

  drag() {
    if (!this.startPos) return;
    this.pivot.updateMatrixWorld(true);
    this.mesh.updateWorldMatrix(true, false);
    const world = this.pivot.matrixWorld.clone().multiply(this.startMatrix.clone().invert());
    const w = this.mesh.matrixWorld, local = w.clone().invert().multiply(world).multiply(w), v = new THREE.Vector3();
    const moved = new Map();
    for (const [i, s] of this.startPos) {
      v.set(...s).applyMatrix4(local);
      moved.set(i, [v.x - s[0], v.y - s[1], v.z - s[2]]);
      this.d.pos[i * 3] = v.x; this.d.pos[i * 3 + 1] = v.y; this.d.pos[i * 3 + 2] = v.z;
      const j = this.partners?.get(i);
      if (j !== undefined) { this.d.pos[j * 3] = -v.x; this.d.pos[j * 3 + 1] = v.y; this.d.pos[j * 3 + 2] = v.z; }
    }
    for (const n of this.near || []) {
      const m = moved.get(n.src);
      if (m) for (let k = 0; k < 3; k++) this.d.pos[n.i * 3 + k] = n.at[k] + m[k] * n.w;
    }
    this.setPositions(this.mesh, this.d.pos);
    this.buildOverlay();
  }

  endDrag() {
    if (!this.startPos) return;
    const mesh = this.mesh, before = this.before, after = this.d.pos.slice();
    this.startPos = null;
    this.app.history.push({ do: () => this.restorePositions(mesh, after), undo: () => this.restorePositions(mesh, before) });
    this.movePivot();
  }

  setPositions(mesh, arr) {
    const a = mesh.geometry.attributes.position;
    a.array.set(arr);
    a.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.geometry.computeBoundingBox();
    this.app.engine.invalidate();
  }

  restorePositions(mesh, arr) {
    this.setPositions(mesh, arr);
    if (this.mesh === mesh) { this.d.pos = arr.slice(); this.refresh(); }
  }

  snapshot() { return { pos: this.d.pos.slice(), col: this.d.col && this.d.col.slice(), idx: this.d.idx.slice() }; }

  // go back to a saved state
  restore(mesh, s) {
    const d = { pos: s.pos.slice(), col: s.col && s.col.slice(), idx: s.idx.slice() };
    if (this.mesh === mesh) {
      this.d = d;
      this.write();
      this.clear();
      this.topology();
      this.refresh();
    } else {
      mesh.geometry.dispose();
      mesh.geometry = build(d);
      this.app.engine.invalidate();
    }
  }

  // call after an operation changed this.d
  commit(before) {
    const mesh = this.mesh, after = this.snapshot();
    this.write();
    this.topology();
    this.syncSel();
    this.refresh();
    this.app.history.push({ do: () => this.restore(mesh, after), undo: () => this.restore(mesh, before) });
  }

  run(op) {
    if (!this.mesh) return;
    ({
      extrude: () => this.extrude(false), inset: () => this.extrude(true), subdivide: () => this.subdivide(),
      delete: () => this.del(), merge: () => this.merge(), duplicate: () => this.duplicate(), separate: () => this.separate(),
      flip: () => this.flip(), all: () => this.selectAll(), none: () => this.selectNone(), invert: () => this.invert(),
      linked: () => this.selectLinked(), more: () => this.selectMore(true), less: () => this.selectMore(false),
      fill: () => this.fill(), smooth: () => this.smoothPoints(), sphere: () => this.toSphere(), shrink: () => this.shrinkFatten(),
      bevel: () => this.bevelEdges(), cut: () => this.loopCut(false), cutsel: () => this.loopCut(true), bridge: () => this.bridge(),
      normals: () => this.recalc(false), normalsin: () => this.recalc(true), doubles: () => this.removeDoubles(),
    })[op]?.();
  }

  // operations

  addVert(from, x, y, z) {
    const d = this.d;
    d.pos.push(x, y, z);
    if (d.col) d.col.push(d.col[from * 3], d.col[from * 3 + 1], d.col[from * 3 + 2]);
    return d.pos.length / 3 - 1;
  }

  addMid(a, b) {
    const d = this.d, P = d.pos, i = this.addVert(a, (P[a * 3] + P[b * 3]) / 2, (P[a * 3 + 1] + P[b * 3 + 1]) / 2, (P[a * 3 + 2] + P[b * 3 + 2]) / 2);
    if (d.col) for (let k = 0; k < 3; k++) d.col[i * 3 + k] = (d.col[a * 3 + k] + d.col[b * 3 + k]) / 2;
    return i;
  }

  extrude(inset) {
    if (!this.faces.size) return this.app.say('Select some faces first');
    const before = this.snapshot(), d = this.d, idx = d.idx, P = d.pos, sel = [...this.faces];
    const edgeCount = new Map(), normal = new Map(), center = new Map(), seen = new Map();
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
    const get = (m, i) => m.get(i) || m.set(i, new THREE.Vector3()).get(i);

    for (const t of sel) {
      const [a, b, c] = [0, 1, 2].map(k => idx[t * 3 + k]);
      A.set(P[a * 3], P[a * 3 + 1], P[a * 3 + 2]); B.set(P[b * 3], P[b * 3 + 1], P[b * 3 + 2]); C.set(P[c * 3], P[c * 3 + 1], P[c * 3 + 2]);
      const n = B.clone().sub(A).cross(C.clone().sub(A)).normalize(), mid = A.clone().add(B).add(C).divideScalar(3);
      for (const [x, y] of [[a, b], [b, c], [c, a]]) edgeCount.set(key(x, y), (edgeCount.get(key(x, y)) || 0) + 1);
      for (const i of [a, b, c]) { get(normal, i).add(n); get(center, i).add(mid); seen.set(i, (seen.get(i) || 0) + 1); }
    }

    // one new point for every point of the selected faces
    const map = new Map();
    for (const [i, n] of normal) {
      const v = new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      if (inset) v.lerp(center.get(i).divideScalar(seen.get(i)), this.opt.inset);
      else v.addScaledVector(n.normalize(), this.opt.extrude);
      map.set(i, this.addVert(i, v.x, v.y, v.z));
    }

    // walls along the border of the selection
    const walls = [];
    for (const t of sel) {
      const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
      for (const [x, y] of [[a, b], [b, c], [c, a]]) {
        if (edgeCount.get(key(x, y)) === 1) walls.push(x, y, map.get(y), x, map.get(y), map.get(x));
      }
    }
    for (const t of sel) for (let k = 0; k < 3; k++) idx[t * 3 + k] = map.get(idx[t * 3 + k]);
    walls.forEach(i => idx.push(i));

    compactData(d);
    this.selMode = 'face'; // the new faces stay selected
    this.commit(before);
  }

  // cuts triangles in 4
  subdivide() {
    const before = this.snapshot(), d = this.d, idx = d.idx, tris = idx.length / 3, mid = new Map();
    const target = this.faces.size ? [...this.faces] : range(0, tris);
    if (tris + target.length * 4 > 600000) return this.app.say('The mesh is too big to subdivide');
    for (const t of target) {
      for (let k = 0; k < 3; k++) {
        const a = idx[t * 3 + k], b = idx[t * 3 + (k + 1) % 3];
        if (!mid.has(key(a, b))) mid.set(key(a, b), this.addMid(a, b));
      }
    }
    const out = [];
    for (let t = 0; t < tris; t++) {
      const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
      split(a, b, c, mid.get(key(a, b)) ?? -1, mid.get(key(b, c)) ?? -1, mid.get(key(c, a)) ?? -1, out);
    }
    d.idx = out;
    this.clear();
    this.commit(before);
  }

  del() {
    const idx = this.d.idx, kill = new Set();
    if (this.selMode === 'face') this.faces.forEach(t => kill.add(t));
    else if (this.selMode === 'edge') this.edges.forEach(k => this.edgeMap.get(k).faces.forEach(t => kill.add(t)));
    else for (let t = 0; t < idx.length / 3; t++) if ([0, 1, 2].some(k => this.verts.has(idx[t * 3 + k]))) kill.add(t);
    if (!kill.size) return this.app.say('Nothing selected');
    const before = this.snapshot(), keep = [];
    for (let t = 0; t < idx.length / 3; t++) if (!kill.has(t)) keep.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
    this.d.idx = keep;
    compactData(this.d);
    this.clear();
    this.commit(before);
  }

  // all selected points become one point in the middle
  merge() {
    const ids = [...this.verts];
    if (ids.length < 2) return this.app.say('Select at least 2 points');
    const before = this.snapshot(), d = this.d, P = d.pos, keep = ids[0], c = new THREE.Vector3();
    ids.forEach(i => c.add(new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])));
    c.divideScalar(ids.length);
    P[keep * 3] = c.x; P[keep * 3 + 1] = c.y; P[keep * 3 + 2] = c.z;
    const merged = new Set(ids), out = [];
    for (let t = 0; t < d.idx.length / 3; t++) {
      const [a, b, e] = [0, 1, 2].map(k => (merged.has(d.idx[t * 3 + k]) ? keep : d.idx[t * 3 + k]));
      if (a !== b && b !== e && a !== e) out.push(a, b, e); // drop triangles that collapsed
    }
    d.idx = out;
    compactData(d);
    this.clear();
    this.commit(before);
  }

  // a copy of the selected faces, on top of the originals
  duplicate() {
    if (!this.faces.size) return this.app.say('Select some faces first');
    const before = this.snapshot(), d = this.d, idx = d.idx, map = new Map(), start = idx.length / 3;
    for (const t of this.faces) {
      for (let k = 0; k < 3; k++) {
        const i = idx[t * 3 + k];
        if (!map.has(i)) map.set(i, this.addVert(i, d.pos[i * 3], d.pos[i * 3 + 1], d.pos[i * 3 + 2]));
      }
    }
    for (const t of [...this.faces]) for (let k = 0; k < 3; k++) idx.push(map.get(idx[t * 3 + k]));
    this.selMode = 'face';
    this.faces = new Set(range(start, idx.length / 3));
    this.commit(before);
  }

  // the selected faces become a new object
  separate() {
    if (!this.faces.size) return this.app.say('Select some faces first');
    const before = this.snapshot(), d = this.d, mesh = this.mesh, w = this.app.engine.world;
    const part = { pos: d.pos.slice(), col: d.col && d.col.slice(), idx: [] }, rest = [];
    for (let t = 0; t < d.idx.length / 3; t++) (this.faces.has(t) ? part.idx : rest).push(d.idx[t * 3], d.idx[t * 3 + 1], d.idx[t * 3 + 2]);
    compactData(part);

    const obj = new THREE.Mesh(build(part), mesh.material.clone());
    obj.name = uniqueName(w, `${mesh.name}.Part`);
    obj.castShadow = obj.receiveShadow = true;
    obj.position.copy(mesh.position); obj.rotation.copy(mesh.rotation); obj.scale.copy(mesh.scale);
    this.app.history.do({
      do: () => w.add(obj),
      undo: () => w.remove(obj),
      dispose: done => { if (!done) disposeObject(obj); },
    });

    d.idx = rest;
    compactData(d);
    this.clear();
    this.commit(before);
  }

  // turns the selected faces
  flip() {
    const before = this.snapshot(), idx = this.d.idx;
    for (const t of this.faces.size ? this.faces : range(0, idx.length / 3)) [idx[t * 3 + 1], idx[t * 3 + 2]] = [idx[t * 3 + 2], idx[t * 3 + 1]];
    this.commit(before);
  }

  // more modeling tools

  working() { return this.verts.size ? new Set(this.verts) : new Set(range(0, this.d.pos.length / 3)); }

  // Select Linked
  selectLinked() {
    const idx = this.d.idx, start = new Set(this.faces);
    if (!start.size) for (let t = 0; t < idx.length / 3; t++) if ([0, 1, 2].some(k => this.verts.has(idx[t * 3 + k]))) start.add(t);
    if (!start.size) return this.app.say('Select something first');
    const all = linkedFaces(idx, start);
    if (this.selMode === 'face') this.faces = all;
    else if (this.selMode === 'vertex') this.verts = new Set([...all].flatMap(t => [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]]));
    else this.edges = new Set([...all].flatMap(t => [key(idx[t * 3], idx[t * 3 + 1]), key(idx[t * 3 + 1], idx[t * 3 + 2]), key(idx[t * 3 + 2], idx[t * 3])]));
    this.syncSel();
    this.refresh();
  }

  // Select More / Less
  selectMore(more) {
    if (!this.verts.size) return this.app.say('Select something first');
    const n = this.d.pos.length / 3;
    this.selMode = 'vertex';
    this.verts = more ? growVerts(this.d.idx, n, this.verts) : shrinkVerts(this.d.idx, n, this.verts);
    this.syncSel();
    this.refresh();
  }

  // Fill
  fill() {
    const before = this.snapshot(), start = this.d.idx.length / 3;
    if (!fillPoints(this.d, [...this.verts])) return this.app.say('Select at least 3 points');
    this.selMode = 'face';
    this.clear();
    this.faces = new Set(range(start, this.d.idx.length / 3));
    this.commit(before);
  }

  smoothPoints() {
    const before = this.snapshot();
    smoothSelected(this.d, this.working(), 0.5, 2);
    this.commit(before);
  }

  toSphere() {
    const before = this.snapshot();
    toSphere(this.d, this.working(), 1);
    this.commit(before);
  }

  // Shrink / Fatten
  shrinkFatten() {
    if (!this.verts.size) return this.app.say('Select some points first');
    const before = this.snapshot();
    shrinkFatten(this.d, this.verts, this.opt.shrink);
    this.commit(before);
  }

  // Recalculate Normals
  recalc(inside) {
    const before = this.snapshot();
    recalcNormals(this.d, inside);
    this.commit(before);
  }

  removeDoubles() {
    const before = this.snapshot(), n = this.d.pos.length / 3, w = weld({ pos: this.d.pos, col: this.d.col, idx: this.d.idx }, 0.0001);
    this.d.pos = w.pos; this.d.col = w.col; this.d.idx = w.idx;
    compactData(this.d);
    this.clear();
    this.commit(before);
    this.app.say(`Removed ${n - this.d.pos.length / 3} points`);
  }

  // Bevel
  bevelEdges() {
    if (!this.edges.size) return this.app.say('Select the edges to bevel');
    const before = this.snapshot(), n = this.d.idx.length;
    const r = bevel(this.d, { width: Math.max(0.001, this.opt.bevel), segments: this.opt.bsegs, edges: new Set(this.edges) });
    if (r.idx.length === n) return this.app.say('Nothing to bevel. Select a chain or a loop of edges between faces at an angle');
    this.d.pos = r.pos; this.d.idx = r.idx;
    if (this.d.col) this.d.col = new Array(r.pos.length).fill(1);
    this.clear();
    this.commit(before);
  }

  loopCut(throughSelection) {
    const axis = this.opt.cutAxis;
    let pos = this.opt.cutPos;
    if (throughSelection) {
      if (!this.verts.size) return this.app.say('Select some points first');
      pos = [...this.verts].reduce((s, v) => s + this.d.pos[v * 3 + axis], 0) / this.verts.size;
      this.opt.cutPos = +pos.toFixed(4);
    }
    const before = this.snapshot();
    const r = planeCut(this.d, axis, pos);
    if (!r.created.length) return this.app.say('The plane does not cut through the mesh. Change the position');
    const on = new Set(r.on), edges = new Set();
    for (let t = 0; t < this.d.idx.length; t += 3) for (let k = 0; k < 3; k++) {
      const a = this.d.idx[t + k], b = this.d.idx[t + (k + 1) % 3];
      if (on.has(a) && on.has(b)) edges.add(key(a, b));
    }
    this.clear();
    this.commit(before);
    this.selMode = 'edge';
    this.edges = edges;
    this.syncSel();
    this.refresh();
  }

  // Bridge Edge Loops: joins two selected loops with faces
  bridge() {
    if (!this.edges.size) return this.app.say('Select two edge loops (for example the edges around two holes)');
    const before = this.snapshot();
    const pairs = [...this.edges].map(k => k.split('_').map(Number));
    const err = bridgeLoops(this.d, pairs);
    if (err) return this.app.say(err);
    this.clear();
    this.commit(before);
  }
}
