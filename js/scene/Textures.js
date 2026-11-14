import * as THREE from 'three';

const loader = new THREE.TextureLoader();

// makes a texture from an image link
export function makeTexture(src, isColor) {
  const t = loader.load(src);
  t.userData.src = src;
  t.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function applyTiling(mat) {
  const { tiling = 1, rotation = 0 } = mat.userData;
  for (const t of [mat.map, mat.normalMap]) {
    if (!t) continue;
    t.repeat.set(tiling, tiling);
    t.center.set(0.5, 0.5);
    t.rotation = THREE.MathUtils.degToRad(rotation);
  }
}

// reads an image file into a data link
export const readImage = file => new Promise(done => {
  const r = new FileReader();
  r.onload = () => done(r.result);
  r.readAsDataURL(file);
});
