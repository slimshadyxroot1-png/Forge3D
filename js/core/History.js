// Command history
export class History {
  constructor(onChange, cap = 100) { this.u = []; this.r = []; this.cap = cap; this.onChange = onChange; }
  do(c) { c.do(); this.push(c); }
  push(c) { // c already applied
    this.u.push(c);
    this.r.splice(0).forEach(x => x.dispose?.(false));
    if (this.u.length > this.cap) this.u.shift().dispose?.(true);
    this.onChange();
  }
  // forget everything (used when a project is opened)
  clear() {
    this.u.splice(0).forEach(c => c.dispose?.(true));
    this.r.splice(0).forEach(c => c.dispose?.(false));
  }
  undo() { const c = this.u.pop(); if (c) { c.undo(); this.r.push(c); this.onChange(); } }
  redo() { const c = this.r.pop(); if (c) { c.do(); this.u.push(c); this.onChange(); } }
}
