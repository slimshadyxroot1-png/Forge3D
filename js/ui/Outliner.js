const EYE = '<svg viewBox="0 0 16 16"><path d="M1 8c2-4 12-4 14 0-2 4-12 4-14 0z" fill="none" stroke="currentColor"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>';
const X = '<svg viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5"/></svg>';
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Outliner {
  constructor(app, el) {
    this.app = app; this.el = el;
    const obj = e => { const r = e.target.closest('[data-id]'); return r && app.engine.world.getObjectById(+r.dataset.id); };
    el.addEventListener('click', e => {
      const o = obj(e); if (!o) return; const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'vis') app.setVisible(o, !o.visible); else if (a === 'del') app.remove(o); else app.select(o);
    });
    el.addEventListener('dblclick', e => {
      const n = e.target.closest('.name'), o = obj(e); if (!n || !o) return;
      const i = document.createElement('input'); i.value = o.name; n.replaceWith(i); i.focus(); i.select();
      let fin = false; const done = ok => { if (fin) return; fin = true; if (ok && i.value.trim()) app.rename(o, i.value.trim()); else this.render(); };
      i.onkeydown = k => { k.stopPropagation(); if (k.key === 'Enter') done(true); if (k.key === 'Escape') done(false); };
      i.onblur = () => done(true);
    });
  }
  render() {
    const a = this.app, ch = a.engine.world.children;
    this.el.innerHTML = '<div class="row coll">Scene Collection</div>' + (ch.map(o =>
      `<div class="row${o === a.sel ? ' sel' : ''}${o.visible ? '' : ' hid'}" data-id="${o.id}"><i class="ob${o.isLight ? ' lt' : ''}"></i><span class="name">${esc(o.name)}</span>` +
      `<button class="ic" data-a="vis" title="Toggle visibility">${EYE}</button><button class="ic" data-a="del" title="Delete">${X}</button></div>`).join('')
      || '<div class="empty">Empty scene. Use Add or Shift+A.</div>');
  }
}
