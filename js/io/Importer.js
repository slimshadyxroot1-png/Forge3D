import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// opens the file picker
export function pickFiles(accept) {
  return new Promise(done => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = true;
    input.onchange = () => done([...input.files]);
    input.click();
  });
}

function bake(root, add) {
  const tilt = new THREE.Matrix4().makeRotationX(Math.PI / 2); // these files are Y-up, we are Z-up
  root.updateMatrixWorld(true);
  root.traverse(o => {
    if (!o.isMesh) return;
    add(o.geometry.clone().applyMatrix4(o.matrixWorld).applyMatrix4(tilt), o.material, o.name || 'Mesh');
  });
}

const grey = () => new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.5, metalness: 0 });

// turns a file into a list of meshes
export async function importFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const base = file.name.replace(/\.[^.]+$/, '');
  const buf = await file.arrayBuffer();
  const out = [];

  const add = (geo, mat, name) => {
    if (!geo.attributes.normal) geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.castShadow = m.receiveShadow = true;
    out.push(m);
  };

  if (ext === 'glb' || ext === 'gltf') {
    // a .gltf has to be one file
    const gltf = await new GLTFLoader().parseAsync(ext === 'glb' ? buf : new TextDecoder().decode(buf), '');
    bake(gltf.scene, add);
  } else if (ext === 'fbx') {
    // FBX files often use centimetres
    bake(new FBXLoader().parse(buf, ''), (g, m, n) => add(g, m.isMeshStandardMaterial ? m : grey(), n));
  } else if (ext === 'obj') {
    bake(new OBJLoader().parse(new TextDecoder().decode(buf)), (g, m, n) => add(g, grey(), n));
  } else if (ext === 'stl') {
    add(new STLLoader().parse(buf), grey(), base);
  } else if (ext === 'ply') {
    const geo = new PLYLoader().parse(buf), mat = grey();
    if (geo.attributes.color) { mat.vertexColors = true; mat.color.set(0xffffff); }
    add(geo, mat, base);
  } else {
    throw new Error(`.${ext} files are not supported`);
  }
  return out;
}
