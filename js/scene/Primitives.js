import * as THREE from 'three';
import { baseOf } from './Modifiers.js';

// rotate so the shape stands up along Z
const zUp = g => g.rotateX(Math.PI / 2);

export const PRIMS = {
  'Cube': () => new THREE.BoxGeometry(2, 2, 2, 24, 24, 24),
  'UV Sphere': () => new THREE.SphereGeometry(1, 64, 32),
  'Icosphere': () => new THREE.IcosahedronGeometry(1, 16),
  'Cylinder': () => zUp(new THREE.CylinderGeometry(1, 1, 2, 48, 24)),
  'Cone': () => zUp(new THREE.ConeGeometry(1, 2, 48, 24)),
  'Torus': () => new THREE.TorusGeometry(1, .35, 32, 96),
  'Plane': () => new THREE.PlaneGeometry(2, 2, 48, 48),
  'Circle': () => new THREE.CircleGeometry(1, 48),
  'Grid': () => new THREE.PlaneGeometry(2, 2, 10, 10),
};

export function createPrimitive(type, name) {
  const flat = type === 'Plane' || type === 'Circle' || type === 'Grid';
  const mat = new THREE.MeshStandardMaterial({
    color: 0xaaaaaa, roughness: .5, metalness: 0,
    side: flat ? THREE.DoubleSide : THREE.FrontSide });
  const m = new THREE.Mesh(PRIMS[type](), mat);
  m.name = name; m.userData.type = type;
  // so the lights you add can make shadows
  m.castShadow = m.receiveShadow = true;
  return m;
}

// Cube -> Cube.001 -> Cube.002
export function uniqueName(root, base) {
  const used = new Set(root.children.map(o => o.name));
  if (!used.has(base)) return base;
  for (let i = 1; ; i++) {
    const n = `${base}.${String(i).padStart(3, '0')}`;
    if (!used.has(n)) return n;
  }
}

// free the GPU memory
export function disposeObject(o) {
  o.traverse(c => {
    c.geometry?.dispose();
    if (c.isMesh) baseOf(c).dispose(); // the original mesh behind the modifiers
    c.material?.dispose();
    c.shadow?.dispose();
  });
}
