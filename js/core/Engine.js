import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { createGrid, updateGrid } from '../scene/Grid.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

export const snap = o => ({ p: o.position.toArray(), r: [o.rotation.x, o.rotation.y, o.rotation.z], s: o.scale.toArray() });
export const restore = (o, t) => { o.position.fromArray(t.p); o.rotation.set(...t.r); o.scale.fromArray(t.s); };

// the 3D viewport
export class Engine {
  shading = 'solid'; snapOn = false; snapInc = 0.5; orient = 'world'; camView = null; camLock = true; camZoom = 1; camAspect = 16 / 9; brushing = false; space = false; offMeshOrbit = true; pivot = null; environment = 'none'; envBackground = false; projection = 'persp'; tool = 'move'; sel = null;
  constructor(host) {
    this.host = host;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2)); host.appendChild(r.domElement);
    const s = this.scene = new THREE.Scene(); s.background = new THREE.Color(0x3d3d3d);
    this.world = new THREE.Group(); s.add(this.world);
    // light icons are lines
    this._rc = new THREE.Raycaster(); this._rc.params.Line.threshold = 0.12;
    // the viewport fill light
    const fill = this.fill = new THREE.Group(); s.add(fill);
    this.fillHemi = new THREE.HemisphereLight(0xffffff, 0x555555, 1.2);
    this.fillHead = new THREE.DirectionalLight(0xffffff, 1.6); // follows the camera
    this.fillHemi.position.set(0, 0, 1); // sky is up, and up is Z
    fill.add(this.fillHemi, this.fillHead, this.fillHead.target);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    // the World: light that comes from everywhere
    this.worldLight = new THREE.HemisphereLight(0x808080, 0x808080, 3); this.worldLight.position.set(0, 0, 1); s.add(this.worldLight);
    // the 3D cursor: new objects appear here
    const cur = this.cursorObj = new THREE.Group();
    const rightPts = Array.from({ length: 49 }, (_, i) => new THREE.Vector3(Math.cos(i / 48 * Math.PI * 2), Math.sin(i / 48 * Math.PI * 2), 0));
    const lineMat = c => new THREE.LineBasicMaterial({ color: c, depthTest: false, transparent: true });
    cur.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightPts), lineMat(0xff3030)));
    for (const [a, b] of [[[-1.6, 0, 0], [-0.6, 0, 0]], [[0.6, 0, 0], [1.6, 0, 0]], [[0, -1.6, 0], [0, -0.6, 0]], [[0, 0.6, 0], [0, 1.6, 0]], [[0, 0, -1.6], [0, 0, -0.6], [0, 0, 1.6]]])
      cur.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]), lineMat(0xffffff)));
    cur.traverse(o => { o.renderOrder = 998; });
    s.add(cur);

    this.grid = createGrid(); s.add(this.grid);
    this.persp = new THREE.PerspectiveCamera(40, 1, .1, 1000);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
    for (const c of [this.persp, this.ortho]) c.up.set(0, 0, 1);
    this.persp.position.set(8, -8, 6); this.camera = this.persp;
    const o = this.orbit = new OrbitControls(this.camera, r.domElement);
    // left drag orbits, right drag pans, wheel zooms
    o.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    o.addEventListener('change', () => {
      if (this.camView && this._orbiting && this.camLock) this._pushToCamera();
      this.invalidate(); this.onCamera?.();
    });
    o.addEventListener('start', () => this.beginNav());
    o.addEventListener('end', () => this.endNav());
    const t = this.tc = new TransformControls(this.camera, r.domElement); s.add(t);
    t.addEventListener('change', () => this.invalidate());
    t.addEventListener('objectChange', () => this.onTransform?.());
    t.addEventListener('dragging-changed', e => {
      o.enabled = !e.value; const x = this.sel; if (!x) return;
      if (e.value) this._b = snap(x);
      else if (this._b) { const a = snap(x); if (JSON.stringify(a) !== JSON.stringify(this._b)) this.onTransformEnd?.(x, this._b, a); this._b = null; }
    });
    this.box = new THREE.BoxHelper(new THREE.Object3D(), 0xe87d0d); this.box.visible = false; s.add(this.box);
    const dom = r.domElement;
    // scroll wheel in camera view zooms the camera view
    dom.addEventListener('wheel', e => {
      if (!this.camView) return;
      e.preventDefault();
      this.zoomCameraView(e.deltaY > 0 ? 1 / 1.1 : 1.1);
    }, { passive: false });
// capture
    dom.addEventListener('pointerdown', e => { if (e.button === 0) this._d = { x: e.clientX, y: e.clientY, a: t.axis }; });
    dom.addEventListener('pointerup', e => {
      const d = this._d; this._d = null;
      if (e.button === 0 && d && !d.a && !this.brushing && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) this.onPick?.(this.pick(e));
    });
    new ResizeObserver(() => { this.fit(); this.invalidate(); }).observe(host);
    this.applyShading();
    this.fit(); this.invalidate();
  }
  fit() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1, a = w / h;
    this.renderer.setSize(w, h);
    this.persp.aspect = a; this.persp.updateProjectionMatrix();
    const hh = this.camera.position.distanceTo(this.orbit.target) * Math.tan(this.persp.fov * Math.PI / 360), c = this.ortho;
    c.left = -hh * a; c.right = hh * a; c.top = hh; c.bottom = -hh; c.updateProjectionMatrix();
  }
  invalidate() { if (this._q) return; this._q = requestAnimationFrame(() => { this._q = 0; this.render(); }); }
  render() {
    if (this.camView) this.syncCameraView();
    this.updateFill();
    // the 3D cursor keeps the same size on screen
    this.cursorObj.scale.setScalar(this.camera.isOrthographicCamera ? (this.ortho.top - this.ortho.bottom) / this.ortho.zoom * 0.035 : this.camera.position.distanceTo(this.cursorObj.position) * 0.04);
    const s = this.sel; this.box.visible = !!s && s.visible && s !== this.camView;
    if (this.box.visible) this.box.setFromObject(s);
    updateGrid(this.grid, this.camera, this.orbit.target);
    this.renderer.render(this.scene, this.camera);
  }
  pick(e) {
    const rc = this._rc ||= new THREE.Raycaster(), b = this.renderer.domElement.getBoundingClientRect();
    rc.setFromCamera(new THREE.Vector2((e.clientX - b.left) / b.width * 2 - 1, -(e.clientY - b.top) / b.height * 2 + 1), this.camera);
    let o = rc.intersectObjects(this.world.children.filter(c => c.visible), true)[0]?.object;
    while (o && o.parent !== this.world) o = o.parent;
    return o || null;
  }
  setSelection(o) { this.sel = o; this.sync(); }
  sync() {
    const o = this.sel;
    if (this.tool === 'select' || this.tool === 'measure') this.tc.detach();
    else if (this.pivot) this.tc.attach(this.pivot);
    else if (o && o.visible && !this.brushing && o !== this.camView) this.tc.attach(o);
    else this.tc.detach();
    this.invalidate();
  }
  setTool(t) { this.tool = t; if (t !== 'select' && t !== 'measure') this.tc.setMode({ move: 'translate', rotate: 'rotate', scale: 'scale' }[t]); this.sync(); }
  setProjection(p) {
    if (this.camView) this.exitCameraView(false);
    const old = this.camera, cam = p === 'ortho' ? this.ortho : this.persp; if (cam === old) return;
    cam.position.copy(old.position); cam.quaternion.copy(old.quaternion); cam.zoom = 1;
    this.camera = cam; this.projection = p; this.orbit.object = cam; this.tc.camera = cam;
    this.fit(); this.orbit.update(); this.invalidate();
  }
  // 'wire', 'solid', 'xray', 'material'
  setShading(m) { this.shading = m; this.applyShading(); }
  applyShading() {
    this.fill.visible = ['wire', 'solid', 'xray'].includes(this.shading);
    this.syncAutoEnv();
    const x = this.shading === 'xray';
    this.world.traverse(o => { if (!o.isMesh) return; const m = o.material;
      m.wireframe = this.shading === 'wire'; m.transparent = x; m.opacity = x ? .4 : 1; m.depthWrite = !x; m.needsUpdate = true; });
    this.invalidate();
  }
  frameAll() { if (this.world.children.length) this.frame(this.world); }
  setEnvironment(kind, file) {
    this.pmrem ||= new THREE.PMREMGenerator(this.renderer);
    const use = tex => {
      if (!this._autoEnv) this.scene.environment?.dispose();
      this._autoEnv = false;
      this.scene.environment = tex;
      this.environment = tex ? kind : 'none';
      this.syncAutoEnv();
      this.updateBackground();
      this.invalidate();
    };
    if (kind === 'room') use(this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture);
    else if (kind === 'hdri' && file) {
      const url = URL.createObjectURL(file);
      new RGBELoader().load(url, tex => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        use(this.pmrem.fromEquirectangular(tex).texture);
        tex.dispose();
        URL.revokeObjectURL(url);
      });
    } else use(null);
  }

  syncAutoEnv() {
    const want = this.shading === 'material' && this.environment === 'none';
    if (want && !this._autoEnv) {
      this.pmrem ||= new THREE.PMREMGenerator(this.renderer);
      this._room ||= this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environment = this._room;
      this._autoEnv = true;
    } else if (!want && this._autoEnv) {
      this.scene.environment = null;
      this._autoEnv = false;
    }
  }

  toggleEnvBackground() {
    this.envBackground = !this.envBackground;
    this.updateBackground();
    this.invalidate();
  }

  updateBackground() {
    this.scene.background = this.envBackground && this.scene.environment ? this.scene.environment : new THREE.Color(0x3d3d3d);
  }

  // the viewport fill light follows the camera
  updateFill() {
    if (!this.fill.visible) return;
    const lit = this.world.children.some(o => o.isLight && o.visible), k = lit ? 0.4 : 1;
    this.fillHemi.intensity = 1.2 * k;
    this.fillHead.intensity = 1.6 * k;
    this.fillHead.position.copy(this.camera.position);
    this.fillHead.target.position.copy(this.orbit.target);
  }

  setSnap(on, inc = 0.5) {
    this.snapOn = on; this.snapInc = inc;
    this.tc.setTranslationSnap(on ? inc : null);
    this.tc.setRotationSnap(on ? THREE.MathUtils.degToRad(15) : null);
    this.tc.setScaleSnap(on ? 0.1 : null);
  }

  // Transform Orientation: 'world'
  setOrient(space) { this.orient = space; this.tc.setSpace(space); this.invalidate(); }

  // World lighting from the render settings
  setWorld(color, strength) {
    this.worldLight.color.set(color || '#808080');
    this.worldLight.groundColor.set(color || '#808080');
    this.worldLight.intensity = (Number.isFinite(strength) ? strength : 1) * 3;
    this.invalidate();
  }

  // used while making the final image: Rendered shading
  finalLook() {
    const prev = this.shading;
    this.setShading('rendered');
    return () => this.setShading(prev);
  }

  // called when the user starts moving the view
  beginNav() {
    if (!this.camView) return;
    if (!this.camLock) return this.exitCameraView(false);
    this._orbiting = true; this._cb = snap(this.camView);
  }

  endNav() {
    if (!this._orbiting) return;
    this._orbiting = false;
    const c = this.camView, b = this._cb, a = c && snap(c); this._cb = null;
    if (c && b && JSON.stringify(a) !== JSON.stringify(b)) this.onTransformEnd?.(c, b, a);
  }

  // camera view

  enterCameraView(cam) {
    if (!this.camView) {
      this._prev = { p: this.camera.position.clone(), q: this.camera.quaternion.clone(), t: this.orbit.target.clone(), proj: this.projection, zoom: this.camera.zoom };
      this.setProjection('persp');
    } else this.showCamIcon(this.camView, true);
    const box = new THREE.Box3();
    this.world.traverse(o => { if (o.isMesh && o.visible) box.expandByObject(o); });
    cam.updateWorldMatrix(true, false);
    const pos = cam.getWorldPosition(new THREE.Vector3());
    this._camDist = Math.max(2, pos.distanceTo(box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3())));
    this.camView = cam;
    this.camZoom = 1;
    this.orbit.enableZoom = false; // the wheel is handled by zoomCameraView()
    this.syncCameraView();
    this.sync();
    this.onCamView?.(cam);
    this.invalidate(); this.onCamera?.();
  }

  // leave the camera view
  exitCameraView(restore = true) {
    const cam = this.camView; if (!cam) return;
    this.showCamIcon(cam, true);
    this.camView = null; this._orbiting = false;
    this.orbit.enableZoom = true;
    this.persp.fov = 40; this.persp.near = .1; this.persp.far = 1000; this.persp.aspect = this.host.clientWidth / (this.host.clientHeight || 1);
    this.persp.updateProjectionMatrix();
    if (restore && this._prev) {
      const v = this._prev;
      this.persp.position.copy(v.p); this.persp.quaternion.copy(v.q); this.orbit.target.copy(v.t);
      if (v.proj === 'ortho') this.setProjection('ortho');
    }
    this.orbit.update(); this.fit(); this.sync();
    this.onFrame?.(null); this.onCamView?.(null);
    this.invalidate(); this.onCamera?.();
  }

  showCamIcon(cam, on) { cam.children.forEach(c => { if (c.userData.gizmo) c.visible = on; }); }

  // the scene camera is the master
  syncCameraView() {
    const c = this.camView, p = this.persp, W = this.host.clientWidth || 1, H = this.host.clientHeight || 1, ra = this.camAspect;
    this.showCamIcon(c, false);
    if (!this._orbiting) {
      c.updateWorldMatrix(true, false);
      c.matrixWorld.decompose(p.position, p.quaternion, p.scale);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(p.quaternion);
      this.orbit.target.copy(p.position).addScaledVector(fwd, this._camDist);
    }
    const fh = Math.min(H * 0.88, W * 0.88 / ra) * this.camZoom, fw = fh * ra;
    p.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(c.fov) / 2) * H / fh));
    p.near = c.near; p.far = c.far; p.aspect = W / H;
    p.updateProjectionMatrix();
    this.onFrame?.({ x: (W - fw) / 2, y: (H - fh) / 2, w: fw, h: fh });
  }

  // with Lock Camera to View the camera itself moves
  _pushToCamera() {
    const c = this.camView, p = this.persp;
    c.position.copy(p.position); c.quaternion.copy(p.quaternion);
    this._camDist = p.position.distanceTo(this.orbit.target);
    this.onTransform?.();
  }

  zoomCameraView(f) {
    const c = this.camView; if (!c) return;
    if (!this.camLock) this.camZoom = Math.min(8, Math.max(0.25, this.camZoom * f));
    else {
      this._zb ||= snap(c);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion), d = this._camDist, next = Math.max(0.2, d / f);
      c.position.addScaledVector(fwd, d - next);
      this._camDist = next;
      this.onTransform?.();
      // many wheel clicks in a row count as one undo step
      clearTimeout(this._zt);
      this._zt = setTimeout(() => {
        const b = this._zb, a = snap(c); this._zb = null;
        if (b && JSON.stringify(a) !== JSON.stringify(b)) this.onTransformEnd?.(c, b, a);
      }, 400);
    }
    this.invalidate(); this.onCamera?.();
  }

  fitCameraView() { this.camZoom = 1; this.invalidate(); }

  frame(o) {
    const b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3());
    const d = Math.max(b.getSize(new THREE.Vector3()).length() * 1.6, 2);
    const off = this.camera.position.clone().sub(this.orbit.target).setLength(d);
    this.orbit.target.copy(c); this.camera.position.copy(c).add(off); this.camera.zoom = 1;
    this.camera.updateProjectionMatrix(); this.orbit.update(); this.fit(); this.invalidate();
  }
}
