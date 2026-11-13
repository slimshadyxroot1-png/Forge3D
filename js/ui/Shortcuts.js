// Keyboard shortcuts
export function bindShortcuts(app) {
  addEventListener('keydown', e => {
    if (e.target.matches?.('input,textarea,select,[contenteditable]')) return;
    if (document.querySelector('dialog[open]')) return;
    const k = e.key.toLowerCase();

    if (e.ctrlKey || e.metaKey) {
      if (k === 'z') { e.preventDefault(); e.shiftKey ? app.history.redo() : app.history.undo(); }
      else if (k === 'y') { e.preventDefault(); app.history.redo(); }
      else if (e.code === 'Space') { e.preventDefault(); app.act('layout', 'full'); }
      else if (e.code === 'Numpad0') { e.preventDefault(); app.act(e.altKey ? 'aligncam' : 'setcamera'); }
      else if (k === 'i' && app.mode === 'edit') { e.preventDefault(); app.act('select', 'invert'); }
      else if (k === 'b' && app.mode === 'edit') { e.preventDefault(); app.act('edit', 'bevel'); }
      else if (k === 'l' && app.mode === 'edit') { e.preventDefault(); app.act('select', 'linked'); }
      else if (k === 'j' && app.mode === 'object') { e.preventDefault(); app.act('join'); }
      else if (app.mode === 'edit' && (e.code === 'NumpadAdd' || e.key === '+' || e.key === '=')) { e.preventDefault(); app.act('select', 'more'); }
      else if (app.mode === 'edit' && (e.code === 'NumpadSubtract' || e.key === '-')) { e.preventDefault(); app.act('select', 'less'); }
      return;
    }
    if (e.altKey && k === 'a') { app.act('select', 'none'); return; }
    if (e.altKey && k === 's' && app.mode === 'edit') { app.act('edit', 'shrink'); return; }
    if (e.altKey && k === 'z') { app.act('shade', app.engine.shading === 'xray' ? 'solid' : 'xray'); return; }
    if (e.altKey) return;
    if (k === 'tab') { e.preventDefault(); app.act('mode', app.mode === 'edit' ? 'object' : 'edit'); return; }
    if (e.shiftKey && k === 'c' && !e.ctrlKey) { app.act('cursor', 'origin'); app.act('frameall'); return; }
    if (app.mode === 'edit' && !e.shiftKey && k === 'o') { app.editor.opt.prop = !app.editor.opt.prop; app.props.cur = undefined; app.refresh(); app.warn(`Proportional Editing ${app.editor.opt.prop ? 'on' : 'off'}`); return; }
    if (app.mode === 'edit' && e.shiftKey && k === 'n') { app.act('edit', 'normals'); return; }
    if (app.mode === 'edit' && !e.shiftKey) {
      const mode = { Digit1: 'vertex', Digit2: 'edge', Digit3: 'face' }[e.code];
      const op = { e: 'extrude', i: 'inset', m: 'merge', p: 'separate', a: 'all', f: 'fill', l: 'linked' }[k];
      if (mode) { app.act('emode', mode); return; }
      if (op) { app.act('edit', op); return; }
    }
    if (e.shiftKey && k === 'a') { e.preventDefault(); app.toggleAdd(true); return; }
    if (e.shiftKey && k === 'd') { app.act('duplicate'); return; }

    const tool = { g: 'move', r: 'rotate', s: 'scale', q: 'select' }[k];
    if (tool && !e.shiftKey) app.act('tool', tool);
    else if (k === 'x' || k === 'delete') app.act('delete');
    else if (k === 'f' || e.code === 'NumpadDecimal') app.act('frame');
    else if (k === 'home') app.act('frameall');
    else if (k === 'n') app.act('layout', 'sidebar');
    else if (k === 't') app.act('layout', 'tools');
    else if (k === 'f12') { e.preventDefault(); app.act('render'); }
    else if (k === 'f11') { e.preventDefault(); app.act('renderdlg'); }
    else if (k === 'h') app.act('hide');
    else if (e.code === 'Numpad0') app.act('viewcam');
    else if (app.engine.camView && e.code === 'NumpadAdd') app.act('camzoom', 'in');
    else if (app.engine.camView && e.code === 'NumpadSubtract') app.act('camzoom', 'out');
    else if (e.code === 'Numpad5') app.act('proj', app.engine.projection === 'persp' ? 'ortho' : 'persp');
    else if (k === 'escape') app.toggleAdd(false);
  });
}
