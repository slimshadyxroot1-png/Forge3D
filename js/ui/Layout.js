const KEY = 'forge3d.layout';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class Layout {
  constructor() {
    this.main = document.querySelector('main');
    this.side = document.querySelector('#side');
    this.state = { side: 270, out: 220, sidebar: true, tools: true, flip: false, closed: [] };
    try { Object.assign(this.state, JSON.parse(localStorage.getItem(KEY))); } catch { /* first visit */ }
    this.apply();

    // drag the thin bars to resize
    this.drag('#splitV', e => { this.state.side = clamp(this.state.flip ? e.clientX : innerWidth - e.clientX, 180, 600); this.apply(); });
    this.drag('#splitH', e => {
      const top = this.side.getBoundingClientRect().top;
      this.state.out = clamp(e.clientY - top, 60, this.side.clientHeight - 80);
      this.apply();
    });

    // click a panel title to fold it
    document.querySelectorAll('.panel>h3').forEach(h => h.addEventListener('click', () => {
      h.parentElement.classList.toggle('closed');
      this.state.closed = [...document.querySelectorAll('.panel.closed')].map(p => p.id);
      this.save();
    }));
  }

  apply() {
    const root = document.documentElement.style;
    root.setProperty('--side-w', this.state.side + 'px');
    root.setProperty('--out-h', this.state.out + 'px');
    this.main.classList.toggle('no-side', !this.state.sidebar);
    this.main.classList.toggle('no-tools', !this.state.tools);
    this.main.classList.toggle('flip', this.state.flip);
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('closed', this.state.closed.includes(p.id)));
  }

  drag(selector, onMove) {
    const el = document.querySelector(selector);
    el.addEventListener('pointerdown', e => {
      el.setPointerCapture(e.pointerId);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', () => { el.removeEventListener('pointermove', onMove); this.save(); }, { once: true });
    });
  }

  // 'sidebar', 'tools' or 'full'
  toggle(what) {
    if (what === 'full') return document.body.classList.toggle('full');
    if (what === 'flip') { this.state.flip = !this.state.flip; this.apply(); return this.save(); }
    const key = what === 'tools' ? 'tools' : 'sidebar';
    this.state[key] = !this.state[key];
    this.apply();
    this.save();
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch { /* storage blocked, ignore */ }
  }
}
