import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const BRUSHES = {
  draw: 'Draw', drawsharp: 'Draw Sharp', clay: 'Clay', claystrips: 'Clay Strips', layer: 'Layer', inflate: 'Inflate', blob: 'Blob',
  smooth: 'Smooth', flatten: 'Flatten', scrape: 'Scrape', fill: 'Fill', pinch: 'Pinch', crease: 'Crease',
  grab: 'Grab', elastic: 'Elastic Deform', snake: 'Snake Hook', mask: 'Mask',
};

// how strong the brush is from the middle
const FALLOFF = { smooth: t => (1 - t * t) ** 2, linear: t => 1 - t, sharp: t => (1 - t) ** 3 };
const UP = new THREE.Vector3(0, 0, 1);

export class Brush {
  constructor(app) {
    this.app = app;
    this.opt = {
      type: 'draw', radius: 0.4, strength: 0.5, falloff: 'smooth', spacing: 0.1, sym: [false, false, false],
      radial: 1, subtract: false, pressure: true, color: '#d9402b',
    };
    this.adj = new WeakMap(); // neighbours of each point, used by smooth
    this.press = 1;

    // the circle that shows where the brush is
    const circle = Array.from({ length: 48 }, (_, i) => new THREE.Vector3(Math.cos(i / 48 * Math.PI * 2), Math.sin(i / 48 * Math.PI * 2), 0));
    this.ring = app.engine.cursor = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(circle), new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }));
    this.ring.visible = false;
    this.ring.renderOrder = 10;
    app.engine.scene.add(this.ring);

    const dom = app.engine.renderer.domElement;
    dom.addEventListener('pointerdown', e => this.down(e));
    dom.addEventListener('pointermove', e => this.move(e));
    dom.addEventListener('pointerleave', () => { this.ring.visible = false; app.engine.invalidate(); });
    addEventListener('pointerup', () => this.up());
  }

  prepare(mesh) {
    let g = mesh.geometry;
    if (g.userData.ready) {
      if (!g.attributes.mask) g.setAttribute('mask', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));
      return;
    }
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    g = mergeVertices(g);
    g.computeVertexNormals();
    // start the vertex colors with the current material color
    const c = mesh.material.color, n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('mask', new THREE.BufferAttribute(new Float32Array(n), 1)); // 0 = free, 1 = protected
    g.userData.ready = true;
    mesh.geometry.dispose();
    mesh.geometry = g;
    mesh.material.color.set(0xffffff);
    mesh.material.vertexColors = true;
    mesh.material.needsUpdate = true;
  }

  // list of neighbours for every point
  neighbours(g) {
    let list = this.adj.get(g);
    if (list) return list;
    list = Array.from({ length: g.attributes.position.count }, () => new Set());
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        list[idx[i + k]].add(idx[i + (k + 1) % 3]);
        list[idx[i + k]].add(idx[i + (k + 2) % 3]);
      }
    }
    list = list.map(s => [...s]);
    this.adj.set(g, list);
    return list;
  }

  // brush size in the mesh's own units
  localRadius(m) { return this.opt.radius / ((m.scale.x + m.scale.y + m.scale.z) / 3); }

  setPressure(e) { this.press = this.opt.pressure && e.pointerType === 'pen' ? Math.max(0.05, e.pressure) : 1; }

  down(e) {
    const a = this.app, m = a.sel;
    if (e.button !== 0 || (a.mode !== 'sculpt' && a.mode !== 'paint') || !m?.isMesh) return;
    if (e.altKey || a.engine.space) return; // Alt or Space means move the camera
    if (!a.engine.hit(e, m)) return; // a click next to the mesh moves the camera
    this.prepare(m);
    this.mesh = m;
    this.key = a.mode === 'paint' ? 'color' : this.opt.type === 'mask' ? 'mask' : 'position';
    this.attr = m.geometry.getAttribute(this.key);
    this.before = this.attr.array.slice(); // copy for undo
    this.last = null;
    this.snake = null;
    this.setPressure(e);
    if (this.key === 'position' && (this.opt.type === 'grab' || this.opt.type === 'elastic')) this.startGrab(e);
    else this.stroke(e);
  }

  move(e) {
    this.showRing(e);
    this.setPressure(e);
    if (this.mesh && e.buttons & 1) this.grab ? this.dragGrab(e) : this.stroke(e);
  }

  showRing(e) {
    const a = this.app, m = a.sel;
    const hit = (a.mode === 'sculpt' || a.mode === 'paint') && m?.isMesh ? a.engine.hit(e, m) : null;
    this.ring.visible = !!hit;
    if (hit) {
      const n = hit.face.normal.clone().transformDirection(m.matrixWorld);
      this.ring.position.copy(hit.point).addScaledVector(n, 0.002);
      this.ring.quaternion.setFromUnitVectors(UP, n);
      this.ring.scale.setScalar(this.opt.radius);
    }
    a.engine.invalidate();
  }

  // grab: pick up the points under the brush
  startGrab(e) {
    const eng = this.app.engine, m = this.mesh, o = this.opt, hit = eng.hit(e, m), elastic = o.type === 'elastic';
    if (!hit) { this.mesh = null; return; }
    const g = m.geometry, pos = g.attributes.position, mask = g.attributes.mask, p = m.worldToLocal(hit.point.clone());
    const r = this.localRadius(m) * (elastic ? 1.8 : 1), fall = elastic ? FALLOFF.smooth : FALLOFF[o.falloff], v = new THREE.Vector3();
    const normal = eng.camera.getWorldDirection(new THREE.Vector3()).negate();
    this.grab = { start: hit.point.clone(), plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.point), items: [] };
    for (let i = 0; i < pos.count; i++) {
      const d = v.fromBufferAttribute(pos, i).distanceTo(p);
      if (d < r) this.grab.items.push({ i, w: fall(d / r) * (1 - mask.array[i]), at: v.toArray() });
    }
  }

  dragGrab(e) {
    const eng = this.app.engine, m = this.mesh, pos = m.geometry.attributes.position;
    const point = eng.ray(e).ray.intersectPlane(this.grab.plane, new THREE.Vector3());
    if (!point) return;
    const delta = m.worldToLocal(point).sub(m.worldToLocal(this.grab.start.clone()));
    for (const { i, w, at } of this.grab.items) pos.setXYZ(i, at[0] + delta.x * w, at[1] + delta.y * w, at[2] + delta.z * w);
    this.attr.needsUpdate = true;
    refresh(m.geometry);
    eng.invalidate();
  }

  stroke(e) {
    const m = this.mesh, eng = this.app.engine, o = this.opt, hit = eng.hit(e, m);
    if (!hit) return;
    const center = m.worldToLocal(hit.point.clone());
    const snake = o.type === 'snake' && this.key === 'position';
    // wait until the mouse moved far enough
    if (!snake && this.last && this.last.distanceTo(hit.point) < o.spacing * o.radius) return;
    this.last = hit.point.clone();
    this.pull = snake ? center.clone().sub(this.snake || center) : null; // how far the cursor moved
    this.snake = center.clone();

    let spots = [center];
    if (!snake) {
      o.sym.forEach((on, axis) => {
        if (on) spots = spots.concat(spots.map(s => { const c = s.clone(); c.setComponent(axis, -c.getComponent(axis)); return c; }));
      });
      if (o.radial > 1) spots = spots.flatMap(s => Array.from({ length: o.radial }, (_, k) => s.clone().applyAxisAngle(UP, k * Math.PI * 2 / o.radial)));
    }
    const dir = (e.ctrlKey ? -1 : 1) * (o.subtract ? -1 : 1);
    for (const s of spots) this.dab(s, dir);

    this.attr.needsUpdate = true;
    if (this.key === 'position') refresh(m.geometry);
    if (this.key === 'mask') this.refreshMask(m);
    eng.invalidate();
  }

  // one brush touch at point p
  dab(p, dir) {
    const g = this.mesh.geometry, pos = g.attributes.position, nor = g.attributes.normal, mask = g.attributes.mask, o = this.opt;
    const r = this.localRadius(this.mesh), fall = o.type === 'drawsharp' ? FALLOFF.sharp : FALLOFF[o.falloff];
    const v = new THREE.Vector3(), n = new THREE.Vector3(), t = new THREE.Vector3(), area = new THREE.Vector3(), orig = new THREE.Vector3();
    const power = o.strength * this.press;

    // points inside the brush and how strongly they are touched
    const hits = [];
    for (let i = 0; i < pos.count; i++) {
      const d = v.fromBufferAttribute(pos, i).distanceTo(p);
      if (d < r) hits.push([i, fall(d / r)]);
    }
    if (!hits.length) return;

    if (this.key === 'mask') {
      for (const [i, w] of hits) mask.array[i] = Math.min(1, Math.max(0, mask.array[i] + dir * w * Math.min(1, power) * 0.6));
      return;
    }
    if (this.key === 'color') {
      const col = g.attributes.color, paint = new THREE.Color(o.color);
      for (const [i, w0] of hits) {
        const k = Math.min(1, w0 * (1 - mask.array[i]) * power);
        col.setXYZ(i, col.getX(i) + (paint.r - col.getX(i)) * k, col.getY(i) + (paint.g - col.getY(i)) * k, col.getZ(i) + (paint.b - col.getZ(i)) * k);
      }
      return;
    }

    // the surface direction under the brush
    for (const [i, w] of hits) area.add(n.fromBufferAttribute(nor, i).multiplyScalar(w));
    area.normalize();
    const amount = power * 0.1 * r * dir, strong = Math.min(1, power), near = o.type === 'smooth' ? this.neighbours(g) : null;

    for (const [i, w0] of hits) {
      const w = w0 * (1 - mask.array[i]); // masked points do not move
      if (w <= 0) continue;
      v.fromBufferAttribute(pos, i);
      const side = t.copy(v).sub(p).dot(area);
      const toMiddle = () => t.copy(p).sub(v).addScaledVector(area, -t.dot(area)); // sideways pull to the middle
      switch (o.type) {
        case 'draw': case 'drawsharp': v.addScaledVector(area, amount * w); break;
        case 'inflate': v.addScaledVector(n.fromBufferAttribute(nor, i), amount * w); break;
        case 'clay': v.addScaledVector(area, -side * w * 0.5 + amount * w * 0.3); break;
        case 'claystrips': v.addScaledVector(area, -side * w * strong + amount * w * 0.5); break;
        case 'layer': {
          orig.set(this.before[i * 3], this.before[i * 3 + 1], this.before[i * 3 + 2]).addScaledVector(area, power * 0.25 * r * dir);
          v.lerp(orig, Math.min(1, w * 0.6));
          break;
        }
        case 'blob': v.addScaledVector(t.copy(v).sub(p).normalize(), amount * w * 0.5).addScaledVector(n.fromBufferAttribute(nor, i), amount * w * 0.5); break;
        case 'flatten': v.addScaledVector(area, -side * w * strong); break;
        case 'scrape': if (side > 0) v.addScaledVector(area, -side * w * strong); break;
        case 'fill': if (side < 0) v.addScaledVector(area, -side * w * strong); break;
        case 'pinch': v.addScaledVector(toMiddle(), w * strong * 0.3 * dir); break;
        case 'crease': v.addScaledVector(toMiddle(), w * strong * 0.3 * dir).addScaledVector(area, -amount * w * 0.5); break;
        case 'snake': if (this.pull) v.addScaledVector(this.pull, w); break;
        case 'smooth': {
          t.set(0, 0, 0);
          near[i].forEach(j => t.add(n.fromBufferAttribute(pos, j)));
          v.lerp(t.divideScalar(near[i].length), w * strong * 0.5);
          break;
        }
      }
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }

  // stroke finished, save it as one undo step
  up() {
    if (!this.mesh) return;
    const mesh = this.mesh, attr = this.attr, before = this.before;
    this.mesh = null;
    this.grab = null;
    this.last = null;
    this.snake = null;
    this.pushArray(mesh, attr, before, this.key);
  }

  // records the change of one attribute
  pushArray(mesh, attr, before, key) {
    const g = mesh.geometry, after = attr.array.slice(), eng = this.app.engine;
    if (!after.some((x, i) => x !== before[i])) return;
    const set = arr => {
      attr.array.set(arr);
      attr.needsUpdate = true;
      if (key === 'position') refresh(g);
      if (key === 'mask') this.refreshMask(mesh);
      eng.invalidate();
    };
    this.app.history.push({ do: () => set(after), undo: () => set(before) });
  }

  // mask tools

  maskOp(op) {
    const m = this.app.sel;
    if (!m?.isMesh || this.app.mode !== 'sculpt') return;
    this.prepare(m);
    const attr = m.geometry.attributes.mask, a = attr.array, before = a.slice();
    if (op === 'clear') a.fill(0);
    else if (op === 'invert') for (let i = 0; i < a.length; i++) a[i] = 1 - a[i];
    else {
      const near = this.neighbours(m.geometry), copy = a.slice();
      for (let i = 0; i < a.length; i++) a[i] = (copy[i] + near[i].reduce((s, j) => s + copy[j], 0)) / (near[i].length + 1);
    }
    attr.needsUpdate = true;
    this.pushArray(m, attr, before, 'mask');
    this.refreshMask(m);
  }

  // dark dots on the masked points
  refreshMask(mesh) {
    this.clearMask();
    const mask = mesh?.geometry.attributes.mask;
    if (!mask || this.app.mode !== 'sculpt') return;
    const pos = mesh.geometry.attributes.position, list = [];
    for (let i = 0; i < mask.count; i++) if (mask.array[i] > 0.3) list.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (!list.length) return;
    const dots = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(list, 3)),
      new THREE.PointsMaterial({ color: 0x151515, size: 5, sizeAttenuation: false }));
    dots.userData.gizmo = true; // hidden in renders and exports
    mesh.add(dots);
    this.dots = dots;
    this.dotsMesh = mesh;
  }

  clearMask() {
    if (!this.dots) return;
    this.dotsMesh.remove(this.dots);
    this.dots.geometry.dispose();
    this.dots.material.dispose();
    this.dots = null;
  }

  // more detail

  // every triangle becomes 4
  subdivideMesh() {
    const m = this.app.sel;
    if (!m?.isMesh || this.app.mode !== 'sculpt') return;
    this.prepare(m);
    const g = m.geometry, idx = g.index.array, n = g.attributes.position.count;
    if (idx.length / 3 * 4 > 800000) return this.app.say('The mesh is too big to subdivide');
    const pos = Array.from(g.attributes.position.array), col = Array.from(g.attributes.color.array), mask = Array.from(g.attributes.mask.array);
    const cache = new Map(), out = [];
    const mid = (a, b) => {
      const id = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (!cache.has(id)) {
        for (let k = 0; k < 3; k++) { pos.push((pos[a * 3 + k] + pos[b * 3 + k]) / 2); col.push((col[a * 3 + k] + col[b * 3 + k]) / 2); }
        mask.push((mask[a] + mask[b]) / 2);
        cache.set(id, pos.length / 3 - 1);
      }
      return cache.get(id);
    };
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2], ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      out.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    const next = new THREE.BufferGeometry();
    next.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    next.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    next.setAttribute('mask', new THREE.Float32BufferAttribute(mask, 1));
    next.setIndex(out);
    refresh(next);
    next.userData.ready = true;
    const old = m.geometry, set = geo => { m.geometry = geo; this.refreshMask(m); this.app.engine.invalidate(); };
    this.app.history.do({ do: () => set(next), undo: () => set(old), dispose: done => (done ? old : next).dispose() });
  }

  // one smoothing pass over the whole mesh
  smoothMesh() {
    const m = this.app.sel;
    if (!m?.isMesh || this.app.mode !== 'sculpt') return;
    this.prepare(m);
    const g = m.geometry, attr = g.attributes.position, a = attr.array, before = a.slice(), near = this.neighbours(g), mask = g.attributes.mask.array;
    for (let i = 0; i < near.length; i++) {
      if (!near[i].length) continue;
      const k = 0.5 * (1 - mask[i]);
      for (let c = 0; c < 3; c++) a[i * 3 + c] = before[i * 3 + c] + (near[i].reduce((s, j) => s + before[j * 3 + c], 0) / near[i].length - before[i * 3 + c]) * k;
    }
    attr.needsUpdate = true;
    refresh(g);
    this.pushArray(m, attr, before, 'position');
  }
}

function refresh(g) {
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
}
