<p align="center">
  <img src="assets/logo.png" width="260" alt="Forge3D">
</p>

<p align="center"><b>3D modeling in your browser.</b><br>No install. Just open it and build stuff.</p>

![Forge3D](assets/screenshot.png)

## Try it

Click this link to open it

https://slimshadyxroot1-png.github.io/Forge3D/

### Run it locally

```
cd forge3d
python3 -m http.server
```

Open `http://localhost:8000`

## What it can do

- Sculpting with 17 brushes
- Edit mode (extrude, inset, bevel, loop cut)
- Modifiers (mirror, array, subdivide and more)
- Texture painting + UV editor
- Material nodes + geometry nodes
- Lights, cameras and PNG render
- Import / export GLB, glTF, OBJ, STL
- Save projects as `.forge3d`

## Screenshots

**Sculpt**

![sculpt](assets/sculpt.png)

**Edit mode**

![edit mode](assets/edit_mode.png)

**Material nodes**

![nodes](assets/nodes.png)

**Texture paint**

![texture paint](assets/texture_paint.png)

**UV editor**

![uv editor](assets/uv_editor.png)

**Render**

![render](assets/render.png)

## Models

Some models to try in Forge3D are in the [models](models) folder.

![screenshot](assets/in_forge3d_island.png)

![screenshot](assets/in_forge3d_tree.png)

![screenshot](assets/in_forge3d_human.png)

## Controls

| | |
|---|---|
| Orbit | left drag |
| Pan | right drag |
| Zoom | scroll |
| Search everything | `F3` or `Ctrl+K` |
| Edit mode | `Tab` |
| Save | `Ctrl+S` |

Press `F3` and pick **Run Self-Test** to check if everything works.

## Credits

Made with Three.js