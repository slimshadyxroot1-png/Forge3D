import { Engine } from './core/Engine.js';
import { History } from './core/History.js';
import { PRIMS, createPrimitive, uniqueName, disposeObject } from './scene/Primitives.js';
import { Outliner } from './ui/Outliner.js';
import { bindShortcuts } from './ui/Shortcuts.js';

const $ = s => document.querySelector(s);

class App {
  sel = null;
  tool = 'move';
  mode = 'object'; // object, sculpt or paint
  msg = '';
  projectName = 'Untitled';

  constructor() {
    const e = this.engine = new Engine($('#viewport'));
    this.outliner = new Outliner(this, $('#outliner'));
    this.history = new History(() => this.refresh());

    e.onPick = o => this.select(o);

    // Add menu, laid out as: Mesh, Light, Camera
    const sub = (label, items) => `<div class="sub"><span>${label}<i>&#9656;</i></span><div class="dd">${items}</div></div>`;
    const MESH_ORDER = ['Plane', 'Cube', 'Circle', 'UV Sphere', 'Icosphere', 'Cylinder', 'Cone', 'Torus', 'Grid'];
    $('#adddd').innerHTML =
      sub('Mesh', MESH_ORDER.filter(k => k in PRIMS).map(k => `<a data-act="add" data-arg="${k}">${k === 'Icosphere' ? 'Ico Sphere' : k}</a>`).join(''));

    // every button with data-act goes through act()
    document.addEventListener('click', ev => {
      const a = ev.target.closest('[data-act]');
      if (a) { this.act(a.dataset.act, a.dataset.arg); this.toggleAdd(false); }
    });


    bindShortcuts(this);
    this.startScene();
    this.refresh();
  }

  act(name, arg) {
    const s = this.sel, e = this.engine;
    ({
      undo: () => this.history.undo(),
      redo: () => this.history.redo(),
      duplicate: () => s && this.duplicate(s),
      delete: () => s && this.remove(s),
      add: () => this.add(arg),
      xray: () => e.setShading(e.shading === 'xray' ? 'solid' : 'xray'),
      hide: () => s && this.setVisible(s, false),
      shade: () => e.setShading(arg),
    })[name]?.();
    this.updateUI();
  }

  // Measure tool

  toggleAdd(open) { $('#addm').classList.toggle('open', open); }

  select(o) {
    this.sel = o;
    this.engine.setSelection(o);
    this.refresh();
  }

  // show a short message in the status bar
  say(text) { this.msg = text; this.refresh(); this.msg = ''; }

  // add an object to the scene (can be undone)
  insert(o) {
    const w = this.engine.world;
    this.history.do({
      do: () => { w.add(o); this.engine.applyShading(); this.select(o); },
      undo: () => { w.remove(o); if (this.sel === o) this.select(null); },
      dispose: done => { if (!done) disposeObject(o); },
    });
  }

  add(type) {
    const m = createPrimitive(type, uniqueName(this.engine.world, type));
    this.insert(m);
  }

  // node editors

  duplicate(s) {
    const c = s.clone();
    // clone the geometry and material too, otherwise both objects share them
    c.traverse(m => {
      if (m.isMesh) { m.geometry = m.geometry.clone(); m.material = m.material.clone(); }
    });
    c.name = uniqueName(this.engine.world, s.name.replace(/\.\d+$/, ''));
    this.insert(c);
  }

  remove(o) {
    const w = this.engine.world;
    this.history.do({
      do: () => { w.remove(o); if (this.sel === o) this.select(null); },
      undo: () => { w.add(o); this.select(o); },
      dispose: done => { if (done) disposeObject(o); },
    });
  }

  rename(o, name) {
    if (name === o.name) return;
    const old = o.name;
    this.history.do({ do: () => { o.name = name; }, undo: () => { o.name = old; } });
  }

  setVisible(o, v) {
    const set = x => { o.visible = x; this.engine.sync(); };
    this.history.do({ do: () => set(v), undo: () => set(!v) });
  }

  // a new scene starts with a camera and a light
  startScene() {
  }
  updateUI() {
    const e = this.engine;
    const on = { shade: e.shading, xray: e.shading === 'xray' ? 'x' : '' };
    const undo = $('#undo-btn'), redo = $('#redo-btn');
    if (undo) undo.disabled = !this.history?.u.length;
    if (redo) redo.disabled = !this.history?.r.length;
    document.querySelectorAll('[data-act]').forEach(b => {
      if (b.dataset.act in on) b.classList.toggle('on', b.dataset.arg === on[b.dataset.act]);
    });
    $('#hint').textContent = 'Orbit: left drag | Right drag: pan | Wheel: zoom';
  }
  refresh() {
    this.outliner.render();
    this.updateUI();

    // count points and triangles for the status bar
    let verts = 0, tris = 0;
    const w = this.engine.world;
    w.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry, n = g.attributes.position.count;
      verts += n;
      tris += (g.index ? g.index.count : n) / 3;
    });
    $('#stat').textContent = this.msg ||
      `Objects ${w.children.length}   |   Vertices ${verts}   |   Triangles ${tris}   |   ${this.sel ? this.sel.name : 'No selection'}`;
    this.engine.invalidate();
  }

}

window.app = new App();
