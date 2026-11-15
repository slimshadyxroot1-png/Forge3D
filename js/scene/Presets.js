import * as THREE from 'three';
import { noise3 } from './Modifiers.js';
import { fnTexture } from './MaterialNodes.js';

const lerp3 = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);

// pictures made from math, used by some presets
const wood = (u, v) => {
  const grain = noise3(u * 4, v * 30, 0) * 0.5 + 0.5, t = Math.sin((u * 10 + grain * 3) * Math.PI) * 0.5 + 0.5;
  return lerp3([0.35, 0.2, 0.1], [0.62, 0.42, 0.24], t);
};
const concrete = (u, v) => {
  const x = 0.55 + noise3(u * 20, v * 20, 1) * 0.1 + noise3(u * 90, v * 90, 2) * 0.05;
  return [x, x, x];
};

export const PRESETS = {
  Plastic: { color: '#c8302b', metalness: 0, roughness: 0.35 },
  Metal: { color: '#b8bcc2', metalness: 1, roughness: 0.35 },
  Gold: { color: '#ffc94d', metalness: 1, roughness: 0.25 },
  Silver: { color: '#e6e8ea', metalness: 1, roughness: 0.2 },
  Glass: { color: '#ffffff', metalness: 0, roughness: 0.02, transmission: 1, ior: 1.5 },
  Wood: { color: '#ffffff', metalness: 0, roughness: 0.7, map: wood },
  Concrete: { color: '#ffffff', metalness: 0, roughness: 0.95, map: concrete },
  Rubber: { color: '#1e1e1e', metalness: 0, roughness: 0.9 },
  Ceramic: { color: '#f2efe9', metalness: 0, roughness: 0.15 },
  Fabric: { color: '#5b6fa8', metalness: 0, roughness: 1 },
  Skin: { color: '#e0ac92', metalness: 0, roughness: 0.55 },
  Water: { color: '#a9d4f5', metalness: 0, roughness: 0.04, transmission: 0.95, ior: 1.33 },
  Emissive: { color: '#ffffff', metalness: 0, roughness: 0.5, emission: '#ffd27a', emissionStrength: 2 },
};

// a brand new material for the preset
export function makePresetMaterial(old, name) {
  const p = PRESETS[name], glass = p.transmission > 0;
  const m = glass ? new THREE.MeshPhysicalMaterial() : new THREE.MeshStandardMaterial();
  m.color.set(p.color);
  m.metalness = p.metalness;
  m.roughness = p.roughness;
  m.side = old.side;
  if (glass) { m.transmission = p.transmission; m.ior = p.ior; m.thickness = 0.5; }
  if (p.emission) { m.emissive.set(p.emission); m.emissiveIntensity = p.emissionStrength; }
  if (p.map) m.map = fnTexture(p.map);
  return m;
}
