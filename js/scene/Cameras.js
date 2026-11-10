import * as THREE from 'three';

// focal length for a sensor that is 24 mm tall
export const fovFromLength = mm => THREE.MathUtils.radToDeg(2 * Math.atan(12 / mm));

export function createCamera(name) {
  const c = new THREE.PerspectiveCamera(fovFromLength(50), 16 / 9, 0.1, 100);
  c.name = name;
  c.up.set(0, 0, 1);
  c.userData.focal = 50;
  c.position.set(6, -6, 4);
  c.lookAt(0, 0, 0);
  refreshCameraGizmo(c);
  return c;
}

export function cloneCamera(src, name) {
  const c = createCamera(name);
  c.position.copy(src.position);
  c.quaternion.copy(src.quaternion);
  c.userData.focal = src.userData.focal;
  c.fov = src.fov;
  c.near = src.near;
  c.far = src.far;
  c.updateProjectionMatrix();
  refreshCameraGizmo(c);
  return c;
}

// the pyramid icon you click in the viewport
export function refreshCameraGizmo(c) {
  const old = c.children.find(o => o.userData.gizmo);
  if (old) { c.remove(old); old.geometry.dispose(); old.material.dispose(); }

  const depth = 1.2, h = Math.tan(THREE.MathUtils.degToRad(c.fov) / 2) * depth, w = h * 16 / 9;
  const corners = [[-w, h], [w, h], [w, -h], [-w, -h]], pts = [];
  corners.forEach(([x, y], i) => {
    const [nx, ny] = corners[(i + 1) % 4];
    pts.push(0, 0, 0, x, y, -depth, x, y, -depth, nx, ny, -depth);
  });
  // small triangle on top shows which way is up
  pts.push(-w * 0.5, h * 1.1, -depth, 0, h * 1.5, -depth, 0, h * 1.5, -depth, w * 0.5, h * 1.1, -depth);

  const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const icon = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xe8c36a }));
  icon.userData.gizmo = true;
  c.add(icon);
}
