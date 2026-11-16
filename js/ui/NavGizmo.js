import * as THREE from 'three';

// the axis widget in the corner
const AXES = [
  { v: [1, 0, 0], color: '#e0524d', label: 'X' },
  { v: [-1, 0, 0], color: '#e0524d' },
  { v: [0, 1, 0], color: '#7fc24a', label: 'Y' },
  { v: [0, -1, 0], color: '#7fc24a' },
  { v: [0, 0, 1], color: '#4f8fe0', label: 'Z' },
  { v: [0, 0, -1], color: '#4f8fe0' },
];
const UP = new THREE.Vector3(0, 0, 1);

export class NavGizmo {
  constructor(host, engine, app) {
    this.engine = engine;
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.id = 'nav';
    this.svg.setAttribute('viewBox', '-50 -50 100 100');
    host.appendChild(this.svg);

    const bar = document.createElement('div');
    bar.id = 'navbtns';
    bar.innerHTML = `
      <button data-nav="pan" title="Drag to pan"><svg viewBox="0 0 16 16"><path d="M8 1v14M1 8h14M8 1L6 3M8 1l2 2M8 15l-2-2M8 15l2-2M1 8l2-2M1 8l2 2M15 8l-2-2M15 8l-2 2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg></button>
      <button data-nav="zoom" title="Drag to zoom"><svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.6"/></svg></button>
      <button data-nav="proj" title="Perspective / Orthographic"><svg viewBox="0 0 16 16"><path d="M2 5l6-3 6 3v6l-6 3-6-3zM2 5l6 3 6-3M8 8v6" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></button>`;
    host.appendChild(bar);

    // one pointer handler for everything
    this.drag = null;
    const down = (e, kind) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      this.drag = { kind, x: e.clientX, y: e.clientY, moved: false };
    };
    const move = e => {
      const d = this.drag;
      if (!d) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 3) return;
      if (!d.moved && d.kind !== 'proj') engine.beginNav();
      d.moved = true;
      d.x = e.clientX;
      d.y = e.clientY;
      this[d.kind]?.(dx, dy);
    };
    const up = () => {
      const d = this.drag;
      this.drag = null;
      if (d?.moved) engine.endNav();
      if (!d || d.moved) return;
      if (d.kind === 'proj') app.act('proj', engine.projection === 'persp' ? 'ortho' : 'persp');
    };
    this.svg.addEventListener('pointerdown', e => down(e, 'orbit'));
    bar.addEventListener('pointerdown', e => {
      const b = e.target.closest('[data-nav]');
      if (b) down(e, b.dataset.nav);
    });
    for (const el of [this.svg, bar]) {
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', () => { this.drag = null; });
    }
    this.update();
  }

  // turn the camera around the point it looks at
  orbit(dx, dy) {
    const e = this.engine, cam = e.camera, target = e.orbit.target;
    const offset = cam.position.clone().sub(target);
    offset.applyAxisAngle(UP, -dx * 0.01); // left and right: around the up axis
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion).applyAxisAngle(UP, -dx * 0.01);
    const tilted = offset.clone().applyAxisAngle(right, -dy * 0.01); // up and down
    if (Math.abs(tilted.z) / tilted.length() < 0.995) offset.copy(tilted); // don't flip over the top
    cam.position.copy(target).add(offset);
    e.orbit.update();
  }

  pan(dx, dy) {
    const e = this.engine, cam = e.camera, d = cam.position.distanceTo(e.orbit.target);
    const height = cam.isPerspectiveCamera ? 2 * d * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) : (cam.top - cam.bottom) / cam.zoom;
    const k = height / e.host.clientHeight;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const move = right.multiplyScalar(-dx * k).add(up.multiplyScalar(dy * k));
    cam.position.add(move);
    e.orbit.target.add(move);
    e.orbit.update();
    e.invalidate();
  }

  // drag up to zoom in, down to zoom out
  zoom(dx, dy) {
    const e = this.engine, cam = e.camera, f = Math.exp(dy * 0.01);
    if (cam.isOrthographicCamera) {
      cam.zoom = Math.min(200, Math.max(0.05, cam.zoom / f));
      cam.updateProjectionMatrix();
    } else {
      const offset = cam.position.clone().sub(e.orbit.target);
      cam.position.copy(e.orbit.target).add(offset.multiplyScalar(Math.max(f, 0.01)));
    }
    e.orbit.update();
    e.invalidate();
  }

  // redraw using the way the camera is turned right now
  update() {
    const inv = this.engine.camera.quaternion.clone().invert(), v = new THREE.Vector3();
    const items = AXES.map(a => {
      v.set(...a.v).applyQuaternion(inv);
      return { ...a, x: v.x * 30, y: -v.y * 30, depth: v.z };
    });
    items.sort((a, b) => a.depth - b.depth); // far ones first, near ones on top

    this.svg.innerHTML = '<circle r="46" fill="#ffffff" opacity="0.05"/>' + items.map(i => {
      const main = !!i.label, r = main ? 9 : 6.5;
      return `<g>
        ${main ? `<line x2="${i.x}" y2="${i.y}" stroke="${i.color}" stroke-width="2"/>` : ''}
        <circle cx="${i.x}" cy="${i.y}" r="${r}" fill="${main ? i.color : '#2b2b2b'}" stroke="${i.color}" stroke-width="1.2"/>
        ${main ? `<text x="${i.x}" y="${i.y + 3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="#111">${i.label}</text>` : ''}
      </g>`;
    }).join('');
  }
}
