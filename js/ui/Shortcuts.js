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
      return;
    }
    if (e.altKey && k === 'z') { app.act('shade', app.engine.shading === 'xray' ? 'solid' : 'xray'); return; }
    if (e.altKey) return;
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
