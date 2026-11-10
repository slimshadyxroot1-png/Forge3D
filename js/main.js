import { Engine, restore, snap } from './core/Engine.js';
import { History } from './core/History.js';
import { PRIMS, createPrimitive, uniqueName, disposeObject } from './scene/Primitives.js';
import { exportScene, save } from './io/Exporter.js';
import { renderViews, encode } from './io/Renderer.js';
import { createCamera, cloneCamera } from './scene/Cameras.js';
import { LIGHT_NAMES, createLight, cloneLight, lightType } from './scene/Lights.js';
import { Outliner } from './ui/Outliner.js';
import { Properties } from './ui/Properties.js';
import { bindShortcuts } from './ui/Shortcuts.js';
import { Layout } from './ui/Layout.js';
import { importFile, pickFiles } from './io/Importer.js';

const $ = s => document.querySelector(s);

class App {
  sel = null;
  tool = 'move';
  mode = 'object'; // object, sculpt or paint
  msg = '';
  projectName = 'Untitled';
  camActive = null; // the camera used for "Scene Camera" renders
  gallery = []; // finished renders

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
      sub('Light', Object.entries(LIGHT_NAMES).map(([k, n]) => `<a data-act="addlight" data-arg="${k}">${n}</a>`).join('')) +
      '<a data-act="addcamera">Camera</a>';

    // every button with data-act goes through act()
    document.addEventListener('click', ev => {
      const a = ev.target.closest('[data-act]');
      if (a) { this.act(a.dataset.act, a.dataset.arg); this.toggleAdd(false); }
    });

    this.layout = new Layout();
    e.onCamera = () => { this.updateViewText(); };
    e.onFrame = r => this.drawFrame(r);
    e.onCamView = () => this.updateUI();
    this.initRender();
    this.syncCamAspect();
    $('#snapinc').onchange = ev => e.setSnap(e.snapOn, +ev.target.value);

    // drop files on the page to import them
    addEventListener('dragover', ev => ev.preventDefault());
    addEventListener('drop', ev => { ev.preventDefault(); this.importFiles([...ev.dataTransfer.files]); });
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
      addcamera: () => this.addCamera(),
      env: () => (arg === 'hdri' ? this.loadHDRI() : e.setEnvironment(arg)),
      envbg: () => e.toggleEnvBackground(),
      viewcam: () => this.viewCamera(),
      render: () => this.renderButton(),
      renderdlg: () => this.openRender(),
      setcamera: () => (s?.isCamera ? this.setActiveCamera(s) : this.say('Select a camera first')),
      aligncam: () => { const c = this.activeCamera(); if (c) this.alignCamera(c); else this.say('Add a camera first (Add > Camera)'); },
      camlock: () => { e.camLock = !e.camLock; e.invalidate(); },
      camzoom: () => (arg === 'fit' ? e.fitCameraView() : e.zoomCameraView(arg === 'in' ? 1.25 : 1 / 1.25)),
      camexit: () => e.exitCameraView(true),
      snap: () => { e.setSnap(!e.snapOn, e.snapInc); },
      orient: () => e.setOrient(e.orient === 'local' ? 'world' : 'local'),
      xray: () => e.setShading(e.shading === 'xray' ? 'solid' : 'xray'),
      fullscreen: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()),
      importfiles: () => pickFiles('.glb,.gltf,.obj,.stl,.ply,.fbx,.forge3d').then(f => this.importFiles(f)),
      hide: () => s && this.setVisible(s, false),
      frameall: () => e.frameAll(),
      layout: () => this.layout.toggle(arg),
      dialog: () => this.openRender(),
      tool: () => this.setTool(arg),
      proj: () => e.setProjection(arg),
      shade: () => e.setShading(arg),
      frame: () => s && e.frame(s),
      save: () => exportScene(e.world, arg) || this.say('Nothing to export'),
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

  // materials, lights and environment

  loadHDRI() {
    pickFiles('.hdr').then(([file]) => { if (file) this.engine.setEnvironment('hdri', file); });
  }

  // node editors

  // add several objects as one undo step
  insertMany(objs) {
    if (!objs.length) return this.say('Nothing to import');
    const w = this.engine.world, used = new Set(w.children.map(o => o.name));
    objs.forEach(o => {
      let name = o.name, i = 0;
      while (used.has(name)) name = `${o.name}.${String(++i).padStart(3, '0')}`;
      o.name = name;
      used.add(name);
    });
    this.history.do({
      do: () => { objs.forEach(o => w.add(o)); this.engine.applyShading(); this.select(objs[objs.length - 1]); },
      undo: () => { objs.forEach(o => w.remove(o)); if (objs.includes(this.sel)) this.select(null); },
      dispose: done => { if (!done) objs.forEach(disposeObject); },
    });
  }

  async importFiles(files) {
    for (const f of files) {
      try {
        this.insertMany(await importFile(f));
      } catch (err) {
        console.error(err);
        this.say(`Could not import ${f.name}: ${err.message}`);
      }
    }
  }

  renderSettings() {
    return {
      width: +$('#rw').value, height: +$('#rh').value, format: $('#rfmt').value, quality: +$('#rq').value,
      samples: +$('#rsamp').value, transparent: $('#rtrans').checked, background: $('#rbg').value,
      helpers: $('#rhelp').checked, views: ['camera'], // always the camera
      worldColor: $('#rwc').value, worldStrength: +$('#rws').value,
    };
  }

  setRenderSettings(s = {}) {
    if (s.width) $('#rw').value = s.width;
    if (s.height) $('#rh').value = s.height;
    if (s.format) $('#rfmt').value = s.format;
    if (s.quality) $('#rq').value = s.quality;
    if (s.samples !== undefined) $('#rsamp').value = s.samples;
    if (s.background) $('#rbg').value = s.background;
    $('#rtrans').checked = !!s.transparent;
    $('#rhelp').checked = !!s.helpers;
    if (s.worldColor) $('#rwc').value = s.worldColor;
    if (s.worldStrength !== undefined) $('#rws').value = s.worldStrength;
    this.syncWorld();
    $('#rbg').disabled = $('#rtrans').checked;
    this.syncCamAspect();
  }

  // the starting light: a point light up and to the side
  defaultLight() {
    const l = createLight('point', 'Light');
    l.position.set(4.08, 1.01, 5.9);
    l.intensity = 150;
    return l;
  }

  // a message in the middle of the viewport
  warn(text) {
    const toast = $('#toast');
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.remove('show'), 4000);
  }

  addCamera() {
    const cam = createCamera(uniqueName(this.engine.world, 'Camera'));
    if (!this.activeCamera()) this.camActive = cam;
    this.insert(cam);
  }

  // the chosen camera, or the first one in the scene
  activeCamera() {
    const w = this.engine.world;
    return w.children.includes(this.camActive) ? this.camActive : w.children.find(o => o.isCamera) || null;
  }

  // Numpad 0: look through the camera, press again to go back
  viewCamera() {
    const e = this.engine;
    if (e.camView) return e.exitCameraView(true);
    this.enterCameraView();
  }

  enterCameraView() {
    const e = this.engine;
    let cam = this.activeCamera();
    if (!cam) { // A render needs a camera
      cam = createCamera(uniqueName(e.world, 'Camera'));
      cam.position.copy(e.camera.position);
      cam.quaternion.copy(e.camera.quaternion);
      this.camActive = cam;
      this.insert(cam);
    }
    e.enterCameraView(cam);
  }

  setActiveCamera(cam) {
    this.camActive = cam;
    if (this.engine.camView) this.engine.enterCameraView(cam);
    this.refresh();
  }

  // The Render button
  renderButton() {
    if (this.engine.camView) return this.openRender();
    this.enterCameraView();
    this.warn('Camera view: scroll to zoom, drag to move the camera. Press Render Image (F12) when it looks right.');
  }

  openRender() {
    $('#rmsg').textContent = '';
    if (!this.activeCamera()) this.enterCameraView(); // rendering goes through a camera
    $('#renderdlg').showModal();
  }

  // World lighting
  syncWorld() {
    this.engine.setWorld($('#rwc').value, +$('#rws').value);
  }

  drawFrame(r) {
    const f = $('#camframe');
    if (!r) { f.style.display = 'none'; return; }
    Object.assign(f.style, { display: 'block', left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  }

  syncCamAspect() {
    const w = +$('#rw').value, h = +$('#rh').value;
    if (w > 0 && h > 0) { this.engine.camAspect = w / h; this.engine.invalidate(); }
  }

  // "User Perspective" text in the corner of the viewport
  updateViewText() {
    const e = this.engine;
    $('#vtext').innerHTML = `${e.camView ? 'Camera' : 'User'} ${e.projection === 'ortho' ? 'Orthographic' : 'Perspective'}<br>` +
      `<span>(1) Scene Collection | ${this.sel ? this.sel.name : (e.camView ? e.camView.name : '')}</span>`;
  }

  // put a camera where the viewport is
  alignCamera(cam) {
    const before = snap(cam), e = this.engine;
    cam.position.copy(e.camera.position);
    cam.quaternion.copy(e.camera.quaternion);
    this.commitTransform(cam, before, snap(cam));
  }

  drawGallery() {
    $('#gallery').innerHTML = this.gallery.map((s, i) =>
      `<div class="shot"><img src="${s.url}" alt="${s.name}"><span>${s.name}</span><button data-dl="${i}">Download</button></div>`).join('') +
      (this.gallery.length > 1 ? '<div class="shot"><button data-dl="all">Download All</button></div>' : '');
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

  // the render window
  initRender() {
    const q = id => $(id), go = q('#rgo'), msg = q('#rmsg');
    q('#rwc').oninput = q('#rws').oninput = () => this.syncWorld();
    q('#rtrans').onchange = () => { q('#rbg').disabled = q('#rtrans').checked; };
    q('#rw').oninput = q('#rh').oninput = () => this.syncCamAspect();
    q('#rcancel').onclick = () => q('#renderdlg').close();
    q('#rclear').onclick = () => {
      this.gallery.forEach(s => URL.revokeObjectURL(s.url));
      this.gallery = [];
      this.drawGallery();
    };
    q('#gallery').onclick = e => {
      const b = e.target.closest('[data-dl]');
      if (!b) return;
      const download = s => save(s.blob, s.file, s.blob.type);
      if (b.dataset.dl === 'all') this.gallery.forEach((s, i) => setTimeout(() => download(s), i * 250));
      else download(this.gallery[+b.dataset.dl]);
    };

    go.onclick = async () => {
      const s = this.renderSettings();
      go.disabled = true;
      msg.textContent = 'Rendering...';
      try {
        const shots = await renderViews(this.engine, s.views, s, this.activeCamera());
        const made = shots.length;
        const ext = s.format === 'jpeg' ? 'jpg' : s.format;
        for (const shot of shots) {
          const blob = await encode(shot.canvas, s);
          this.gallery.push({ name: shot.name, file: `${this.projectName}-${shot.id}.${ext}`, blob, url: URL.createObjectURL(blob) });
        }
        this.drawGallery();
        const dark = !this.engine.world.children.some(o => o.isLight && o.visible) && this.engine.environment === 'none';
        msg.textContent = !made ? 'Add a camera first (Add > Camera)'
          : dark ? 'Rendered, but the scene has no lights. Add one from Add > Light' : 'Rendered';
      } catch (err) {
        console.error(err);
        msg.textContent = 'Render failed (see console)';
      }
      go.disabled = false;
    };
  }

  duplicate(s) {
    if (s.isLight) return this.insert(cloneLight(s, uniqueName(this.engine.world, s.name.replace(/\.\d+$/, ''))));
    if (s.isCamera) return this.insert(cloneCamera(s, uniqueName(this.engine.world, 'Camera')));
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

  // a new scene starts with a camera and a light
  startScene() {
    this.engine.exitCameraView(false);
    const cam = createCamera('Camera');
    cam.position.set(7.36, -6.93, 4.96);
    cam.lookAt(0, 0, 0);
    this.engine.world.add(cam, this.defaultLight());
    this.camActive = cam;
  }
  updateUI() {
    const e = this.engine;
    const on = { tool: this.tool, proj: e.projection, shade: e.shading, xray: e.shading === 'xray' ? 'x' : '', camlock: e.camLock ? 'x' : '', snap: e.snapOn ? 'x' : '', orient: e.orient === 'local' ? 'x' : '' };
    const undo = $('#undo-btn'), redo = $('#redo-btn');
    if (undo) undo.disabled = !this.history?.u.length;
    if (redo) redo.disabled = !this.history?.r.length;
    document.querySelectorAll('[data-act]').forEach(b => {
      if (b.dataset.act in on) b.classList.toggle('on', b.dataset.arg === on[b.dataset.act]);
    });
    $('#orientbtn').textContent = e.orient === 'local' ? 'Local' : 'Global';
    $('#cambar').hidden = !e.camView;
    $('#hint').textContent = e.camView
      ? (e.camLock
        ? 'Camera view | Wheel: move the camera closer or further | Left drag: orbit the camera | Right drag: pan | Numpad 0: back'
        : 'Camera view | Wheel: zoom the view only | Dragging leaves the camera view | Numpad 0: back')
      : 'Orbit: left drag | Shift + drag: pan | Wheel: zoom';
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
