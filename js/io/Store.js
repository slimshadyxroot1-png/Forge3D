let opened;

function db() {
  return opened ||= new Promise((ok, fail) => {
    const req = indexedDB.open('forge3d', 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'name' });
      if (!d.objectStoreNames.contains('versions')) d.createObjectStore('versions', { autoIncrement: true });
      if (!d.objectStoreNames.contains('autosave')) d.createObjectStore('autosave', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('recents')) d.createObjectStore('recents', { keyPath: 'name' }); // links to files on the computer
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}

// do one thing in one store and wait until it is saved
async function run(store, mode, fn) {
  const d = await db();
  return new Promise((ok, fail) => {
    const tx = d.transaction(store, mode), req = fn(tx.objectStore(store));
    tx.oncomplete = () => ok(req?.result);
    tx.onerror = () => fail(tx.error);
  });
}

export const putProject = rec => run('projects', 'readwrite', s => s.put(rec));
export const getProject = name => run('projects', 'readonly', s => s.get(name));
export const listProjects = () => run('projects', 'readonly', s => s.getAll());

export const addVersion = rec => run('versions', 'readwrite', s => s.add(rec));
export const getVersion = key => run('versions', 'readonly', s => s.get(key));
export const deleteVersion = key => run('versions', 'readwrite', s => s.delete(key));

// newest version first
export async function listVersions(name) {
  const d = await db();
  return new Promise((ok, fail) => {
    const out = [], req = d.transaction('versions').objectStore('versions').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return ok(out.reverse());
      if (c.value.name === name) out.push({ key: c.key, ...c.value });
      c.continue();
    };
    req.onerror = () => fail(req.error);
  });
}

export const putAutosave = rec => run('autosave', 'readwrite', s => s.put({ ...rec, id: 'latest' }));
export const getAutosave = () => run('autosave', 'readonly', s => s.get('latest'));
export const clearAutosave = () => run('autosave', 'readwrite', s => s.delete('latest'));

export const putRecent = rec => run('recents', 'readwrite', s => s.put(rec));
export const getRecent = name => run('recents', 'readonly', s => s.get(name));
export const listRecents = () => run('recents', 'readonly', s => s.getAll());
