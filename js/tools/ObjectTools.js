import * as THREE from 'three';
import { toData, fromData, hasModifiers } from '../scene/Modifiers.js';
import { applyMatrix, join, boolean } from '../scene/MeshOps.js';

const needPlain = (app, m) => {
  if (!m?.isMesh) { app.say('Select a mesh first'); return false; }
  if (app.mode !== 'object') { app.say('Go back to Object Mode first'); return false; }
  if (hasModifiers(m)) { app.say('Apply the modifiers first'); return false; }
  return true;
};

// swaps the geometry of a mesh
export function swap(app, mesh, nextGeo, nextTf = null, extra = null) {
  const prevGeo = mesh.geometry, prevTf = { p: mesh.position.clone(), q: mesh.quaternion.clone(), s: mesh.scale.clone() };
  const set = (g, tf) => {
    mesh.geometry = g;
    if (tf) { mesh.position.copy(tf.p); mesh.quaternion.copy(tf.q); mesh.scale.copy(tf.s); }
    app.engine.sync();
    app.engine.invalidate();
    app.props.cur = undefined;
    app.refresh();
  };
  app.history.do({
    do: () => { set(nextGeo, nextTf); extra?.do(); },
    undo: () => { set(prevGeo, nextTf ? prevTf : null); extra?.undo(); },
    dispose: done => (done ? prevGeo : nextGeo).dispose(),
  });
}

export function applyTransform(app, mesh, what) {
  if (!needPlain(app, mesh)) return;
  const keepLoc = !(what === 'all' || what === 'location'), keepRot = !(what === 'all' || what === 'rotation'), keepScl = !(what === 'all' || what === 'scale');
  mesh.updateMatrix();
  const W = mesh.matrix.clone();
  const tf = {
    p: keepLoc ? mesh.position.clone() : new THREE.Vector3(),
    q: keepRot ? mesh.quaternion.clone() : new THREE.Quaternion(),
    s: keepScl ? mesh.scale.clone() : new THREE.Vector3(1, 1, 1),
  };
  const W2 = new THREE.Matrix4().compose(tf.p, tf.q, tf.s);
  const M = W2.clone().invert().multiply(W); // new geometry = W2^-1 * W * old geometry
  const g = mesh.geometry.clone();
  g.applyMatrix4(M);
  if (M.determinant() < 0 && g.index) { // mirrored: turn the faces back out
    const a = g.index.array;
    for (let t = 0; t < a.length; t += 3) [a[t + 1], a[t + 2]] = [a[t + 2], a[t + 1]];
    g.index.needsUpdate = true;
  }
  g.computeBoundingBox(); g.computeBoundingSphere();
  swap(app, mesh, g, tf);
}

// Set Origin: 'geometry'
export function setOrigin(app, mesh, where) {
  if (!needPlain(app, mesh)) return;
  const g = mesh.geometry.clone(), P = g.attributes.position, c = new THREE.Vector3();
  if (where === 'cursor') {
    mesh.updateMatrix();
    c.copy(app.engine.cursorObj.position).applyMatrix4(mesh.matrix.clone().invert());
  } else if (where === 'mass') {
    for (let i = 0; i < P.count; i++) c.add(new THREE.Vector3().fromBufferAttribute(P, i));
    c.divideScalar(P.count || 1);
  } else { g.computeBoundingBox(); g.boundingBox.getCenter(c); }
  g.translate(-c.x, -c.y, -c.z);
  mesh.updateMatrix();
  const tf = { p: c.clone().applyMatrix4(mesh.matrix), q: mesh.quaternion.clone(), s: mesh.scale.clone() };
  swap(app, mesh, g, tf);
}

// Shade Smooth / Shade Flat
export function shade(app, mesh, smooth) {
  if (!needPlain(app, mesh)) return;
  let g;
  if (smooth) { const d = toData(mesh.geometry); d.smoothShade = true; g = fromData(d); } else { g = mesh.geometry.toNonIndexed(); g.computeVertexNormals(); }
  g.userData = { ...mesh.geometry.userData };
  swap(app, mesh, g);
}

// asking which other object to use

function ask(app, title, candidates, ops) {
  return new Promise(done => {
    const dlg = document.createElement('dialog');
    dlg.innerHTML = `<h3>${title}</h3><div class="form">
      ${ops ? `<label>Operation<select id="od-op">${ops.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>` : ''}
      <label>With<select id="od-obj">${candidates.map((c, i) => `<option value="${i}">${c.name}</option>`).join('')}</select></label>
      <div class="btns"><button id="od-ok">OK</button><button id="od-cancel">Cancel</button></div></div>`;
    document.body.appendChild(dlg);
    const close = v => { dlg.close(); dlg.remove(); done(v); };
    dlg.querySelector('#od-ok').onclick = () => close({ obj: candidates[+dlg.querySelector('#od-obj').value], op: dlg.querySelector('#od-op')?.value });
    dlg.querySelector('#od-cancel').onclick = () => close(null);
    dlg.addEventListener('cancel', () => close(null));
    dlg.showModal();
  });
}

const others = (app, mesh) => app.engine.world.children.filter(o => o.isMesh && o !== mesh && o.visible && !hasModifiers(o));

// Join: another mesh becomes part of this one
export async function joinObjects(app, mesh) {
  if (!needPlain(app, mesh)) return;
  const list = others(app, mesh);
  if (!list.length) return app.say('Needs a second visible mesh without modifiers');
  const pick = await ask(app, 'Join', list);
  if (!pick) return;
  const other = pick.obj;
  mesh.updateMatrix(); other.updateMatrix();
  const rel = mesh.matrix.clone().invert().multiply(other.matrix);
  const b = applyMatrix(toData(other.geometry), rel.elements);
  const g = fromData(join(toData(mesh.geometry), b));
  const w = app.engine.world;
  swap(app, mesh, g, null, {
    do: () => { w.remove(other); },
    undo: () => { w.add(other); },
  });
  app.select(mesh);
}

// Boolean: Union, Difference
export async function booleanObjects(app, mesh) {
  if (!needPlain(app, mesh)) return;
  const list = others(app, mesh);
  if (!list.length) return app.say('Needs a second visible mesh without modifiers');
  const pick = await ask(app, 'Boolean', list, [['difference', 'Difference (this minus the other)'], ['union', 'Union'], ['intersect', 'Intersect']]);
  if (!pick) return;
  const other = pick.obj;
  const count = o => (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  if (count(mesh) + count(other) > 60000) return app.say('These meshes are too heavy for a Boolean');
  app.say('Working...');
  await new Promise(r => setTimeout(r, 30));
  mesh.updateMatrix(); other.updateMatrix();
  let r;
  try {
    const A = applyMatrix(toData(mesh.geometry), mesh.matrix.elements), B = applyMatrix(toData(other.geometry), other.matrix.elements);
    r = boolean(A, B, pick.op);
    if (!r.idx.length) return app.say('The result is empty. Do the two shapes overlap?');
    applyMatrix(r, mesh.matrix.clone().invert().elements);
  } catch (err) {
    console.error(err);
    return app.say('Boolean failed: the shapes may be too complex');
  }
  r.smoothShade = false;
  const g = fromData(r), was = other.visible;
  swap(app, mesh, g, null, {
    do: () => { other.visible = false; app.engine.sync(); },
    undo: () => { other.visible = was; app.engine.sync(); },
  });
  app.select(mesh);
}

// text

let fontPromise = null;
const loadFont = () => fontPromise ||= Promise.all([
  import('three/addons/loaders/FontLoader.js'),
  import('three/addons/geometries/TextGeometry.js'),
]).then(([{ FontLoader }, { TextGeometry }]) => new Promise((ok, fail) => {
  new FontLoader().load('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json', font => ok({ font, TextGeometry }), undefined, fail);
})).catch(err => { fontPromise = null; throw err; });

