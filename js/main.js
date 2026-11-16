import { Engine, restore, snap } from './core/Engine.js';
import { History } from './core/History.js';
import { PRIMS, createPrimitive, uniqueName, disposeObject } from './scene/Primitives.js';
import { Brush } from './tools/Brush.js';
import { exportScene, save } from './io/Exporter.js';
import { renderViews, encode } from './io/Renderer.js';
import { applyTransform, setOrigin, shade, joinObjects, booleanObjects, addText } from './tools/ObjectTools.js';
import { createCamera, cloneCamera } from './scene/Cameras.js';
import { runSelfTest } from './dev/SelfTest.js';
import { EditMode } from './tools/EditMode.js';
import { unwrap, unwrapAngle, drawUV, uvTransformed, toggleChecker } from './tools/UV.js';
import { TexPaint } from './tools/TexPaint.js';
import { makePresetMaterial } from './scene/Presets.js';
import { NodeEditor } from './ui/NodeEditor.js';
import { MATERIAL_NODES, defaultMaterialGraph, applyMaterialGraph } from './scene/MaterialNodes.js';
import { GEO_NODES, defaultGeoGraph } from './scene/GeoNodes.js';
import { LIGHT_NAMES, createLight, cloneLight, lightType } from './scene/Lights.js';
import { Outliner } from './ui/Outliner.js';
import { Properties } from './ui/Properties.js';
import { bindShortcuts } from './ui/Shortcuts.js';
import { Layout } from './ui/Layout.js';
import { ProjectManager } from './io/ProjectManager.js';
import { importFile, pickFiles } from './io/Importer.js';
import { MODIFIERS, applyStack, baseOf, hasModifiers, copyModifiers, build, evaluate } from './scene/Modifiers.js';
import { makeTexture, applyTiling, readImage } from './scene/Textures.js';
import { Palette } from './ui/Palette.js';
import { NavGizmo } from './ui/NavGizmo.js';

const $ = s => document.querySelector(s);

class App {
  sel = null;
  tool = 'move';
  mode = 'object'; // object, sculpt or paint
  msg = '';
  projectName = 'Untitled';
  camActive = null; // the camera used for "Scene Camera" renders
  gallery = []; // finished renders
  dirty = false; // true when there is work that is not saved

  constructor() {
    const e = this.engine = new Engine($('#viewport'));
    this.outliner = new Outliner(this, $('#outliner'));
    this.props = new Properties(this, $('#props'));
    this.history = new History(() => { this.dirty = true; this.refresh(); });
    this.brush = new Brush(this);
    this.editor = new EditMode(this);
    this.texpaint = new TexPaint(this);

    e.onPick = o => { if (this.tool !== 'measure') this.select(o); };
    e.onTransform = () => this.props.sync();
    e.onTransformEnd = (o, a, b) => this.commitTransform(o, a, b);

    // Add menu, laid out as: Mesh, Light, Camera
    const sub = (label, items) => `<div class="sub"><span>${label}<i>&#9656;</i></span><div class="dd">${items}</div></div>`;
    const MESH_ORDER = ['Plane', 'Cube', 'Circle', 'UV Sphere', 'Icosphere', 'Cylinder', 'Cone', 'Torus', 'Grid'];
    $('#adddd').innerHTML =
      sub('Mesh', MESH_ORDER.filter(k => k in PRIMS).map(k => `<a data-act="add" data-arg="${k}">${k === 'Icosphere' ? 'Ico Sphere' : k}</a>`).join('')) +
      '<a data-act="addtext">Text</a>' +
      sub('Light', Object.entries(LIGHT_NAMES).map(([k, n]) => `<a data-act="addlight" data-arg="${k}">${n}</a>`).join('')) +
      '<a data-act="addcamera">Camera</a>';

    // every button with data-act goes through act()
    document.addEventListener('click', ev => {
      const a = ev.target.closest('[data-act]');
      if (a) { this.act(a.dataset.act, a.dataset.arg); this.toggleAdd(false); }
    });

    this.layout = new Layout();
    this.palette = new Palette(this);
    this.gizmo = new NavGizmo($('#vp'), e, this);
    e.onCamera = () => { this.gizmo.update(); this.updateViewText(); this.updateMeasure(); };
    e.onFrame = r => this.drawFrame(r);
    e.onCamView = () => this.updateUI();
    this.project = new ProjectManager(this);
    this.initRender();
    this.initMeasure();
    this.syncCamAspect();
    $('#snapinc').onchange = ev => e.setSnap(e.snapOn, +ev.target.value);
    this.initContext();
    this.initUV();
    $('#nclose').onclick = () => $('#nodedlg').close();

    // drop files on the page to import them
    addEventListener('dragover', ev => ev.preventDefault());
    addEventListener('drop', ev => { ev.preventDefault(); this.importFiles([...ev.dataTransfer.files]); });
    bindShortcuts(this);
    this.setTool('move');
    this.startScene();
    this.refresh();
    this.project.checkRecovery();
  }

  act(name, arg) {
    const s = this.sel, e = this.engine;
    ({
      undo: () => this.history.undo(),
      redo: () => this.history.redo(),
      duplicate: () => (this.mode === 'edit' ? this.editor.run('duplicate') : s && this.duplicate(s)),
      delete: () => (this.mode === 'edit' ? this.editor.run('delete') : s && this.remove(s)),
      edit: () => this.editor.run(arg),
      emode: () => this.editor.setSelMode(arg),
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
      apply: () => applyTransform(this, s, arg),
      origin: () => setOrigin(this, s, arg),
      shademesh: () => shade(this, s, arg === 'smooth'),
      join: () => joinObjects(this, s),
      boolean: () => booleanObjects(this, s),
      applymenu: () => this.showApplyMenu(),
      addtext: () => addText(this),
      cursor: () => this.moveCursor(arg),
      tocursor: () => this.selectionToCursor(),
      snap: () => { e.setSnap(!e.snapOn, e.snapInc); },
      orient: () => e.setOrient(e.orient === 'local' ? 'world' : 'local'),
      xray: () => e.setShading(e.shading === 'xray' ? 'solid' : 'xray'),
      select: () => (this.mode === 'edit' ? this.editor.run(arg) : arg === 'none' ? this.select(null) : this.say(arg === 'all' || arg === 'invert' ? 'Objects are selected one at a time' : 'This works in Edit Mode')),
      fullscreen: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()),
      selftest: () => runSelfTest(this),
      addmod: () => s?.isMesh && this.addModifier(s, arg),
      project: () => this.project[arg](),
      importfiles: () => pickFiles('.glb,.gltf,.obj,.stl,.ply,.fbx,.forge3d').then(f => this.importFiles(f)),
      hide: () => s && this.setVisible(s, false),
      frameall: () => e.frameAll(),
      palette: () => this.palette.open(),
      layout: () => this.layout.toggle(arg),
      workspace: () => (['uv', 'shading', 'geonodes'].includes(arg)
        ? { uv: () => this.openUV(), shading: () => this.openShading(), geonodes: () => this.openGeoNodesTab() }[arg]()
        : this.setMode(arg)),
      dialog: () => this.openRender(),
      tool: () => this.setTool(arg),
      proj: () => e.setProjection(arg),
      shade: () => e.setShading(arg),
      mode: () => this.setMode(arg),
      frame: () => s && e.frame(s),
      save: () => exportScene(e.world, arg) || this.say('Nothing to export'),
    })[name]?.();
    this.updateUI();
  }

  // Snap > Cursor to World Origin / Cursor to Selected
  moveCursor(where) {
    const c = this.engine.cursorObj;
    if (where === 'selected') { if (!this.sel) return this.say('Select an object first'); c.position.copy(this.sel.position); } else c.position.set(0, 0, 0);
    this.engine.invalidate();
  }

  selectionToCursor() {
    const o = this.sel; if (!o) return this.say('Select an object first');
    const before = snap(o);
    o.position.copy(this.engine.cursorObj.position);
    this.commitTransform(o, before, snap(o));
    this.engine.sync(); this.refresh();
  }

  // Measure tool: click two points

  initMeasure() {
    const dom = this.engine.renderer.domElement;
    this.measure = [];
    let down = null;
    dom.addEventListener('pointerdown', e => { down = e.button === 0 ? [e.clientX, e.clientY] : null; });
    dom.addEventListener('pointerup', e => {
      if (this.tool !== 'measure' || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const pt = this.engine.pickPoint(e);
      if (!pt) return;
      if (this.measure.length >= 2) this.measure = [];
      this.measure.push(pt);
      this.updateMeasure(true);
    });
  }

  updateMeasure(announce = false) {
    const label = $('#measure'), [a, b] = this.measure || [];
    if (this.tool !== 'measure' || !a) { label.style.display = 'none'; this.engine.setMeasure(null, null); return; }
    this.engine.setMeasure(a, b);
    const to = b || a, rect = this.engine.renderer.domElement.getBoundingClientRect();
    const mid = b ? a.clone().add(b).multiplyScalar(0.5) : a.clone();
    const p = mid.project(this.engine.camera);
    Object.assign(label.style, { display: 'block', left: ((p.x + 1) / 2 * rect.width) + 'px', top: ((1 - p.y) / 2 * rect.height) + 'px' });
    label.textContent = b ? `${a.distanceTo(to).toFixed(3)}  (X ${Math.abs(b.x - a.x).toFixed(3)}, Y ${Math.abs(b.y - a.y).toFixed(3)}, Z ${Math.abs(b.z - a.z).toFixed(3)})` : 'Click the second point';
    if (announce && b) this.say(`Distance: ${a.distanceTo(b).toFixed(4)}`);
  }

  // Ctrl A: choose what to apply
  showApplyMenu() {
    if (!this.sel?.isMesh) return this.say('Select a mesh first');
    const it = (l, a) => `<a data-act="apply" data-arg="${a}">${l}</a>`;
    const [x, y] = this.mouse || [innerWidth / 2, innerHeight / 2];
    this.ctxMenu(it('Location', 'location') + it('Rotation', 'rotation') + it('Scale', 'scale') + it('All Transforms', 'all'), x, y);
  }

  toggleAdd(open) { $('#addm').classList.toggle('open', open); }

  select(o) {
    if (this.mode === 'edit' && o !== this.sel) this.setMode('object'); // another object: leave edit mode first
    this.sel = o;
    this.engine.setSelection(o);
    this.refresh();
  }

  setTool(t) {
    this.tool = t;
    if (t !== 'measure') { this.measure = []; }
    this.engine.setTool(t);
    if (this.mode === 'edit') this.editor.movePivot();
    this.updateUI();
  }

  setMode(m) {
    if (m !== 'object' && !this.sel?.isMesh) return this.say('Select a mesh first');
    if (m !== 'object' && hasModifiers(this.sel)) return this.say('Apply or remove the modifiers before sculpting');
    if (this.mode === 'edit') this.editor.exit();
    this.mode = m;
    this.engine.setBrushing(m !== 'object'); // left mouse becomes the brush
    if (m === 'edit') this.editor.enter(this.sel);
    this.brush.refreshMask(m === 'sculpt' ? this.sel : null); // the mask dots show in sculpt mode only
    this.refresh();
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
    m.position.copy(this.engine.cursorObj.position); // new objects appear at the 3D cursor
    this.insert(m);
  }

  // materials, lights and environment

  // replaces the material with a ready made one
  applyPreset(mesh, name) {
    if (this.mode !== 'object') return this.say('Go back to Object Mode first');
    const old = mesh.material, next = makePresetMaterial(old, name);
    const set = m => { mesh.material = m; this.engine.applyShading(); this.props.cur = undefined; };
    this.history.do({ do: () => set(next), undo: () => set(old), dispose: done => (done ? old : next).dispose() });
  }

  loadHDRI() {
    pickFiles('.hdr').then(([file]) => { if (file) this.engine.setEnvironment('hdri', file); });
  }

  // saves the image of a texture slot as a PNG
  async exportTexture(mesh, slot) {
    const tex = mesh.material[slot], canvas = tex?.userData.canvas;
    if (!tex || (!canvas && !tex.userData.src)) return this.say('This texture can not be saved');
    const blob = canvas ? await new Promise(done => canvas.toBlob(done, 'image/png')) : await (await fetch(tex.userData.src)).blob();
    save(blob, `${mesh.name}-${slot}.png`, 'image/png');
  }

  // UV tools

  initUV() {
    const dlg = $('#uvdlg');
    dlg.onclick = e => {
      const b = e.target.closest('[data-uv]'), mesh = this.sel;
      if (!b) return;
      const op = b.dataset.uv;
      if (op === 'close') return dlg.close();
      if (!mesh?.isMesh) return;
      if (op === 'checker') toggleChecker(mesh, this.engine);
      else if (op === 'transform') {
        this.transformUV(mesh, { scale: +$('#uvs').value || 1, rotate: +$('#uvr').value || 0, du: +$('#uvu').value || 0, dv: +$('#uvv').value || 0 });
      } else this.unwrapMesh(mesh, op);
      drawUV($('#uvcanvas'), mesh);
    };
  }

  openUV() {
    if (!this.sel?.isMesh) return this.say('Select a mesh first');
    drawUV($('#uvcanvas'), this.sel);
    $('#uvdlg').showModal();
  }

  unwrapMesh(mesh, method) {
    if (this.mode !== 'object') return this.say('Go back to Object Mode first');
    if (hasModifiers(mesh)) return this.say('Apply or remove the modifiers first');
    const old = mesh.geometry, fresh = method === 'angle' ? unwrapAngle(mesh, +$('#uva').value || 66) : unwrap(mesh, method);
    const set = g => { mesh.geometry = g; this.engine.invalidate(); };
    this.history.do({ do: () => set(fresh), undo: () => set(old), dispose: done => (done ? old : fresh).dispose() });
  }

  transformUV(mesh, p) {
    const attr = mesh.geometry.attributes.uv;
    if (!attr) return this.say('Unwrap the mesh first');
    const before = attr.array.slice(), after = uvTransformed(attr, p);
    const set = arr => { attr.array.set(arr); attr.needsUpdate = true; this.engine.invalidate(); };
    this.history.do({ do: () => set(after), undo: () => set(before) });
  }

  // node editors

  trackGraph(graph, apply) {
    let last = JSON.stringify(graph);
    return () => {
      const now = JSON.stringify(graph), before = last;
      if (now === before) return;
      last = now;
      const set = text => {
        Object.assign(graph, JSON.parse(text)); // same object, new nodes and links
        last = text;
        apply();
        if (this.nodeEditor?.graph === graph) this.nodeEditor.load(graph);
      };
      this.history.push({ do: () => set(now), undo: () => set(before) });
    };
  }

  showNodes(title, defs, graph, onChange) {
    $('#ntitle').textContent = title;
    $('#nodedlg').showModal();
    this.nodeEditor = new NodeEditor($('#nodeed'), defs, onChange);
    this.nodeEditor.load(graph);
  }

  openShading() {
    const mesh = this.sel;
    if (!mesh?.isMesh) return this.say('Select a mesh first');
    mesh.material.userData.nodes ||= defaultMaterialGraph(mesh);
    const graph = mesh.material.userData.nodes;
    const apply = () => {
      try { applyMaterialGraph(mesh, graph); } catch (err) { console.error(err); return this.say(err.message); }
      this.engine.applyShading();
      this.props.cur = undefined; // the material may have been replaced
    };
    const record = this.trackGraph(graph, () => { apply(); this.refresh(); });
    this.showNodes('Shading: Material Nodes', MATERIAL_NODES, graph, () => { apply(); record(); this.dirty = true; this.refresh(); });
  }

  openGeoNodes(mesh, i) {
    const mod = mesh.userData.modifiers[i];
    mod.graph ||= defaultGeoGraph();
    const record = this.trackGraph(mod.graph, () => { evaluate(mesh); this.refresh(); });
    this.showNodes('Geometry Nodes', GEO_NODES, mod.graph, () => { evaluate(mesh); record(); this.dirty = true; this.refresh(); });
  }

  openGeoNodesTab() {
    const mesh = this.sel;
    if (!mesh?.isMesh) return this.say('Select a mesh first');
    if (this.mode !== 'object') return this.say('Go back to Object Mode first');
    if (!mesh.userData.modifiers?.some(m => m.type === 'nodes')) this.addModifier(mesh, 'nodes');
    this.openGeoNodes(mesh, mesh.userData.modifiers.findIndex(m => m.type === 'nodes'));
  }

  // Changing the modifier list is undoable
  setModifiers(mesh, next, nextBase = null) {
    if (this.mode !== 'object') return this.say('Go back to Object Mode first');
    const prev = mesh.userData.modifiers || [], prevBase = hasModifiers(mesh) ? baseOf(mesh) : null;
    const set = (stack, base) => { applyStack(mesh, stack, base); this.props.cur = undefined; };
    this.history.do({ do: () => set(next, nextBase), undo: () => set(prev, prevBase) });
  }

  addModifier(mesh, type) {
    this.setModifiers(mesh, [...(mesh.userData.modifiers || []), { type, enabled: true, ...MODIFIERS[type].defaults }]);
  }

  removeModifier(mesh, i) {
    this.setModifiers(mesh, mesh.userData.modifiers.filter((_, k) => k !== i));
  }

  moveModifier(mesh, i, dir) {
    const list = [...mesh.userData.modifiers], j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.setModifiers(mesh, list);
  }

  toggleModifier(mesh, i) {
    if (this.mode !== 'object') return this.say('Go back to Object Mode first');
    const mod = mesh.userData.modifiers[i], next = !mod.enabled;
    const set = on => { mod.enabled = on; evaluate(mesh); this.props.cur = undefined; };
    this.history.do({ do: () => set(next), undo: () => set(!next) });
  }

  // bakes this modifier and the ones above it into the mesh
  applyModifier(mesh, i) {
    const list = mesh.userData.modifiers;
    try {
      this.setModifiers(mesh, list.slice(i + 1), build(baseOf(mesh), list.slice(0, i + 1)));
    } catch (err) {
      console.error(err);
      this.say(`Could not apply: ${err.message}`);
    }
  }

  // load or remove an image for the base color or normal map
  async loadTexture(mesh, slot, remove = false) {
    const m = mesh.material, old = m[slot];
    let tex = null;
    if (!remove) {
      const [file] = await pickFiles('image/*');
      if (!file) return;
      tex = makeTexture(await readImage(file), slot === 'map');
    }
    const set = t => { m[slot] = t; applyTiling(m); m.needsUpdate = true; this.engine.invalidate(); };
    this.history.do({ do: () => set(tex), undo: () => set(old) });
  }

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
        if (f.name.toLowerCase().endsWith('.forge3d')) { if (this.project.ok()) await this.project.openFile(f); }
        else this.insertMany(await importFile(f));
      } catch (err) {
        console.error(err);
        this.say(`Could not import ${f.name}: ${err.message}`);
      }
    }
  }

  // empties the scene and frees the memory
  clearScene() {
    this.engine.exitCameraView(false);
    this.select(null);
    const w = this.engine.world;
    [...w.children].forEach(o => { w.remove(o); disposeObject(o); });
    this.history.clear();
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

  // a new scene starts with a camera and a light
  startScene() {
    this.engine.exitCameraView(false);
    const cam = createCamera('Camera');
    cam.position.set(7.36, -6.93, 4.96);
    cam.lookAt(0, 0, 0);
    this.engine.world.add(cam, this.defaultLight());
    this.camActive = cam;
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
    if (this.engine.cursorObj.position.lengthSq() > 0) l.position.copy(this.engine.cursorObj.position);
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

  // right click menu in the viewport
  initContext() {
    const menu = $('#ctx'), dom = this.engine.renderer.domElement;
    const item = (label, act, arg = '') => `<a data-act="${act}" data-arg="${arg}">${label}</a>`;
    let from = null, moved = false;
    const hide = () => menu.classList.remove('open');

    dom.addEventListener('pointermove', e => { this.mouse = [e.clientX, e.clientY]; });
    this.ctxMenu = (html, x, y) => { menu.innerHTML = html; menu.style.left = x + 'px'; menu.style.top = y + 'px'; menu.classList.add('open'); };
    dom.addEventListener('pointerdown', e => {
      hide();
      if (e.button === 2) { from = [e.clientX, e.clientY]; moved = false; }
    });
    dom.addEventListener('pointermove', e => {
      if (from && e.buttons & 2 && Math.hypot(e.clientX - from[0], e.clientY - from[1]) > 4) { moved = true; hide(); }
    });
    dom.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (moved) return; // it was a pan, not a click
      if (e.shiftKey) { const pt = this.engine.pickPoint(e); if (pt) { this.engine.cursorObj.position.copy(pt); this.engine.invalidate(); this.say('3D cursor moved. New objects appear here (Shift C: back to the middle)'); } return; }
      menu.innerHTML = this.sel
        ? item('Duplicate', 'duplicate') + item('Hide', 'hide') + item('Frame Selected', 'frame') +
          (this.sel.isMesh && this.mode === 'object' ? item('Shade Smooth', 'shademesh', 'smooth') + item('Shade Flat', 'shademesh', 'flat') + item('Apply All Transforms', 'apply', 'all') + item('Set Origin to Geometry', 'origin', 'geometry') : '') +
          item('Delete', 'delete')
        : item('Add Cube', 'add', 'Cube') + item('Add UV Sphere', 'add', 'UV Sphere') + item('Add Plane', 'add', 'Plane') +
          item('Add Point Light', 'addlight', 'point') + item('Search Commands...', 'palette');
      menu.style.left = e.clientX + 'px';
      menu.style.top = e.clientY + 'px';
      menu.classList.add('open');
    });
    menu.addEventListener('click', hide);
    addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
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
    copyModifiers(s, c);
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

  // highlight the buttons that are active
  updateUI() {
    const e = this.engine;
    const on = {
      tool: this.tool, proj: e.projection, shade: e.shading, mode: this.mode, workspace: this.mode,
      xray: e.shading === 'xray' ? 'x' : '', camlock: e.camLock ? 'x' : '',
      snap: e.snapOn ? 'x' : '', orient: e.orient === 'local' ? 'x' : '',
    };
    const undo = $('#undo-btn'), redo = $('#redo-btn');
    if (undo) undo.disabled = !this.history?.u.length;
    if (redo) redo.disabled = !this.history?.r.length;
    document.querySelectorAll('[data-act]').forEach(b => {
      if (b.dataset.act in on) b.classList.toggle('on', b.dataset.arg === on[b.dataset.act]);
    });
    const names = { object: 'Object Mode', edit: 'Edit Mode', sculpt: 'Sculpt Mode', paint: 'Vertex Paint', texpaint: 'Texture Paint' };
    $('#modelabel').textContent = names[this.mode] || 'Object Mode';
    document.querySelectorAll('.editonly').forEach(m => { m.hidden = this.mode !== 'edit'; });
    document.querySelectorAll('.objonly').forEach(m => { m.hidden = this.mode === 'edit'; });
    $('#orientbtn').textContent = e.orient === 'local' ? 'Local' : 'Global';
    $('#cambar').hidden = !e.camView;
    $('#hint').textContent = e.camView
      ? (e.camLock
        ? 'Camera view | Wheel: move the camera closer or further | Left drag: orbit the camera | Right drag: pan | Numpad 0: back'
        : 'Camera view | Wheel: zoom the view only | Dragging leaves the camera view | Numpad 0: back')
      : 'Orbit: left drag (Object mode) or right drag (Edit / Sculpt / Paint) | Shift + drag: pan | Alt or Space + left drag: orbit | Wheel: zoom';
    this.updateViewText();
    this.updateMeasure();
  }

  refresh() {
    $('#proj').textContent = this.projectName + (this.dirty ? ' *' : '');
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
