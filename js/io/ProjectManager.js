import { serialize, deserialize, pack, unpack } from './Project.js';
import { save as download } from './Exporter.js';
import { pickFiles } from './Importer.js';
import * as store from './Store.js';

const $ = s => document.querySelector(s);
const KEEP = 5;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TYPES = [{ description: 'Forge3D project', accept: { 'application/octet-stream': ['.forge3d'] } }];
const canPick = 'showSaveFilePicker' in window;

// new, open, save, autosave and recovery
export class ProjectManager {
  constructor(app) {
    this.app = app;
    this.handle = null; // the file on the computer that Save writes to

    setInterval(() => this.autosave(), 30000);
    addEventListener('beforeunload', e => {
      if (!app.dirty) return;
      this.autosave();
      e.preventDefault();
    });

    $('#recentclose').onclick = () => $('#recent').close();
    $('#recentlist').onclick = async e => {
      const recent = e.target.closest('[data-recent]'), project = e.target.closest('[data-project]'), version = e.target.closest('[data-version]');
      if (!(recent || project || version) || !this.ok()) return;
      try {
        if (recent) {
          const rec = await store.getRecent(recent.dataset.recent);
          if ((await rec.handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return app.say('Permission was not given');
          $('#recent').close();
          await this.openFile(await rec.handle.getFile(), rec.handle);
        } else {
          const rec = project ? await store.getProject(project.dataset.project) : await store.getVersion(+version.dataset.version);
          $('#recent').close();
          this.openText(rec.data, rec.name);
        }
      } catch (err) {
        console.error(err);
        app.say(`Could not open it: ${err.message}`);
      }
    };
  }

  // asks before throwing away unsaved work
  ok() { return !this.app.dirty || confirm('You have unsaved changes. Continue anyway?'); }

  newProject() {
    if (!this.ok()) return;
    this.app.clearScene();
    this.app.startScene();
    this.app.projectName = 'Untitled';
    this.app.dirty = false;
    this.handle = null;
    store.clearAutosave();
    this.app.refresh();
  }

  // pick a .forge3d file on the computer
  async open() {
    try {
      let file, handle = null;
      if (canPick) {
        [handle] = await showOpenFilePicker({ types: TYPES });
        file = await handle.getFile();
      } else [file] = await pickFiles('.forge3d');
      if (file && this.ok()) await this.openFile(file, handle);
    } catch (err) {
      if (err.name !== 'AbortError') { console.error(err); this.app.say(`Could not open it: ${err.message}`); }
    }
  }

  async openFile(file, handle = null) {
    this.openText(await unpack(await file.arrayBuffer()), file.name.replace(/\.forge3d$/i, ''));
    this.handle = handle; // Save will write into this same file
    if (handle) this.remember(handle);
  }

  openText(text, name, recovered = false) {
    try {
      deserialize(this.app, text);
    } catch (err) {
      console.error(err);
      return this.app.say(`Could not open project: ${err.message}`);
    }
    this.handle = null;
    this.app.projectName = name;
    this.app.dirty = recovered;
    if (!recovered) store.clearAutosave();
    this.app.say(`Opened ${name}`);
  }

  // Save: writes the file you opened or saved before
  async save() {
    if (this.handle) return this.write(this.handle);
    if (!canPick && this.app.projectName !== 'Untitled') return this.write(null);
    return this.saveAs();
  }

  // Save As: choose a new place and name on the computer
  async saveAs() {
    const app = this.app;
    try {
      if (canPick) {
        const handle = await showSaveFilePicker({ suggestedName: `${app.projectName}.forge3d`, types: TYPES });
        app.projectName = handle.name.replace(/\.forge3d$/i, '');
        await this.write(handle);
        this.handle = handle;
        this.remember(handle);
      } else {
        const name = prompt('File name', app.projectName === 'Untitled' ? '' : app.projectName);
        if (!name?.trim()) return;
        app.projectName = name.trim().replace(/[\\/:*?"<>|]/g, '_');
        await this.write(null);
      }
    } catch (err) {
      if (err.name !== 'AbortError') { console.error(err); app.say(`Could not save: ${err.message}`); }
    }
  }

  // writes the project into the file
  async write(handle) {
    const app = this.app, text = serialize(app), blob = await pack(text);
    try {
      if (handle) {
        if ((await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') await handle.requestPermission({ mode: 'readwrite' });
        const out = await handle.createWritable();
        await out.write(blob);
        await out.close();
      } else download(blob, `${app.projectName}.forge3d`, 'application/octet-stream');
    } catch (err) {
      console.error(err);
      return app.say(`Could not save: ${err.message}`);
    }
    app.dirty = false;
    app.say(handle ? `Saved to ${handle.name}` : `Downloaded ${app.projectName}.forge3d (this browser can not write over files)`);

    try {
      const rec = { name: app.projectName, saved: Date.now(), data: text };
      await store.addVersion(rec);
      for (const v of (await store.listVersions(rec.name)).slice(KEEP)) await store.deleteVersion(v.key);
      await store.clearAutosave();
    } catch (err) { console.error(err); }
  }

  // a copy that is always downloaded
  async download() {
    download(await pack(serialize(this.app)), `${this.app.projectName}.forge3d`, 'application/octet-stream');
  }

  // the list of recent files is kept inside the browser
  async remember(handle) {
    try { await store.putRecent({ name: handle.name, handle, saved: Date.now() }); } catch (err) { console.error('Could not remember the file', err); }
  }

  async autosave() {
    if (!this.app.dirty) return;
    try { await store.putAutosave({ name: this.app.projectName, saved: Date.now(), data: serialize(this.app) }); }
    catch (err) { console.error('Autosave failed', err); }
  }

  async checkRecovery() {
    let rec;
    try { rec = await store.getAutosave(); } catch { return; }
    if (!rec) return;
    $('#recovermsg').textContent = `Found unsaved work "${rec.name}" from ${new Date(rec.saved).toLocaleString()}. Recover it?`;
    $('#recoveryes').onclick = () => { $('#recover').close(); this.openText(rec.data, rec.name, true); };
    $('#recoverno').onclick = () => { $('#recover').close(); store.clearAutosave(); };
    $('#recover').showModal();
  }

  async showRecent() {
    const row = (attr, label, time) =>
      `<div class="rrow" ${attr}><span>${esc(label)}</span><span>${new Date(time).toLocaleString()}</span></div>`;
    const recents = (await store.listRecents()).sort((a, b) => b.saved - a.saved);
    const projects = (await store.listProjects()).sort((a, b) => b.saved - a.saved);
    const versions = await store.listVersions(this.app.projectName);
    $('#recentlist').innerHTML =
      '<h4>Files on your computer</h4>' +
      (recents.map(r => row(`data-recent="${esc(r.name)}"`, r.name, r.saved)).join('') || '<div class="empty">No files yet. Use Save As.</div>') +
      (projects.length ? '<h4>Old projects saved inside the browser</h4>' + projects.map(p => row(`data-project="${esc(p.name)}"`, p.name, p.saved)).join('') : '') +
      (versions.length ? `<h4>Older versions of ${esc(this.app.projectName)} (browser copies)</h4>` + versions.map(v => row(`data-version="${v.key}"`, 'Version', v.saved)).join('') : '');
    $('#recent').showModal();
  }
}
