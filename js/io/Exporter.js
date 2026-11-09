import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { PLYExporter } from 'three/addons/exporters/PLYExporter.js';
import { hideGizmos } from '../scene/Lights.js';

// download some data as a file
export function save(data, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// glb, gltf, obj and stl
export function exportScene(world, fmt) {
  if (!world.children.length) return false;
  const showIcons = hideGizmos(world); // light icons are not part of the model

  // our scene has Z up, glTF and OBJ want Y up
  world.rotation.x = fmt === 'stl' || fmt === 'ply' ? 0 : -Math.PI / 2;
  world.updateMatrixWorld(true);
  const reset = () => { world.rotation.x = 0; world.updateMatrixWorld(true); showIcons(); };

  if (fmt === 'stl') {
    save(new STLExporter().parse(world, { binary: true }), 'model.stl', 'model/stl');
    reset();
  } else if (fmt === 'ply') {
    new PLYExporter().parse(world, result => { save(result, 'model.ply', 'application/octet-stream'); reset(); }, { binary: true });
  } else if (fmt === 'obj') {
    save(new OBJExporter().parse(world), 'model.obj', 'text/plain');
    reset();
  } else {
    // glTF works with a callback
    new GLTFExporter().parse(world, result => {
      if (fmt === 'glb') save(result, 'model.glb', 'model/gltf-binary');
      else save(JSON.stringify(result), 'model.gltf', 'model/gltf+json');
      reset();
    }, err => { console.error(err); reset(); }, { binary: fmt === 'glb' });
  }
  return true;
}
