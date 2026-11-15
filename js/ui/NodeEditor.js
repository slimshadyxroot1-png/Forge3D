import { pickFiles } from '../io/Importer.js';
import { readImage } from '../scene/Textures.js';

// sockets only connect to the same family of values
const FAMILY = { num: 'val', color: 'val', geo: 'geo', shader: 'shader', points: 'points' };

// A small node editor
export class NodeEditor {
  constructor(root, defs, onChange) {
    this.defs = defs;
    this.onChange = onChange;
    this.pan = { x: 0, y: 0 };
    this.sel = null;
    this.timer = 0;

    const options = Object.entries(defs).filter(([, d]) => !d.fixed)
      .map(([k, d]) => `<option value="${k}">${d.label}</option>`).join('');
    root.innerHTML = `
      <div class="ne-bar">
        <select id="ne-add"><option value="">Add node...</option>${options}</select>
        <button id="ne-del">Delete Node</button>
        <span class="lbl">Drag from a dot on the right to a dot on the left to connect. Double-click an input dot to disconnect.</span>
      </div>
      <div class="ne-area"><svg class="ne-links"></svg><div class="ne-nodes"></div></div>`;
    this.area = root.querySelector('.ne-area');
    this.svg = root.querySelector('.ne-links');
    this.box = root.querySelector('.ne-nodes');

    root.querySelector('#ne-add').onchange = e => { if (e.target.value) { this.add(e.target.value); e.target.value = ''; } };
    root.querySelector('#ne-del').onclick = () => this.removeSelected();
    this.area.addEventListener('pointerdown', e => this.down(e));
    this.box.addEventListener('input', e => this.edit(e));
    this.box.addEventListener('change', e => this.edit(e));
    this.box.addEventListener('click', e => this.click(e));
    this.box.addEventListener('dblclick', e => {
      const s = e.target.closest('.ne-sock.in');
      if (s) this.unlink(+s.dataset.node, s.dataset.socket);
    });
  }

  load(graph) {
    this.graph = graph;
    this.sel = null;
    this.render();
  }

  node(id) { return this.graph.nodes.find(n => n.id === id); }

  changed() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.onChange(this.graph), 120);
  }

  render() {
    this.box.innerHTML = this.graph.nodes.map(n => this.nodeHtml(n)).join('');
    this.box.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px)`;
    this.drawLinks();
  }

  nodeHtml(n) {
    const def = this.defs[n.type];
    const outs = def.outputs.map(o => `<div class="ne-row out"><span>${o.name}</span>
      <i class="ne-sock out" data-node="${n.id}" data-socket="${o.name}" data-kind="${o.kind}"></i></div>`).join('');
    const ins = def.inputs.map(i => {
      const linked = this.graph.links.some(l => l.to === n.id && l.toSocket === i.name);
      const sock = i.socket === false ? '' : `<i class="ne-sock in" data-node="${n.id}" data-socket="${i.name}" data-kind="${i.kind}"></i>`;
      return `<div class="ne-row in">${sock}<span>${i.name}</span>${linked ? '' : this.field(n, i)}</div>`;
    }).join('');
    return `<div class="ne-node${n.id === this.sel ? ' sel' : ''}" data-id="${n.id}" style="left:${n.x}px;top:${n.y}px">
      <div class="ne-head">${def.label}</div>${outs}${ins}</div>`;
  }

  // the box you type in when the input is not connected
  field(n, i) {
    const value = n.values?.[i.name] ?? i.value, at = `data-node="${n.id}" data-in="${i.name}"`;
    if (i.kind === 'num') return `<input type="number" step="0.1" ${at} value="${value}">`;
    if (i.kind === 'color') return `<input type="color" ${at} value="${value}">`;
    if (i.kind === 'select') return `<select ${at}>${i.options.map(o => `<option${o === value ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
    if (i.kind === 'file') return `<button data-node="${n.id}" data-file="${i.name}">${value ? 'Change...' : 'Load...'}</button>`;
    return '';
  }

  edit(e) {
    const el = e.target;
    if (!el.dataset.in) return;
    this.setValue(+el.dataset.node, el.dataset.in, el.type === 'number' ? +el.value : el.value);
    this.changed();
  }

  setValue(id, name, value) {
    const n = this.node(id);
    n.values ||= {};
    n.values[name] = value;
  }

  async click(e) {
    const b = e.target.closest('[data-file]');
    if (!b) return;
    const [file] = await pickFiles('image/*');
    if (!file) return;
    this.setValue(+b.dataset.node, b.dataset.file, await readImage(file));
    this.render();
    this.changed();
  }

  select(id) {
    this.sel = id;
    this.box.querySelectorAll('.ne-node').forEach(el => el.classList.toggle('sel', +el.dataset.id === id));
  }

  add(type) {
    const n = this.graph.nodes.length;
    this.graph.nodes.push({ id: this.graph.next++, type, x: 60 - this.pan.x + (n % 6) * 24, y: 80 - this.pan.y + (n % 6) * 24, values: {} });
    this.render();
  }

  removeSelected() {
    const n = this.node(this.sel);
    if (!n || this.defs[n.type].fixed) return;
    this.graph.nodes = this.graph.nodes.filter(x => x !== n);
    this.graph.links = this.graph.links.filter(l => l.from !== n.id && l.to !== n.id);
    this.sel = null;
    this.render();
    this.changed();
  }

  unlink(id, socket) {
    this.graph.links = this.graph.links.filter(l => !(l.to === id && l.toSocket === socket));
    this.render();
    this.changed();
  }

  connect(from, fromSocket, to, toSocket) {
    const outKind = this.defs[this.node(from).type].outputs.find(o => o.name === fromSocket).kind;
    const inKind = this.defs[this.node(to).type].inputs.find(i => i.name === toSocket).kind;
    if (from !== to && FAMILY[outKind] === FAMILY[inKind]) {
      this.graph.links = this.graph.links.filter(l => !(l.to === to && l.toSocket === toSocket)); // one link per input
      this.graph.links.push({ from, fromSocket, to, toSocket });
      this.changed();
    }
    this.render();
  }

  down(e) {
    const sock = e.target.closest('.ne-sock.out'), head = e.target.closest('.ne-head');
    let drag = null;
    if (sock) drag = { kind: 'link', from: sock };
    else if (head) {
      const n = this.node(+head.parentElement.dataset.id);
      this.select(n.id);
      drag = { kind: 'move', n, x: e.clientX - n.x, y: e.clientY - n.y };
    } else if (e.target === this.area || e.target === this.svg) drag = { kind: 'pan', x: e.clientX - this.pan.x, y: e.clientY - this.pan.y };
    if (!drag) return;
    e.preventDefault();

    const move = ev => {
      if (drag.kind === 'move') {
        drag.n.x = ev.clientX - drag.x;
        drag.n.y = ev.clientY - drag.y;
        const el = this.box.querySelector(`[data-id="${drag.n.id}"]`);
        el.style.left = drag.n.x + 'px';
        el.style.top = drag.n.y + 'px';
        this.drawLinks();
      } else if (drag.kind === 'pan') {
        this.pan = { x: ev.clientX - drag.x, y: ev.clientY - drag.y };
        this.box.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px)`;
        this.drawLinks();
      } else this.drawLinks({ from: drag.from, x: ev.clientX, y: ev.clientY });
    };
    const up = ev => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      if (drag.kind !== 'link') return;
      const to = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.ne-sock.in');
      if (to) this.connect(+drag.from.dataset.node, drag.from.dataset.socket, +to.dataset.node, to.dataset.socket);
      else this.drawLinks();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  // draws the curves between connected dots
  drawLinks(temp) {
    const area = this.area.getBoundingClientRect();
    const center = el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2 - area.left, r.top + r.height / 2 - area.top]; };
    const dot = (side, id, name) => this.box.querySelector(`.ne-sock.${side}[data-node="${id}"][data-socket="${name}"]`);
    const curve = ([x1, y1], [x2, y2]) => `<path d="M${x1} ${y1} C${x1 + 60} ${y1} ${x2 - 60} ${y2} ${x2} ${y2}"/>`;
    let html = '';
    for (const l of this.graph.links) {
      const a = dot('out', l.from, l.fromSocket), b = dot('in', l.to, l.toSocket);
      if (a && b) html += curve(center(a), center(b));
    }
    if (temp) html += curve(center(temp.from), [temp.x - area.left, temp.y - area.top]);
    this.svg.innerHTML = html;
  }
}
