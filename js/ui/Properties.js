import * as THREE from 'three';
import { snap } from '../core/Engine.js';
import { lightType, refreshGizmo } from '../scene/Lights.js';
import { MODIFIERS, evaluate } from '../scene/Modifiers.js';
import { fovFromLength, refreshCameraGizmo } from '../scene/Cameras.js';
import { BRUSHES } from '../tools/Brush.js';

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
    if (o.isMesh && this.a.mode === 'object') html += this.objectToolsHtml();
    if (o.isMesh) html += this.modHtml(o);
    if (o.isCamera) html += this.cameraHtml();
    if (o.isLight) html += this.lightHtml(o);
    if (this.a.mode === 'sculpt' || this.a.mode === 'paint') {
      const paint = this.a.mode === 'paint';
      const pick = (id, title, items) => `<div class="grp"><label>${title}</label><select id="${id}">${
        Object.entries(items).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>`;
      const check = (id, title) => `<div class="grp"><label><input type="checkbox" id="${id}">${title}</label></div>`;
      html += `<h4>${paint ? 'Paint' : 'Sculpt'} Brush</h4>
        ${paint ? '<div class="grp"><label>Brush Color</label><input type="color" id="bc"></div>' : pick('bt', 'Brush (Ctrl = reverse)', BRUSHES)}
        ${slider('br', 'Radius', 0.05, 2)}${slider('bs', 'Strength', 0.05, 1)}${slider('bsp', 'Spacing', 0.02, 1)}
        ${pick('bf', 'Falloff', { smooth: 'Smooth', linear: 'Linear', sharp: 'Sharp' })}
        <div class="grp"><label>Symmetry</label><div class="btns">${['x', 'y', 'z'].map((a, k) =>
          `<label class="check"><input type="checkbox" data-sym="${k}">${a.toUpperCase()}</label>`).join('')}</div></div>
        <div class="grp"><label>Radial Symmetry (copies around Z)</label><input type="number" id="brad" min="1" max="12" step="1"></div>
        ${check('bsub', 'Subtract (reverse the brush)')}${check('bpen', 'Pen pressure')}`;
      if (!paint) {
        html += `<h4>Mask and Detail</h4>
          <div class="grp btns"><button data-mask="invert">Invert Mask</button><button data-mask="clear">Clear Mask</button><button data-mask="blur">Blur Mask</button></div>
          <div class="grp btns"><button data-detail="subdivide">Add Detail (Subdivide)</button><button data-detail="smooth">Smooth Mesh</button></div>
          <div class="empty">Choose the Mask brush to paint a mask. Masked points do not move.</div>`;
      }
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
    if (o.isMesh) this.bindMods(o);
    this.el.querySelectorAll('[data-otool]').forEach(b => {
      b.onclick = () => { const [act, arg] = b.dataset.otool.split(':'); this.a.act(act, arg); };
    });
    if (o.isCamera) this.bindCamera(o);
    if (o.isLight) this.bindLight(o);
    if (q('#br')) {
      q('#br').oninput = e => { opt.radius = +e.target.value; };
      q('#bs').oninput = e => { opt.strength = +e.target.value; };
      q('#bsp').oninput = e => { opt.space = +e.target.value; };
      q('#bf').onchange = e => { opt.falloff = e.target.value; };
      this.el.querySelectorAll('[data-sym]').forEach(c => { c.onchange = () => { opt.sym[+c.dataset.sym] = c.checked; }; });
    }
    if (q('#bt')) q('#bt').onchange = e => { opt.type = e.target.value; };
    if (q('#bc')) q('#bc').oninput = e => { opt.color = e.target.value; };
    if (q('#brad')) {
      q('#brad').oninput = e => { opt.radial = Math.max(1, Math.min(12, Math.round(+e.target.value) || 1)); };
      q('#bsub').onchange = e => { opt.subtract = e.target.checked; };
      q('#bpen').onchange = e => { opt.pressure = e.target.checked; };
    }
    {
      const a = this.a;
      this.el.querySelectorAll('[data-mask]').forEach(b => { b.onclick = () => a.brush.maskOp(b.dataset.mask); });
      this.el.querySelectorAll('[data-detail]').forEach(b => { b.onclick = () => (b.dataset.detail === 'subdivide' ? a.brush.subdivideMesh() : a.brush.smoothMesh()); });
    }
  }

  objectToolsHtml() {
    const b = (t, label, tip = '') => `<button data-otool="${t}" title="${tip}">${label}</button>`;
    return `<h4>Object Tools</h4>
      <div class="grp"><label>Apply (bake into the mesh, Ctrl A)</label><div class="btns">${b('apply:location', 'Location')}${b('apply:rotation', 'Rotation')}${b('apply:scale', 'Scale')}${b('apply:all', 'All')}</div></div>
      <div class="grp"><label>Set Origin</label><div class="btns">${b('origin:geometry', 'To Geometry')}${b('origin:mass', 'To Center of Mass')}</div></div>
      <div class="grp"><label>Shading</label><div class="btns">${b('shademesh:smooth', 'Shade Smooth')}${b('shademesh:flat', 'Shade Flat')}</div></div>
      <div class="grp"><label>Combine with another mesh</label><div class="btns">${b('join', 'Join (Ctrl J)')}${b('boolean', 'Boolean...')}</div></div>`;
  }

  modHtml(o) {
    const stack = o.userData.modifiers || [];
    const field = (i, [key, label, kind, opt]) => kind === 'button'
      ? `<div class="grp"><button data-nodes="${i}">${label}</button></div>`
      : kind === 'select'
      ? `<div class="grp"><label>${label}</label><select data-i="${i}" data-key="${key}">${opt.map(v => `<option value="${v}">${v.toUpperCase()}</option>`).join('')}</select></div>`
      : `<div class="grp"><label>${label}</label><input type="number" data-i="${i}" data-key="${key}" step="${opt.step}" min="${opt.min ?? ''}"></div>`;
    const blocks = stack.map((m, i) => `<div class="mod">
      <div class="modhead">
        <input type="checkbox" data-op="toggle" data-i="${i}" title="Show in viewport">
        <span>${MODIFIERS[m.type].label}</span>
        <button data-op="up" data-i="${i}" title="Move up">&uarr;</button>
        <button data-op="down" data-i="${i}" title="Move down">&darr;</button>
        <button data-op="apply" data-i="${i}" title="Apply this modifier and the ones before it">Apply</button>
        <button data-op="remove" data-i="${i}" title="Remove">&times;</button>
      </div>${MODIFIERS[m.type].fields.map(f => field(i, f)).join('')}</div>`).join('');
    const options = Object.entries(MODIFIERS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
    return `<h4>Modifiers</h4>${blocks}<div class="grp"><select id="addmod"><option value="">Add Modifier...</option>${options}</select></div>`;
  }

  bindMods(o) {
    const a = this.a, stack = o.userData.modifiers || [];
    this.el.querySelector('#addmod').onchange = e => { if (e.target.value) a.addModifier(o, e.target.value); };
    this.el.querySelectorAll('[data-op]').forEach(el => {
      const i = +el.dataset.i, op = el.dataset.op;
      if (op === 'toggle') el.onchange = () => a.toggleModifier(o, i);
      else el.onclick = () => ({
        up: () => a.moveModifier(o, i, -1), down: () => a.moveModifier(o, i, 1),
        apply: () => a.applyModifier(o, i), remove: () => a.removeModifier(o, i),
      })[op]();
    });
    this.el.querySelectorAll('[data-key]').forEach(el => {
      const m = stack[+el.dataset.i], key = el.dataset.key;
      this.bindLive(el, () => String(m[key]), v => {
        m[key] = el.tagName === 'SELECT' ? v : (Number.isFinite(+v) ? +v : m[key]);
        evaluate(o);
        a.engine.invalidate();
      });
    });
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
    if (o.isMesh) {
      const m = o.material, stack = o.userData.modifiers || [];
      this.el.querySelectorAll('[data-key]').forEach(el => {
        if (document.activeElement !== el) el.value = stack[+el.dataset.i]?.[el.dataset.key];
      });
      this.el.querySelectorAll('[data-op=toggle]').forEach(el => { el.checked = !!stack[+el.dataset.i]?.enabled; });
    }
    if (o.isLight) {
      put('#lt', lightType(o)); put('#lc', '#' + o.color.getHexString());
      put('#li', o.intensity); put('#ld', o.distance); put('#lp', o.penumbra); put('#lw', o.width); put('#lh', o.height);
      put('#la', Math.round(deg(o.angle)));
      const shadow = this.el.querySelector('#ls');
      if (shadow) shadow.checked = o.castShadow;
    }
    const opt = this.a.brush.opt;
    put('#br', opt.radius); put('#bs', opt.strength); put('#bt', opt.type); put('#bc', opt.color);
    put('#bsp', opt.spacing); put('#bf', opt.falloff); put('#brad', opt.radial);
    const tick = (id, v) => { const c = this.el.querySelector(id); if (c) c.checked = v; };
    tick('#bsub', opt.subtract); tick('#bpen', opt.pressure);
    this.el.querySelectorAll('[data-sym]').forEach(c => { c.checked = opt.sym[+c.dataset.sym]; });
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
