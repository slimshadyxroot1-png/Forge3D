import * as THREE from 'three';

const vert = `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const frag = `
  varying vec3 vWorld;
  uniform vec3 uCam;
  uniform float uStart;
  uniform float uEnd;

  // 1 on a grid line, 0 between the lines (lines stay about 1 pixel wide)
  float gridLine(vec2 p, float size) {
    vec2 q = p / size;
    vec2 g = abs(fract(q - 0.5) - 0.5) / (fwidth(q) + 1e-6);
    return 1.0 - min(min(g.x, g.y), 1.0);
  }

  void main() {
    vec2 p = vWorld.xy;
    vec2 f = fwidth(p) + 1e-6;
    float px = max(f.x, f.y); // world units per screen pixel

    // 4 grid levels: 1, 10, 100, 1000. A level fades out when its lines get too close
    float a = 0.0;
    float size = 1.0;
    for (int i = 0; i < 4; i++) {
      float show = smoothstep(4.0, 14.0, size / px);
      float strength = i == 0 ? 0.22 : 0.4;
      a = max(a, gridLine(p, size) * show * strength);
      size *= 10.0;
    }

    // colored axes, X is red and Y is green
    float ax = 1.0 - min(abs(p.y) / f.y, 1.0);
    float ay = 1.0 - min(abs(p.x) / f.x, 1.0);
    vec3 col = vec3(0.65);
    col = mix(col, vec3(0.80, 0.25, 0.25), ax);
    col = mix(col, vec3(0.45, 0.75, 0.25), ay);
    a = max(a, max(ax, ay) * 0.9);

    // fade into the background color far away (that's the fog)
    float fade = 1.0 - smoothstep(uStart, uEnd, distance(vWorld, uCam));
    gl_FragColor = vec4(col, a * fade);
    if (gl_FragColor.a < 0.003) discard;
  }`;

// one flat square that follows the camera, so the grid never ends
export function createGrid() {
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: { uCam: { value: new THREE.Vector3() }, uStart: { value: 50 }, uEnd: { value: 300 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), mat);
  grid.frustumCulled = false;
  grid.renderOrder = -1;
  return grid;
}

// move the square under the camera and set how far the fog starts and ends
export function updateGrid(grid, camera, target) {
  const u = grid.material.uniforms, d = camera.position.distanceTo(target);
  let start, end;
  if (camera.isOrthographicCamera) {
    const half = (camera.top - camera.bottom) / 2 / camera.zoom;
    start = d + half * 3;
    end = d + half * 10;
  } else {
    end = d * 25;
    start = end * 0.25;
  }
  end = Math.min(end, 450); // the square is 1000 wide, so the edge is never seen
  start = Math.min(start, end * 0.3);
  u.uStart.value = start;
  u.uEnd.value = end;
  u.uCam.value.copy(camera.position);
  grid.position.set(camera.position.x, camera.position.y, -0.001); // a bit below z = 0
}
