import * as THREE from 'three';
import { createLight, refreshGizmo, lightType } from '../scene/Lights.js';
import { baseOf, applyStack } from '../scene/Modifiers.js';
import { makeTexture, applyTiling } from '../scene/Textures.js';
import { createCamera, refreshCameraGizmo, fovFromLength } from '../scene/Cameras.js';

const FORMAT = 'forge3d';
const VERSION = 1;
const TYPES = { Float32Array, Uint16Array, Uint32Array };

// typed array <-> text
function toText(arr) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromText(text, type) {
  const s = atob(text), bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new TYPES[type](bytes.buffer);
}

const saveArray = (arr, itemSize) => ({ type: arr.constructor.name, itemSize, data: toText(arr) });
const loadArray = a => new THREE.BufferAttribute(fromText(a.data, a.type), a.itemSize);

// position, rotation and scale
const saveTransform = o => ({ name: o.name, visible: o.visible, p: o.position.toArray(), r: o.rotation.toArray(), s: o.scale.toArray() });
function loadTransform(o, n) {
  o.name = n.name;
  o.visible = n.visible;
  o.position.fromArray(n.p);
  o.rotation.fromArray(n.r);
  o.scale.fromArray(n.s);
}

function saveMesh(o) {
  const g = baseOf(o), m = o.material, attrs = {};
  for (const k in g.attributes) attrs[k] = saveArray(g.attributes[k].array, g.attributes[k].itemSize);
  return {
    type: 'mesh', ...saveTransform(o), primitive: o.userData.type,
    material: {
      color: m.color.getHex(), roughness: m.roughness, metalness: m.metalness, vertexColors: m.vertexColors,
      doubleSided: m.side === THREE.DoubleSide,
      map: m.map?.userData.canvas ? m.map.userData.canvas.toDataURL() : m.map?.userData.src || null, normalMap: m.normalMap?.userData.src || null,
      tiling: m.userData.tiling ?? 1, rotation: m.userData.rotation ?? 0, nodes: m.userData.nodes || null,
    },
    modifiers: o.userData.modifiers || [],
    geometry: { attrs, index: g.index ? saveArray(g.index.array, 1) : null, userData: g.userData },
  };
}

function loadMesh(n) {
  const g = new THREE.BufferGeometry();
  for (const k in n.geometry.attrs) g.setAttribute(k, loadArray(n.geometry.attrs[k]));
  if (n.geometry.index) g.setIndex(loadArray(n.geometry.index));
  g.userData = n.geometry.userData || {};
  g.computeBoundingSphere();
  g.computeBoundingBox();
  const m = n.material;
  const mat = new THREE.MeshStandardMaterial({
    color: m.color, roughness: m.roughness, metalness: m.metalness, vertexColors: m.vertexColors,
    side: m.doubleSided ? THREE.DoubleSide : THREE.FrontSide });
  mat.userData.tiling = m.tiling ?? 1;
  mat.userData.rotation = m.rotation ?? 0;
  if (m.nodes) mat.userData.nodes = m.nodes;
  if (m.map) mat.map = makeTexture(m.map, true);
  if (m.normalMap) mat.normalMap = makeTexture(m.normalMap, false);
  applyTiling(mat);
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.type = n.primitive;
  loadTransform(mesh, n);
  if (n.modifiers?.length) applyStack(mesh, n.modifiers, g);
  return mesh;
}

function saveLight(o) {
  return {
    type: 'light', light: lightType(o), ...saveTransform(o), color: o.color.getHex(),
    intensity: o.intensity, distance: o.distance, angle: o.angle, penumbra: o.penumbra, castShadow: o.castShadow,
    width: o.width, height: o.height,
  };
}

function loadLight(n) {
  const l = createLight(n.light, n.name, n.color);
  l.intensity = n.intensity;
  l.castShadow = n.castShadow;
  if (n.distance !== undefined && 'distance' in l) l.distance = n.distance;
  if (n.angle !== undefined && 'angle' in l) l.angle = n.angle;
  if (n.penumbra !== undefined && 'penumbra' in l) l.penumbra = n.penumbra;
  if (n.width !== undefined && 'width' in l) { l.width = n.width; l.height = n.height; }
  loadTransform(l, n);
  refreshGizmo(l);
  return l;
}

function saveCamera(o) {
  return { type: 'camera', ...saveTransform(o), focal: o.userData.focal, near: o.near, far: o.far };
}

function loadCamera(n) {
  const c = createCamera(n.name);
  c.userData.focal = n.focal;
  c.fov = fovFromLength(n.focal);
  c.near = n.near;
  c.far = n.far;
  c.updateProjectionMatrix();
  loadTransform(c, n);
  refreshCameraGizmo(c);
  return c;
}

// .forge3d files are zipped
export async function pack(text) {
  if (typeof CompressionStream === 'undefined') return new Blob([text], { type: 'application/json' });
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

export async function unpack(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return new TextDecoder().decode(bytes);
}

// the whole project as one json text
export function serialize(app) {
  const e = app.engine;
  const save = o => (o.isLight ? saveLight(o) : o.isCamera ? saveCamera(o) : saveMesh(o));
  const objects = e.world.children.filter(o => o.isMesh || o.isLight || o.isCamera).map(save);
  return JSON.stringify({
    format: FORMAT,
    version: VERSION,
    meta: { name: app.projectName, saved: new Date().toISOString() },
    scene: { objects, activeCamera: app.activeCamera()?.name || null },
    view: {
      projection: e.projection, shading: e.shading, environment: e.environment === 'hdri' ? 'none' : e.environment,
      camera: { position: e.camera.position.toArray(), target: e.orbit.target.toArray(), zoom: e.camera.zoom },
    },
    render: app.renderSettings(),
    workspace: app.layout.state,
  });
}

export function deserialize(app, text) {
  const d = JSON.parse(text), e = app.engine;
  if (d.format !== FORMAT) throw new Error('This is not a Forge3D project');
  if (d.version > VERSION) throw new Error('This project was made with a newer Forge3D');

  app.clearScene();
  const load = n => (n.type === 'light' ? loadLight(n) : n.type === 'camera' ? loadCamera(n) : loadMesh(n));
  d.scene.objects.forEach(n => e.world.add(load(n)));
  app.camActive = e.world.children.find(o => o.isCamera && o.name === d.scene.activeCamera) || null;

  // camera and viewport settings
  e.setProjection(d.view.projection);
  const c = d.view.camera;
  e.camera.position.fromArray(c.position);
  e.orbit.target.fromArray(c.target);
  e.camera.zoom = c.zoom;
  e.camera.updateProjectionMatrix();
  e.orbit.update();
  e.fit();
  e.setEnvironment(d.view.environment || 'none');
  e.setShading(['wire', 'solid', 'xray', 'material', 'rendered'].includes(d.view.shading) ? d.view.shading : 'solid');

  if (d.view.lighting && !e.world.children.some(o => o.isLight)) e.world.add(app.defaultLight());

  app.setRenderSettings(d.render);
  Object.assign(app.layout.state, d.workspace);
  app.layout.apply();
  app.refresh();
  return d;
}
