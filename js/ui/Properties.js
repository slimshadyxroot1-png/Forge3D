import * as THREE from 'three';
import { snap } from '../core/Engine.js';

export class Properties {
  constructor(app, el) { this.a = app; this.el = el; this.cur = undefined; this.mode = null; }

  render() {
    const o = this.a.sel;
    // only rebuild the panel if the object or the mode changed
    if (o && o === this.cur && this.mode === this.a.mode) return this.sync();
    this.cur = o; this.mode = this.a.mode;
    if (!o) { this.el.innerHTML = '<div class="empty">No active object</div>'; return; }

    const xyz = (title, k) => `<div class="grp"><label>${title}</label><div class="xyz">${[0, 1, 2].map(i =>
      `<input type="number" step="${k === 'r' ? 1 : .1}" data-k="${k}" data-i="${i}">`).join('')}</div></div>`;
    const slider = (id, title, min, max) =>
      `<div class="grp"><label>${title}</label><input type="range" id="${id}" min="${min}" max="${max}" step="0.01"></div>`;

    let html = `<div class="grp"><label>Name</label><input id="pn"></div>
      ${xyz('Location', 'p')}${xyz('Rotation (degrees)', 'r')}${xyz('Scale', 's')}${o.isMesh ? xyz('Dimensions', 'd') : ''}`;

    if (o.isMesh) {
      html += `<h4>Material</h4>
        <div class="grp"><label>Color</label><input type="color" id="mc"></div>
        ${slider('mr', 'Roughness', 0, 1)}${slider('mm', 'Metallic', 0, 1)}`;
    }
    this.el.innerHTML = html;
    this.bind(o);
    this.sync();
  }

  bind(o) {
    const q = id => this.el.querySelector(id);
    q('#pn').onchange = e => this.a.rename(o, e.target.value.trim() || o.name);
    this.el.querySelectorAll('[data-k]').forEach(i => i.onchange = () => this.edit(i));

    if (o.isMesh) {
      const m = o.material;
      this.bindLive(q('#mc'), () => '#' + m.color.getHexString(), v => m.color.set(v));
      this.bindLive(q('#mr'), () => String(m.roughness), v => { m.roughness = +v; });
      this.bindLive(q('#mm'), () => String(m.metalness), v => { m.metalness = +v; });
    }
  }

  // the object changes while dragging
  bindLive(el, get, set) {
    let before;
    el.oninput = () => { before ??= get(); set(el.value); this.a.engine.invalidate(); };
    el.onchange = () => {
      const after = el.value, old = before;
      before = undefined;
      this.a.history.push({ do: () => set(after), undo: () => set(old) });
    };
  }

  // put the object's current values into the boxes
  sync() {
    const o = this.a.sel; if (!o) return;
    const put = (id, v) => { const i = this.el.querySelector(id); if (i && document.activeElement !== i) i.value = v; };
    const deg = THREE.MathUtils.radToDeg;
    let dims = [0, 0, 0];
    if (o.isMesh) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      dims = o.geometry.boundingBox.getSize(new THREE.Vector3()).multiply(o.scale).toArray();
    }
    const v = { p: o.position.toArray(), r: [o.rotation.x, o.rotation.y, o.rotation.z].map(deg), s: o.scale.toArray(), d: dims };
    this.el.querySelectorAll('[data-k]').forEach(i => {
      if (document.activeElement !== i) i.value = +v[i.dataset.k][i.dataset.i].toFixed(4);
    });
    put('#pn', o.name);
    if (o.isMesh) {
      put('#mc', '#' + o.material.color.getHexString());
      put('#mr', o.material.roughness);
      put('#mm', o.material.metalness);
    }
    const tick = (id, v) => { const c = this.el.querySelector(id); if (c) c.checked = v; };
  }

  edit(i) {
    const o = this.a.sel, n = parseFloat(i.value);
    if (!isFinite(n)) return this.sync();
    const before = snap(o), k = i.dataset.k, j = +i.dataset.i;
    if (k === 'p') o.position.setComponent(j, n);
    else if (k === 's') o.scale.setComponent(j, n);
    else if (k === 'd') {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const size = o.geometry.boundingBox.getSize(new THREE.Vector3()).getComponent(j);
      if (size > 1e-9 && n > 0) o.scale.setComponent(j, n / size);
    }
    else {
      const r = [o.rotation.x, o.rotation.y, o.rotation.z];
      r[j] = THREE.MathUtils.degToRad(n);
      o.rotation.set(...r);
    }
    this.a.commitTransform(o, before, snap(o));
  }
}
