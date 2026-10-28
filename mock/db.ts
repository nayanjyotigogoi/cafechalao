import { buildSeed } from "./seed";
import { TABLE_NAMES, type TableName, type Tables } from "./tables";

/**
 * In-browser database for mock mode. Holds every table in memory, saves a snapshot to IndexedDB,
 * and broadcasts each row change to other open tabs (POS in one tab, KDS in another stay in sync).
 * Handlers must change rows only through insert / update / remove so every tab sees the change.
 */

type Row = { id?: string } & Record<string, unknown>;
type Change = { table: TableName; op: "insert" | "update" | "delete"; row: Row };

const DB_NAME = "cafechalao-mock";
const STORE = "snapshot";
const VERSION_KEY = "v3";

let tables: Tables | null = null;
let loading: Promise<Tables> | null = null;
const channel: BroadcastChannel | null = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("cc-mock-db") : null;
const listeners = new Set<(c: Change) => void>();

function idb(): Promise<IDBDatabase> | null {
  if (typeof indexedDB === "undefined") return null;
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function readSnapshot(): Promise<Tables | null> {
  try {
    const db = await idb();
    if (!db) return null;
    return await new Promise((res) => {
      const tx = db.transaction(STORE, "readonly").objectStore(STORE).get(VERSION_KEY);
      tx.onsuccess = () => res((tx.result as Tables) ?? null);
      tx.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave() {
  if (typeof indexedDB === "undefined") return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const db = await idb();
      if (!db || !tables) return;
      db.transaction(STORE, "readwrite").objectStore(STORE).put(tables, VERSION_KEY);
    } catch {
      /* storage blocked (private mode): data lives for this session only */
    }
  }, 400);
}

export async function getDB(): Promise<Tables> {
  if (tables) return tables;
  if (!loading) {
    loading = (async () => {
      const snap = await readSnapshot();
      const t = snap ?? buildSeed();
      for (const k of TABLE_NAMES) if (!t[k]) (t as unknown as Record<string, unknown[]>)[k] = [];
      tables = t;
      if (!snap) scheduleSave();
      return t;
    })();
  }
  return loading;
}

/** Synchronous access once loaded (used inside handlers after getDB resolved). */
export function db(): Tables {
  if (!tables) throw new Error("Mock DB not loaded");
  return tables;
}

/** Tests and the "Reset demo data" button start from a fresh seed. */
export async function resetDB(now?: Date) {
  tables = buildSeed(now);
  loading = Promise.resolve(tables);
  scheduleSave();
  channel?.postMessage({ reset: true });
  return tables;
}

/** For unit tests: load a seed synchronously without IndexedDB. */
export function useMemoryDB(t: Tables) {
  tables = t;
  loading = Promise.resolve(t);
}

function emit(c: Change) {
  scheduleSave();
  channel?.postMessage(c);
  listeners.forEach((l) => l(c));
}

export function onChange(fn: (c: Change) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

channel?.addEventListener("message", async (e: MessageEvent) => {
  const c = e.data as Change & { reset?: boolean };
  if (c.reset) {
    tables = null;
    loading = null;
    await getDB();
    listeners.forEach((l) => l({ table: "orders", op: "update", row: {} }));
    return;
  }
  if (!tables) return;
  const arr = tables[c.table] as unknown as Row[];
  const i = arr.findIndex((r) => r.id === c.row.id);
  if (c.op === "insert" && i < 0) arr.push(c.row);
  else if (i >= 0) arr[i] = c.row;
  listeners.forEach((l) => l(c));
});

export function insert<K extends TableName>(table: K, row: Tables[K][number]): Tables[K][number] {
  (db()[table] as unknown as Row[]).push(row as Row);
  emit({ table, op: "insert", row: row as Row });
  return row;
}

export function update<K extends TableName>(table: K, id: string, patch: Partial<Tables[K][number]>): Tables[K][number] {
  const arr = db()[table] as unknown as Row[];
  const i = arr.findIndex((r) => r.id === id);
  if (i < 0) throw new Error(`${table}/${id} not found`);
  const next = { ...arr[i], ...patch, ...("updated_at" in arr[i] ? { updated_at: new Date().toISOString() } : {}) } as Row;
  arr[i] = next;
  emit({ table, op: "update", row: next });
  return next as Tables[K][number];
}

/** Soft delete (SRS: every table has a soft-delete flag; invoices are never hard-deleted). */
export function remove<K extends TableName>(table: K, id: string) {
  return update(table, id, { deleted_at: new Date().toISOString() } as unknown as Partial<Tables[K][number]>);
}
