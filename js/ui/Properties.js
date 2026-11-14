import * as THREE from 'three';
import { snap } from '../core/Engine.js';
import { lightType, refreshGizmo } from '../scene/Lights.js';
import { MODIFIERS, evaluate } from '../scene/Modifiers.js';
import { applyTiling } from '../scene/Textures.js';
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
    if (this.a.mode === 'edit') html += this.editHtml();
    if (this.a.mode === 'texpaint') html += this.texPaintHtml(slider);
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
    const q = id => this.el.querySelector(id), opt = this.a.brush.opt;
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
    if (this.a.mode === 'edit') this.bindEdit();
    if (o.isCamera) this.bindCamera(o);
    if (o.isLight) this.bindLight(o);
    if (q('#br')) {
      q('#br').oninput = e => { opt.radius = +e.target.value; };
      q('#bs').oninput = e => { opt.strength = +e.target.value; };
      q('#bsp').oninput = e => { opt.spacing = +e.target.value; };
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
      if (q('#tpc')) { // texture paint panel
        const tp = a.textpaint.opt;
        q('#tpc').oninput = e => { tp.color = e.target.value; };
        q('#tpr').oninput = e => { tp.radius = +e.target.value; };
        q('#tps').oninput = e => { tp.strength = +e.target.value; };
        q('#tpe').onchange = e => { tp.erase = e.target.checked; };
        this.el.querySelectorAll('[data-tp]').forEach(b => {
          b.onclick = () => (b.dataset.tp === 'fill' ? a.texpaint.fill(tp.erase ? '#ffffff' :  tp.color) : a.texpaint.exportPNG(a.sel));
        });
      }
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

  textureHTML() {
    const slot = (id, title) => `<div class="grp"><label>${title} <span id="s-${id}"></span></label>
      <div class="btns"><button id="b-${id}">Load...</button><button id="x-${id}">Remove</button><button id="v-${id}">Save</button></div></div>`;
    const num = (id, title, step) => `<div class="grp"><label>${title}</label><input type="number" id="${id}" step="${step}"></div>`;
    return `<h4>Texture</h4>${slot('map', 'Base Color Map')}${slot('normal', 'Normal Map')}
      ${num('ttile', 'Tiling', 0.1)}${num('trot', 'Rotation (degrees)', 5)}`;
  }

  bindTexture(o) {
    const q = id => this.el.querySelector(id), m = o.material, a = this.a;
    q('#b-map').onclick = () => a.loadTexture(o, 'map');
    q('#x-map').onclick = () => a.loadTexture(o, 'map', true);
    q('#b-normal').onclick = () => a.loadTexture(o, 'normalMap');
    q('#x-normal').onclick = () => a.loadTexture(o, 'normalMap', true);
    q('#v-map').onclick = () => a.exportTexture(o, 'map');
    q('#v-normal').onclick = () => a.exportTexture(o, 'normalMap');
    this.bindLive(q('#title'), () => String(m.userData.tiling ?? 1), v => { m.userData.tiling = +v || 1; applyTiling(m); a.engine.invalidate(); });
    this.bindLive(q('#trot'), () => String(m.userData.rotation ?? 0), v => { m.userData.rotation = +v || 0; applyTiling(m); a.engine.invalidate(); });
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

  texPaintHtml(slider) {
    return `<h4>Texture Paint</h4>
      <div class="grp"><label>Color</label><input type="color" id="tpc"></div>
      ${slider('tpr', 'Radius (pixels)', 4, 120)}${slider('tps', 'Strength', 0.05, 1)}
      <div class="grp"><label><input type="checkbox" id="tpe">Eraser (paints white)</label></div>
      <div class="grp btns"><button data-tp="fill">Fill</button><button data-tp="export">Export PNG</button></div>
      <div class="empty">The mesh needs UVs. Use the UV Editor first.</div>`;
  }

  editHtml() {
    const btn = (op, label) => `<button data-eop="${op}">${label}</button>`;
    const num = (id, title, step) => `<div class="grp"><label>${title}</label><input type="number" id="${id}" step="${step}"></div>`;
    return `<h4>Edit Mode</h4>
      <div class="grp btns">${['vertex', 'edge', 'face'].map(m => `<button data-emode="${m}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>
      <div class="grp btns">${btn('extrude', 'Extrude')}${btn('inset', 'Inset')}${btn('subdivide', 'Subdivide')}</div>
      <div class="grp btns">${btn('merge', 'Merge')}${btn('duplicate', 'Duplicate')}${btn('separate', 'Separate')}</div>
      <div class="grp btns">${btn('delete', 'Delete')}${btn('flip', 'Flip Normals')}</div>
      <div class="grp btns">${btn('bevel', 'Bevel (Ctrl B)')}${btn('bridge', 'Bridge Edge Loops')}</div>
      ${num('ebev', 'Bevel Width', 0.01)}${num('ebseg', 'Bevel Segments', 1)}
      <div class="grp"><label>Loop Cut (cuts the mesh with a plane)</label>
        <select id="ecax"><option value="0">X</option><option value="1">Y</option><option value="2">Z</option></select></div>
      ${num('ecpos', 'Cut Position', 0.05)}
      <div class="grp btns">${btn('cut', 'Cut at Position')}${btn('cutsel', 'Cut Through Selection')}</div>
      <div class="grp btns">${btn('fill', 'Fill (F)')}${btn('doubles', 'Merge by Distance')}</div>
      <div class="grp btns">${btn('smooth', 'Smooth Points')}${btn('sphere', 'To Sphere')}${btn('shrink', 'Shrink / Fatten')}</div>
      <div class="grp btns">${btn('normals', 'Normals Out')}${btn('normalsin', 'Normals In')}</div>
      <div class="grp btns">${btn('all', 'All')}${btn('none', 'None')}${btn('invert', 'Invert')}</div>
      <div class="grp btns">${btn('linked', 'Linked (L)')}${btn('more', 'More')}${btn('less', 'Less')}</div>
      ${num('eext', 'Extrude Distance', 0.1)}${num('eshr', 'Shrink / Fatten Distance (negative shrinks)', 0.05)}${num('eins', 'Inset Amount (0 to 0.9)', 0.05)}
      <div class="grp"><label><input type="checkbox" id="emir">Mirror X (moves the opposite points too)</label></div>
      <div class="grp"><label><input type="checkbox" id="eprop">Proportional Editing (O): nearby points follow</label></div>
      ${num('eprad', 'Proportional Radius', 0.1)}
      <div class="grp"><span id="estat"></span></div>`;
  }

  bindEdit() {
    const a = this.a, q = id => this.el.querySelector(id);
    this.el.querySelectorAll('[data-eop]').forEach(b => { b.onclick = () => a.act('edit', b.dataset.eop); });
    this.el.querySelectorAll('[data-emode]').forEach(b => { b.onclick = () => a.act('emode', b.dataset.emode); });
    q('#eext').oninput = e => { a.editor.opt.extrude = +e.target.value || 0; };
    q('#eins').oninput = e => { a.editor.opt.inset = Math.min(0.9, Math.max(0, +e.target.value || 0)); };
    q('#eshr').oninput = e => { a.editor.opt.shrink = +e.target.value || 0; };
    q('#ebev').oninput = e => { a.editor.opt.bevel = +e.target.value || 0.1; };
    q('#ebseg').oninput = e => { a.editor.opt.bsegs = Math.max(1, Math.min(8, Math.round(+e.target.value) || 1)); };
    q('#ecax').onchange = e => { a.editor.opt.cutAxis = +e.target.value; };
    q('#ecpos').oninput = e => { a.editor.opt.cutPos = +e.target.value || 0; };
    q('#emir').onchange = e => { a.editor.opt.mirror = e.target.checked; };
    q('#eprop').onchange = e => { a.editor.opt.prop = e.target.checked; };
    q('#eprad').oninput = e => { a.editor.opt.propR = Math.max(0.001, +e.target.value || 1); };
  }

  syncEdit() {
    const ed = this.a.editor, q = id => this.el.querySelector(id);
    if (!q('#eext')) return; // the panel is not built yet
    this.el.querySelectorAll('[data-emode]').forEach(b => b.classList.toggle('on', b.dataset.emode === ed.selMode));
    if (document.activeElement !== q('#eext')) q('#eext').value = ed.opt.extrude;
    if (document.activeElement !== q('#eins')) q('#eins').value = ed.opt.inset;
    if (document.activeElement !== q('#eshr')) q('#eshr').value = ed.opt.shrink;
    if (document.activeElement !== q('#ebev')) q('#ebev').value = ed.opt.bevel;
    if (document.activeElement !== q('#ebseg')) q('#ebseg').value = ed.opt.bsegs;
    if (document.activeElement !== q('#ecpos')) q('#ecpos').value = ed.opt.cutPos;
    q('#ecax').value = ed.opt.cutAxis;
    q('#emir').checked = ed.opt.mirror;
    q('#eprop').checked = ed.opt.prop;
    if (document.activeElement !== q('#eprad')) q('#eprad').value = ed.opt.propR;
    q('#estat').textContent = `Selected: ${ed.verts.size} points, ${ed.edges.size} edges, ${ed.faces.size} faces`;
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
      const text = (id, t) => { const e = this.el.querySelector(id); if (e) e.textContent = t; };
      put('#ttile', m.userData.tiling ?? 1);
      put('#trot', m.userData.rotation ?? 0);
      text('#s-map', m.map ? '(loaded)' : '');
      text('#s-normal', m.normalMap ? '(loaded)' : '');
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
    if (this.a.mode === 'edit') this.syncEdit();
    const opt = this.a.brush.opt;
    put('#br', opt.radius); put('#bs', opt.strength); put('#bt', opt.type); put('#bc', opt.color);
    put('#bsp', opt.spacing); put('#bf', opt.falloff); put('#brad', opt.radial);
    const tick = (id, v) => { const c = this.el.querySelector(id); if (c) c.checked = v; };
    tick('#bsub', opt.subtract); tick('#bpen', opt.pressure);
    if (this.a.mode === 'texpaint') {
      const tp = this.a.texpaint.opt;
      put('#tpc', tp.color); put('#tpr', tp.radius); put('#tps', tp.strength); tick('#tpe', tp.erase);
    }
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
