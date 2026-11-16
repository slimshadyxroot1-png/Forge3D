import { PRIMS } from '../scene/Primitives.js';
import { LIGHT_NAMES } from '../scene/Lights.js';
import { MODIFIERS } from '../scene/Modifiers.js';

const $ = s => document.querySelector(s);

// [name, action, argument]
const COMMANDS = [
  ['Undo', 'undo'], ['Redo', 'redo'],
  ['Duplicate Object', 'duplicate'], ['Delete Object', 'delete'], ['Hide Object', 'hide'],
  ['Frame Selected', 'frame'], ['Frame All', 'frameall'],
  ['View: Perspective', 'proj', 'persp'], ['View: Orthographic', 'proj', 'ortho'],
  ['Shading: Solid', 'shade', 'solid'], ['Shading: Wireframe', 'shade', 'wire'], ['Shading: X-Ray', 'shade', 'xray'],
  ['Shading: Material Preview', 'shade', 'material'], ['Shading: Rendered', 'shade', 'rendered'],
  ['Mode: Object', 'mode', 'object'], ['Mode: Edit', 'mode', 'edit'],
  ['Edit: Extrude', 'edit', 'extrude'], ['Edit: Inset', 'edit', 'inset'], ['Edit: Subdivide', 'edit', 'subdivide'],
  ['Edit: Delete', 'edit', 'delete'], ['Edit: Merge', 'edit', 'merge'], ['Edit: Duplicate', 'edit', 'duplicate'],
  ['Edit: Separate', 'edit', 'separate'], ['Edit: Flip Normals', 'edit', 'flip'], ['Edit: Select All', 'edit', 'all'],
  ['Edit: Select None', 'edit', 'none'], ['Edit: Invert Selection', 'edit', 'invert'],
  ['Edit: Select Linked', 'edit', 'linked'], ['Edit: Select More', 'edit', 'more'], ['Edit: Select Less', 'edit', 'less'],
  ['Edit: Bevel', 'edit', 'bevel'], ['Edit: Loop Cut at Position', 'edit', 'cut'], ['Edit: Loop Cut Through Selection', 'edit', 'cutsel'], ['Edit: Bridge Edge Loops', 'edit', 'bridge'],
  ['Edit: Fill', 'edit', 'fill'], ['Edit: Smooth Vertices', 'edit', 'smooth'], ['Edit: To Sphere', 'edit', 'sphere'], ['Edit: Shrink/Fatten', 'edit', 'shrink'],
  ['Edit: Recalculate Normals Outside', 'edit', 'normals'], ['Edit: Recalculate Normals Inside', 'edit', 'normalsin'], ['Edit: Merge by Distance', 'edit', 'doubles'],
  ['Object: Apply All Transforms', 'apply', 'all'], ['Object: Apply Location', 'apply', 'location'], ['Object: Apply Rotation', 'apply', 'rotation'], ['Object: Apply Scale', 'apply', 'scale'],
  ['Object: Origin to Geometry', 'origin', 'geometry'], ['Object: Origin to Center of Mass', 'origin', 'mass'],
  ['Object: Shade Smooth', 'shademesh', 'smooth'], ['Object: Shade Flat', 'shademesh', 'flat'], ['Object: Join', 'join'], ['Object: Boolean', 'boolean'],
  ['Add: Text', 'addtext'], ['Object: Origin to 3D Cursor', 'origin', 'cursor'], ['Snap: Cursor to World Origin', 'cursor', 'origin'], ['Snap: Cursor to Selected', 'cursor', 'selected'], ['Snap: Selection to Cursor', 'tocursor'],
  ['Tool: Measure', 'tool', 'measure'],
  ['Snapping: Toggle', 'snap'], ['Transform Orientation: Global / Local', 'orient'],
  ['Open UV Editor', 'workspace', 'uv'], ['Mode: Texture Paint', 'mode', 'texpaint'],
  ['Environment: None', 'env', 'none'], ['Environment: Room Lighting', 'env', 'room'], ['Environment: Load HDRI...', 'env', 'hdri'],
  ['Environment: Show as Background', 'envbg'], ['Move Panels to Other Side', 'layout', 'flip'], ['Open Material Nodes', 'workspace', 'shading'], ['Open Geometry Nodes', 'workspace', 'geonodes'], ['Mode: Sculpt', 'mode', 'sculpt'], ['Mode: Vertex Paint', 'mode', 'paint'],
  ['Tool: Select', 'tool', 'select'], ['Tool: Move', 'tool', 'move'], ['Tool: Rotate', 'tool', 'rotate'], ['Tool: Scale', 'tool', 'scale'],
  ['Export GLB', 'save', 'glb'], ['Export glTF', 'save', 'gltf'], ['Export OBJ', 'save', 'obj'], ['Export STL', 'save', 'stl'], ['Export PLY', 'save', 'ply'],
  ['Project: Save', 'project', 'save'], ['Project: Save As', 'project', 'saveAs'], ['Project: Open', 'project', 'open'],
  ['Project: New', 'project', 'newProject'], ['Project: Download .forge3d', 'project', 'download'],
  ['Project: Recent and Versions', 'project', 'showRecent'], ['Import Model', 'importfiles'], ['Add: Camera', 'addcamera'], ['View: Camera', 'viewcam'], ['View: Set Active Object as Camera', 'setcamera'], ['View: Align Camera to View', 'aligncam'], ['View: Lock Camera to View', 'camlock'], ['Run Self-Test', 'selftest'],
  ['Render Image', 'render'], ['Render: View Render Settings', 'renderdlg'],
  ['Toggle Sidebar', 'layout', 'sidebar'], ['Toggle Toolbar', 'layout', 'tools'], ['Toggle Fullscreen Viewport', 'layout', 'full'],
];

// command search window
export class Palette {
  constructor(app) {
    this.app = app;
    this.dlg = $('#palette');
    this.input = $('#pq');
    this.list = $('#plist');
    this.index = 0;
    this.shown = [];
    this.items = [
      ...COMMANDS,
      ...Object.keys(PRIMS).map(k => [`Add: ${k}`, 'add', k]),
      ...Object.entries(LIGHT_NAMES).map(([k, n]) => [`Add: Light > ${n}`, 'addlight', k]),
      ...Object.entries(MODIFIERS).map(([k, m]) => [`Add Modifier: ${m.label}`, 'addmod', k]),
    ];

    this.input.oninput = () => { this.index = 0; this.render(); };
    this.input.onkeydown = e => {
      if (e.key === 'ArrowDown') this.index = Math.min(this.index + 1, this.shown.length - 1);
      else if (e.key === 'ArrowUp') this.index = Math.max(this.index - 1, 0);
      else if (e.key === 'Enter') return this.run(this.shown[this.index]);
      else return;
      e.preventDefault();
      this.render();
    };
    this.list.onclick = e => {
      const row = e.target.closest('[data-i]');
      if (row) this.run(this.shown[+row.dataset.i]);
    };
  }

  open() {
    this.input.value = '';
    this.index = 0;
    this.render();
    this.dlg.showModal();
    this.input.focus();
  }

  render() {
    const q = this.input.value.toLowerCase();
    this.shown = this.items.filter(c => c[0].toLowerCase().includes(q)).slice(0, 12);
    this.list.innerHTML = this.shown.map((c, i) =>
      `<div class="item${i === this.index ? ' on' : ''}" data-i="${i}">${c[0]}</div>`).join('')
      || '<div class="empty">No commands found</div>';
  }

  run(cmd) {
    if (!cmd) return;
    this.dlg.close();
    this.app.act(cmd[1], cmd[2]);
  }
}
