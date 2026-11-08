import { Engine, restore, snap } from './core/Engine.js';
import { History } from './core/History.js';
import { PRIMS, createPrimitive, uniqueName, disposeObject } from './scene/Primitives.js';
import { LIGHT_NAMES, createLight, cloneLight, lightType } from './scene/Lights.js';
import { Outliner } from './ui/Outliner.js';
import { Properties } from './ui/Properties.js';
import { bindShortcuts } from './ui/Shortcuts.js';
import { Layout } from './ui/Layout.js';

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
    this.props = new Properties(this, $('#props'));
    this.history = new History(() => this.refresh());

    e.onPick = o => this.select(o);
    e.onTransform = () => this.props.sync();
    e.onTransformEnd = (o, a, b) => this.commitTransform(o, a, b);

    // Add menu, laid out as: Mesh, Light, Camera
    const sub = (label, items) => `<div class="sub"><span>${label}<i>&#9656;</i></span><div class="dd">${items}</div></div>`;
    const MESH_ORDER = ['Plane', 'Cube', 'Circle', 'UV Sphere', 'Icosphere', 'Cylinder', 'Cone', 'Torus', 'Grid'];
    $('#adddd').innerHTML =
      sub('Mesh', MESH_ORDER.filter(k => k in PRIMS).map(k => `<a data-act="add" data-arg="${k}">${k === 'Icosphere' ? 'Ico Sphere' : k}</a>`).join('')) +
      sub('Light', Object.entries(LIGHT_NAMES).map(([k, n]) => `<a data-act="addlight" data-arg="${k}">${n}</a>`).join(''));

    // every button with data-act goes through act()
    document.addEventListener('click', ev => {
      const a = ev.target.closest('[data-act]');
      if (a) { this.act(a.dataset.act, a.dataset.arg); this.toggleAdd(false); }
    });

    this.layout = new Layout();
    e.onCamera = () => { this.updateViewText(); };
    $('#snapinc').onchange = ev => e.setSnap(e.snapOn, +ev.target.value);

    bindShortcuts(this);
    this.setTool('move');
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
      addlight: () => this.addLight(arg),
      env: () => e.setEnvironment(arg),
      envbg: () => e.toggleEnvBackground(),
      snap: () => { e.setSnap(!e.snapOn, e.snapInc); },
      orient: () => e.setOrient(e.orient === 'local' ? 'world' : 'local'),
      xray: () => e.setShading(e.shading === 'xray' ? 'solid' : 'xray'),
      fullscreen: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()),
      hide: () => s && this.setVisible(s, false),
      frameall: () => e.frameAll(),
      layout: () => this.layout.toggle(arg),
      tool: () => this.setTool(arg),
      proj: () => e.setProjection(arg),
      shade: () => e.setShading(arg),
      frame: () => s && e.frame(s),
    })[name]?.();
    this.updateUI();
  }

  // Measure tool: click two points

  toggleAdd(open) { $('#addm').classList.toggle('open', open); }

  select(o) {
    this.sel = o;
    this.engine.setSelection(o);
    this.refresh();
  }

  setTool(t) {
    this.tool = t;
    if (t !== 'measure') { this.measure = []; }
    this.engine.setTool(t);
    this.updateUI();
  }

  // show a short message in the status bar
  say(text) { this.msg = text; this.refresh(); this.msg = ''; }

  // add an object to the scene
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

  // the starting light: a point light up and to the side
  defaultLight() {
    const l = createLight('point', 'Light');
    l.position.set(4.08, 1.01, 5.9);
    l.intensity = 150;
    return l;
  }

  addLight(type) {
    const l = createLight(type, uniqueName(this.engine.world, LIGHT_NAMES[type]));
    this.insert(l);
  }

  // a light can't change its type
  setLightType(l, type) {
    if (type === lightType(l)) return;
    const n = cloneLight(l, l.name, type, false), w = this.engine.world;
    this.history.do({
      do: () => { w.remove(l); w.add(n); this.select(n); },
      undo: () => { w.remove(n); w.add(l); this.select(l); },
      dispose: done => disposeObject(done ? l : n),
    });
  }

  duplicate(s) {
    if (s.isLight) return this.insert(cloneLight(s, uniqueName(this.engine.world, s.name.replace(/\.\d+$/, ''))));
    const c = s.clone();
    // clone the geometry and material too
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

  // the object was already moved, we only save the undo step
  commitTransform(o, a, b) {
    this.history.push({ do: () => restore(o, b), undo: () => restore(o, a) });
  }

  // "User Perspective" text in the corner of the viewport
  updateViewText() {
    const e = this.engine;
    $('#vtext').innerHTML = `User ${e.projection === 'ortho' ? 'Orthographic' : 'Perspective'}<br>` +
      `<span>(1) Scene Collection | ${this.sel ? this.sel.name : ''}</span>`;
  }

  // a new scene starts with a camera and a light
  startScene() {
    this.engine.world.add(this.defaultLight());
  }
  updateUI() {
    const e = this.engine;
    const on = { tool: this.tool, proj: e.projection, shade: e.shading, xray: e.shading === 'xray' ? 'x' : '', snap: e.snapOn ? 'x' : '', orient: e.orient === 'local' ? 'x' : '' };
    const undo = $('#undo-btn'), redo = $('#redo-btn');
    if (undo) undo.disabled = !this.history?.u.length;
    if (redo) redo.disabled = !this.history?.r.length;
    document.querySelectorAll('[data-act]').forEach(b => {
      if (b.dataset.act in on) b.classList.toggle('on', b.dataset.arg === on[b.dataset.act]);
    });
    $('#orientbtn').textContent = e.orient === 'local' ? 'Local' : 'Global';
    $('#hint').textContent = 'Orbit: left drag | Right drag: pan | Wheel: zoom';
    this.updateViewText();
  }
  refresh() {
    this.outliner.render();
    this.props.render();
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
