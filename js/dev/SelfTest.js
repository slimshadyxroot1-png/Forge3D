import { serialize, deserialize } from '../io/Project.js';
import { renderViews } from '../io/Renderer.js';
import { PRIMS } from '../scene/Primitives.js';
import { BRUSHES } from '../tools/Brush.js';
import { MODIFIERS, evaluate } from '../scene/Modifiers.js';
import { defaultMaterialGraph, applyMaterialGraph } from '../scene/MaterialNodes.js';
import { defaultGeoGraph } from '../scene/GeoNodes.js';

// quick checks that run inside the real app
export async function runSelfTest(app) {
  const results = [], world = app.engine.world;
  const need = (cond, msg) => { if (!cond) throw new Error(msg); };
  const test = async (name, fn) => {
    try { await fn(); results.push({ test: name, ok: true }); }
    catch (err) { results.push({ test: name, ok: false, error: err.message }); }
  };

  // keep the user's work safe, it is put back at the end
  const backup = serialize(app), wasDirty = app.dirty, name = app.projectName;
  app.clearScene();

  await test('add, undo and redo every shape', () => {
    for (const k of Object.keys(PRIMS)) {
      app.add(k);
      need(world.children.length === 1, `${k} was not added`);
      app.history.undo();
      need(world.children.length === 0, `${k} undo failed`);
      app.history.redo();
      need(world.children.length === 1, `${k} redo failed`);
      app.history.undo();
    }
  });

  await test('every modifier makes a valid mesh and undo removes it', () => {
    app.add('Cube');
    const cube = app.sel;
    for (const k of Object.keys(MODIFIERS)) {
      app.addModifier(cube, k);
      const pos = cube.geometry.attributes.position.array;
      need(pos.length > 0 && pos.every(Number.isFinite), `${k} made bad points`);
      app.history.undo();
    }
    need(!cube.userData.modifiers?.length, 'undo left modifiers behind');
  });

  await test('sculpt prepare welds the mesh', () => {
    app.clearScene();
    app.add('UV Sphere');
    app.brush.prepare(app.sel);
    need(app.sel.geometry.userData.ready && app.sel.geometry.index, 'mesh was not prepared');
  });

  await test('save and load keep objects, lights, cameras and modifiers', () => {
    app.clearScene();
    app.add('Torus');
    const torus = app.sel;
    app.addModifier(torus, 'mirror');
    app.addLight('spot');
    app.addCamera();
    const count = world.children.length, names = world.children.map(o => o.name).join();
    deserialize(app, serialize(app));
    need(world.children.length === count, 'object count changed');
    need(world.children.map(o => o.name).join() === names, 'names changed');
    need(world.children.find(o => o.isMesh).userData.modifiers.length === 1, 'modifier was lost');
    need(app.activeCamera(), 'active camera was lost');
  });

  await test('every sculpt brush keeps the points valid', () => {
    app.clearScene();
    app.add('UV Sphere');
    const m = app.sel, b = app.brush;
    b.prepare(m);
    Object.assign(b, { mesh: m, before: m.geometry.attributes.position.array.slice(), pull: m.position.clone().setX(0.1) });
    for (const type of Object.keys(BRUSHES)) {
      if (type === 'grab' || type === 'elastic') continue; // these two follow the mouse
      b.opt.type = type;
      b.key = type === 'mask' ? 'mask' : 'position';
      b.dab(m.position.clone().setZ(1), 1);
      need(m.geometry.attributes.position.array.every(Number.isFinite), `${type} made bad points`);
    }
    b.mesh = null;
    b.opt.type = 'draw';
  });

  await test('box select skips hidden points, X-Ray selects them', () => {
    app.clearScene();
    app.add('Cube');
    app.setMode('edit');
    const ed = app.editor, box = app.engine.renderer.domElement.getBoundingClientRect();
    const count = () => { ed.boxSelect(box.left, box.top, box.right, box.bottom, false); return ed.verts.size; };
    ed.setSelMode('vertex');
    app.engine.setShading('solid');
    const visible = count();
    app.engine.setShading('xray');
    const all = count();
    app.engine.setShading('solid');
    app.setMode('object');
    need(visible > 0 && all > visible, `solid selected ${visible}, X-Ray selected ${all}`);
  });

  await test('edit mode extrude, delete and undo', () => {
    app.clearScene();
    app.add('Cube');
    app.setMode('edit');
    const ed = app.editor, tris = ed.d.idx.length;
    ed.setSelMode('face');
    ed.faces = new Set([0, 1]);
    ed.syncSel();
    ed.run('extrude');
    need(ed.d.idx.length > tris, 'extrude did nothing');
    app.history.undo();
    need(ed.d.idx.length === tris, 'undo did not restore the mesh');
    ed.faces = new Set([0]);
    ed.syncSel();
    ed.run('delete');
    need(ed.d.idx.length === tris - 3, 'delete removed the wrong amount');
    app.setMode('object');
  });

  await test('uv unwrap, material nodes and geometry nodes', () => {
    app.clearScene();
    app.add('Cube');
    const mesh = app.sel;
    app.unwrapMesh(mesh, 'smart');
    need(mesh.geometry.attributes.uv, 'no UVs were made');
    app.unwrapMesh(mesh, 'angle');
    need(mesh.geometry.attributes.uv.array.every(v => v >= -0.01 && v <= 1.01), 'angle UVs are outside 0 to 1');
    app.applyPreset(mesh, 'Glass');
    need(mesh.material.isMeshPhysicalMaterial, 'the glass preset is not a physical material');
    applyMaterialGraph(mesh, defaultMaterialGraph(mesh));
    app.addModifier(mesh, 'nodes');
    mesh.userData.modifiers[0].graph = defaultGeoGraph();
    evaluate(mesh);
    need(mesh.geometry.attributes.position.count > 0, 'geometry nodes made nothing');
  });

  await test('apply transform, origin and shading', () => {
    app.clearScene();
    app.add('Cube');
    const m = app.sel;
    m.scale.set(2, 1, 1); m.position.set(3, 0, 0);
    m.geometry.computeBoundingBox();
    const w0 = m.geometry.boundingBox.getSize(new m.position.constructor()).x * 2;
    app.act('apply', 'all');
    need(m.scale.x === 1 && m.position.x === 0, 'Apply did not reset the transform');
    m.geometry.computeBoundingBox();
    need(Math.abs(m.geometry.boundingBox.getSize(new m.position.constructor()).x - w0) < 1e-3, 'Apply changed the size of the mesh');
    app.history.undo();
    need(m.scale.x === 2, 'undo of Apply failed');
    app.act('origin', 'geometry');
    app.act('shademesh', 'smooth');
    need(m.geometry.attributes.normal, 'Shade Smooth lost the normals');
    app.act('shademesh', 'flat');
    need(!m.geometry.index, 'Shade Flat should split the points');
  });

  await test('new modeling modifiers', () => {
    app.clearScene();
    app.add('UV Sphere');
    const m = app.sel;
    for (const k of ['bevel', 'deform', 'cast', 'decimate', 'wireframe']) {
      app.addModifier(m, k);
      const pos = m.geometry.attributes.position.array;
      need(pos.length > 0 && pos.every(Number.isFinite), `${k} made bad points`);
    }
  });

  await test('edit mode tools: linked, more, fill, normals', () => {
    app.clearScene();
    app.add('Cube');
    app.act('mode', 'edit');
    const ed = app.editor;
    app.act('emode', 'face');
    ed.faces = new Set([0]); ed.syncSel();
    app.act('edit', 'linked');
    need(ed.faces.size === ed.d.idx.length / 3, 'Select Linked should select the whole cube');
    app.act('edit', 'none');
    ed.verts = new Set([0]); ed.selMode = 'vertex'; ed.syncSel();
    app.act('edit', 'more');
    need(ed.verts.size > 1, 'Select More did nothing');
    app.act('edit', 'normals');
    app.act('edit', 'sphere');
    app.act('edit', 'smooth');
    app.act('mode', 'object');
  });

  await test('loop cut, bevel, 3D cursor', () => {
    app.clearScene();
    app.act('cursor', 'origin');
    app.add('Cube');
    app.act('mode', 'edit');
    const ed = app.editor, before = ed.d.idx.length;
    ed.opt.cutAxis = 2; ed.opt.cutPos = 0.31;
    app.act('edit', 'cut');
    need(ed.d.idx.length > before, 'Loop Cut did not add any faces');
    need(ed.edges.size > 0, 'Loop Cut should select the new edge loop');
    app.act('mode', 'object');
    app.engine.cursorObj.position.set(2, 0, 0);
    app.add('Cube');
    need(app.sel.position.x === 2, 'new objects should appear at the 3D cursor');
    app.act('cursor', 'origin');
  });

  await test('Render button goes to camera view, zoom works, Numpad 0 goes back', () => {
    app.clearScene();
    app.startScene();
    app.add('Cube');
    const e = app.engine;
    need(world.children.some(o => o.isLight), 'a new scene has no light');
    app.act('render');
    need(e.camView && e.camView === app.activeCamera(), 'the Render button did not enter camera view');
    e.camLock = true;
    const at = e.camView.position.clone();
    app.act('camzoom', 'in');
    need(!e.camView.position.equals(at), 'zoom with Lock Camera to View did not move the camera');
    e.camLock = false;
    const z = e.camZoom;
    app.act('camzoom', 'in');
    need(e.camZoom > z, 'view zoom did nothing');
    app.act('viewcam');
    need(!e.camView, 'Numpad 0 did not leave the camera view');
  });

  await test('shading modes and the final render look', () => {
    const e = app.engine;
    for (const m of ['wire', 'solid', 'xray', 'material', 'rendered']) { e.setShading(m); need(e.shading === m, `${m} was not set`); }
    need(!e.fill.visible, 'Rendered shading should not use the viewport fill light');
    const back = e.finalLook();
    need(e.shading === 'rendered', 'final look is not Rendered');
    back();
    need(e.shading === 'rendered', 'shading was not restored');
    e.setShading('solid');
    need(e.fill.visible, 'Solid shading needs the fill light');
  });

  await test('render two views', async () => {
    app.clearScene();
    app.add('Cube');
    const opt = { width: 64, height: 64, transparent: true, background: '#000000', helpers: false, samples: 0 };
    const shots = await renderViews(app.engine, ['front', 'top'], opt, null);
    need(shots.length === 2, 'wrong number of images');
    need(shots[0].canvas.getContext('2d').getImageData(32, 32, 1, 1).data[3] > 0, 'the image is empty');
  });

  deserialize(app, backup);
  app.projectName = name;
  app.dirty = wasDirty;
  const failed = results.filter(r => !r.ok);
  console.table(results);
  app.say(failed.length ? `Self-test: ${failed.length} failed (${failed[0].test}: ${failed[0].error})` : `Self-test: all ${results.length} checks passed`);
}
