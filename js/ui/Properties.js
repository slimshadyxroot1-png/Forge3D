import * as THREE from 'three';
import { snap } from '../core/Engine.js';
import { lightType, refreshGizmo } from '../scene/Lights.js';
import { fovFromLength, refreshCameraGizmo } from '../scene/Cameras.js';

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
    if (o.isCamera) html += this.cameraHtml();
    if (o.isLight) html += this.lightHtml(o);
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
    if (o.isCamera) this.bindCamera(o);
    if (o.isLight) this.bindLight(o);
  }

  cameraHtml() {
    const num = (id, title, step) => `<div class="grp"><label>${title}</label><input type="number" id="${id}" step="${step}"></div>`;
    return `<h4>Camera <span id="cstate"></span></h4>${num('cf', 'Focal Length (mm)', 1)}${num('cn', 'Clip Start', 0.1)}${num('cfar', 'Clip End', 10)}
      <div class="grp btns"><button id="cact">Set Active</button><button id="cview">View Through</button><button id="calign">Align To View</button></div>`;
  }

  bindCamera(c) {
    const q = id => this.el.querySelector(id), a = this.a;
    this.bindLive(q('#cf'), () => String(c.userData.focal), v => {
      c.userData.focal = Math.max(5, +v || 50);
      c.fov = fovFromLength(c.userData.focal);
      c.updateProjectionMatrix();
      refreshCameraGizmo(c); // the pyramid changes with the lens
    });
    this.bindLive(q('#cn'), () => String(c.near), v => { c.near = Math.max(0.001, +v || 0.1); c.updateProjectionMatrix(); });
    this.bindLive(q('#cfar'), () => String(c.far), v => { c.far = Math.max(c.near + 0.1, +v || 100); c.updateProjectionMatrix(); });
    q('#cact').onclick = () => a.setActiveCamera(c);
    q('#cview').onclick = () => { a.camActive = c; a.enterCameraView(); a.refresh(); };
    q('#calign').onclick = () => a.alignCamera(c);
  }

  lightHtml(l) {
    const type = lightType(l);
    const num = (id, title, step) =>
      `<div class="grp"><label>${title}</label><input type="number" id="${id}" step="${step}" min="0"></div>`;
    return `<h4>Light</h4>
      <div class="grp"><label>Type</label><select id="lt">
        <option value="point">Point</option>
        <option value="sun">Sun</option>
        <option value="spot">Spot</option>
        <option value="area">Area</option></select></div>
      <div class="grp"><label>Color</label><input type="color" id="lc"></div>
      ${num('li', type === 'sun' ? 'Strength' : 'Power', 0.5)}
      ${type === 'sun' || type === 'area' ? '' : num('ld', 'Range (0 = unlimited)', 1)}
      ${type === 'spot' ? num('la', 'Spot Size (degrees)', 1) +
        '<div class="grp"><label>Blend</label><input type="range" id="lp" min="0" max="1" step="0.01"></div>' : ''}
      ${type === 'area' ? num('lw', 'Width', 0.1) + num('lh', 'Height', 0.1) : '<div class="grp"><label><input type="checkbox" id="ls">Cast Shadows</label></div>'}`;
  }

  bindLight(l) {
    const q = id => this.el.querySelector(id), a = this.a, rad = THREE.MathUtils.degToRad;
    q('#lt').onchange = e => a.setLightType(l, e.target.value);
    this.bindLive(q('#lc'), () => '#' + l.color.getHexString(), v => l.color.set(v));
    this.bindLive(q('#li'), () => String(l.intensity), v => { l.intensity = Math.max(0, +v || 0); });
    if (q('#ld')) this.bindLive(q('#ld'), () => String(l.distance), v => { l.distance = Math.max(0, +v || 0); });
    if (q('#la')) {
      this.bindLive(q('#la'), () => String(Math.round(THREE.MathUtils.radToDeg(l.angle))), v => {
        l.angle = rad(Math.min(89, Math.max(1, +v || 1)));
        refreshGizmo(l); // the cone icon changes with the angle
      });
      this.bindLive(q('#lp'), () => String(l.penumbra), v => { l.penumbra = +v; });
    }
    if (q('#lw')) {
      this.bindLive(q('#lw'), () => String(l.width), v => { l.width = Math.max(0.1, +v || 1); refreshGizmo(l); });
      this.bindLive(q('#lh'), () => String(l.height), v => { l.height = Math.max(0.1, +v || 1); refreshGizmo(l); });
    }
    if (q('#ls')) q('#ls').onchange = e => {
      const on = e.target.checked, old = l.castShadow;
      a.history.do({
        do: () => { l.castShadow = on; a.engine.invalidate(); },
        undo: () => { l.castShadow = old; a.engine.invalidate(); },
      });
    };
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
    if (o.isCamera) {
      put('#cf', o.userData.focal); put('#cn', o.near); put('#cfar', o.far);
      const state = this.el.querySelector('#cstate');
      if (state) state.textContent = this.a.activeCamera() === o ? '(active)' : '';
    }
    if (o.isLight) {
      put('#lt', lightType(o)); put('#lc', '#' + o.color.getHexString());
      put('#li', o.intensity); put('#ld', o.distance); put('#lp', o.penumbra); put('#lw', o.width); put('#lh', o.height);
      put('#la', Math.round(deg(o.angle)));
      const shadow = this.el.querySelector('#ls');
      if (shadow) shadow.checked = o.castShadow;
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
