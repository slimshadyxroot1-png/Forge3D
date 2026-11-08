import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

RectAreaLightUniformsLib.init(); // area lights need this once

// same names as the Add > Light menu
export const LIGHT_NAMES = { point: 'Point', sun: 'Sun', spot: 'Spot', area: 'Area' };

// where each new light starts
const START = { point: [2, -2, 4], sun: [4, -4, 6], spot: [3, -3, 5], area: [0, -4, 4] };

export const lightType = l => (l.isSpotLight ? 'spot' : l.isDirectionalLight ? 'sun' : l.isRectAreaLight ? 'area' : 'point');

// lights point along their own -Z axis
export function createLight(type, name, color = 0xffffff) {
  let l;
  if (type === 'point') l = new THREE.PointLight(color, 60, 0, 2);
  else if (type === 'sun') l = new THREE.DirectionalLight(color, 3);
  else if (type === 'area') l = new THREE.RectAreaLight(color, 15, 3, 2);
  else l = new THREE.SpotLight(color, 120, 0, THREE.MathUtils.degToRad(35), 0.3, 2);

  l.name = name;
  l.up.set(0, 0, 1);
  l.castShadow = type !== 'area'; // area lights can't make shadows in Three.js
  if (l.shadow) {
    l.shadow.bias = -0.0005;
    l.shadow.mapSize.set(type === 'sun' ? 2048 : 1024, type === 'sun' ? 2048 : 1024);
  }
  if (type === 'sun') {
    Object.assign(l.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, far: 60 });
    l.shadow.camera.updateProjectionMatrix();
  }
  if (type === 'sun' || type === 'spot') {
    // the target is a child
    l.add(l.target);
    l.target.position.set(0, 0, -1);
  }
  l.position.set(...START[type]);
  if (type !== 'point') l.lookAt(0, 0, 0);
  refreshGizmo(l);
  return l;
}

// makes a new light from an old one
export function cloneLight(src, name, type = lightType(src), keepSettings = true) {
  const n = createLight(type, name, src.color.getHex());
  n.position.copy(src.position);
  n.quaternion.copy(src.quaternion);
  n.scale.copy(src.scale);
  n.castShadow = src.castShadow;
  if (keepSettings) {
    for (const k of ['intensity', 'distance', 'angle', 'penumbra', 'width', 'height']) if (k in src && k in n) n[k] = src[k];
  }
  refreshGizmo(n);
  return n;
}

// the little icon you see
export function refreshGizmo(l) {
  const old = l.children.find(c => c.userData.gizmo);
  if (old) { l.remove(old); old.geometry.dispose(); old.material.dispose(); }

  const pts = [];
  const seg = (a, b) => pts.push(...a, ...b);
  // a circle in one of the 3 planes
  const ring = (r, plane = 0, z = 0, n = 24) => {
    const at = t => {
      const c = Math.cos(t) * r, s = Math.sin(t) * r;
      return plane === 0 ? [c, s, z] : plane === 1 ? [c, z, s] : [z, c, s];
    };
    for (let i = 0; i < n; i++) seg(at(i / n * Math.PI * 2), at((i + 1) / n * Math.PI * 2));
  };

  if (l.isPointLight) {
    ring(0.3, 0); ring(0.3, 1); ring(0.3, 2);
  } else if (l.isDirectionalLight) {
    ring(0.3);
    for (let i = 0; i < 8; i++) { // sun rays
      const a = i / 8 * Math.PI * 2;
      seg([Math.cos(a) * 0.4, Math.sin(a) * 0.4, 0], [Math.cos(a) * 0.65, Math.sin(a) * 0.65, 0]);
    }
    seg([0, 0, 0], [0, 0, -2]); // arrow showing the direction
    for (const [x, y] of [[0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]]) seg([0, 0, -2], [x, y, -1.8]);
  } else if (l.isSpotLight) {
    const len = 1.5, r = Math.tan(l.angle) * len;
    ring(0.15);
    ring(r, 0, -len, 32);
    for (let i = 0; i < 4; i++) { // cone sides
      const a = i / 4 * Math.PI * 2;
      seg([0, 0, 0], [Math.cos(a) * r, Math.sin(a) * r, -len]);
    }
    seg([0, 0, 0], [0, 0, -len]);
  } else {
    const w = l.width / 2, h = l.height / 2;
    seg([-w, -h, 0], [w, -h, 0]); seg([w, -h, 0], [w, h, 0]); seg([w, h, 0], [-w, h, 0]); seg([-w, h, 0], [-w, -h, 0]);
    seg([-w, -h, 0], [w, h, 0]); seg([w, -h, 0], [-w, h, 0]);
    seg([0, 0, 0], [0, 0, -1]);
  }

  const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const icon = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xe8c36a }));
  icon.userData.gizmo = true;
  l.add(icon);
}

export function hideGizmos(root) {
  const list = [];
  root.traverse(o => { if (o.userData.gizmo && o.visible) list.push(o); });
  list.forEach(o => { o.visible = false; });
  return () => list.forEach(o => { o.visible = true; });
}
