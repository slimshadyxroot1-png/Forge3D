// Keyboard shortcuts. Ignored while typing in inputs or when a window is open.
export function bindShortcuts(app) {
  addEventListener('keydown', e => {
    if (e.target.matches?.('input,textarea,select,[contenteditable]')) return;
    if (document.querySelector('dialog[open]')) return;
    const k = e.key.toLowerCase();

    if (e.ctrlKey || e.metaKey) {
      if (k === 'z') { e.preventDefault(); e.shiftKey ? app.history.redo() : app.history.undo(); }
      else if (k === 'y') { e.preventDefault(); app.history.redo(); }
      return;
    }
    if (e.altKey) return;
    if (e.shiftKey && k === 'a') { e.preventDefault(); app.toggleAdd(true); return; }
    if (e.shiftKey && k === 'd') { app.act('duplicate'); return; }

    if (k === 'x' || k === 'delete') app.act('delete');
    else if (k === 'h') app.act('hide');
    else if (k === 'escape') app.toggleAdd(false);
  });
}
