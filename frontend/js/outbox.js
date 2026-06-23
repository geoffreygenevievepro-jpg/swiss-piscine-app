// File d'attente hors-ligne des rapports (IndexedDB). Un rapport est mis en file
// puis poussé vers l'API dès que le réseau est disponible. Aucune dépendance.
import { api } from "./api.js";

const DB_NAME = "sp-outbox";
const STORE = "reports";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function enqueue(slotId, payload) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, "readwrite").add({ slotId, payload, queued_at: Date.now() });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, "readonly").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function remove(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, "readwrite").delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function count() {
  try { return (await listAll()).length; } catch { return 0; }
}

// Pousse tous les rapports en attente. Renvoie le nombre restant en file.
let syncing = false;
export async function sync() {
  if (syncing || !navigator.onLine) return await count();
  syncing = true;
  try {
    const items = await listAll();
    for (const item of items) {
      try {
        await api(`/interventions/${item.slotId}/report`, { method: "POST", body: item.payload });
        await remove(item.id);
      } catch (e) {
        // 4xx = rapport invalide → on le retire pour ne pas boucler ; 5xx/réseau → on garde.
        if (e.status && e.status >= 400 && e.status < 500) await remove(item.id);
        else break; // réseau/serveur : on réessaiera plus tard
      }
    }
  } finally {
    syncing = false;
  }
  return await count();
}
