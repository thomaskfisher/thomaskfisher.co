/**
 * Local persistence. No servers, ever.
 *
 * IndexedDB is the primary store with localStorage mirrored alongside it, because
 * either one can fail independently: IndexedDB throws outright in some private
 * browsing modes, and localStorage has a small quota. Writes go to both; reads
 * prefer whichever has the newer record.
 *
 * The one real weakness of a server-free design is that iOS can evict
 * script-writable storage under disk pressure or when Safari data is cleared,
 * and local data never follows you to a new phone. `exportSave`/`importSave`
 * are the escape hatch — see the Settings sheet.
 */

const DB_NAME = 'tf-games';
const DB_VERSION = 1;
const STORE = 'saves';
const LS_PREFIX = 'tf-games:';

interface Envelope<T> {
  /** Wall-clock ms. Used only to pick the newer of two mirrored copies. */
  updatedAt: number;
  data: T;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null); // Private mode, disabled storage, sandboxed context.
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return dbPromise;
}

function idbGet<T>(key: string): Promise<Envelope<T> | null> {
  return openDb().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(null);
        try {
          const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
          req.onsuccess = () => resolve((req.result as Envelope<T>) ?? null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

function idbSet<T>(key: string, value: Envelope<T>): Promise<boolean> {
  return openDb().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(false);
        try {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(value, key);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
          tx.onabort = () => resolve(false);
        } catch {
          resolve(false);
        }
      }),
  );
}

function lsGet<T>(key: string): Envelope<T> | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? (JSON.parse(raw) as Envelope<T>) : null;
  } catch {
    return null;
  }
}

function lsSet<T>(key: string, value: Envelope<T>): boolean {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false; // Quota exceeded, or storage disabled.
  }
}

/** Reads both stores and returns whichever copy is newer. */
export async function load<T>(key: string): Promise<T | null> {
  const [fromIdb, fromLs] = [await idbGet<T>(key), lsGet<T>(key)];
  if (!fromIdb) return fromLs?.data ?? null;
  if (!fromLs) return fromIdb.data;
  return (fromIdb.updatedAt >= fromLs.updatedAt ? fromIdb : fromLs).data;
}

/** Writes to both stores. Resolves false only when both failed. */
export async function save<T>(key: string, data: T): Promise<boolean> {
  const envelope: Envelope<T> = { updatedAt: Date.now(), data };
  const okLs = lsSet(key, envelope);
  const okIdb = await idbSet(key, envelope);
  return okIdb || okLs;
}

export async function remove(key: string): Promise<void> {
  try {
    localStorage.removeItem(LS_PREFIX + key);
  } catch {
    /* ignore */
  }
  const db = await openDb();
  if (!db) return;
  try {
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key);
  } catch {
    /* ignore */
  }
}

/**
 * Coalesces rapid writes (every tap would otherwise hit storage) while
 * guaranteeing a flush when the page goes away.
 *
 * iOS frequently never fires `beforeunload`, so `pagehide` and
 * `visibilitychange` are the events that actually matter here.
 */
export function createPersister<T>(key: string, delayMs = 250) {
  let pending: T | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending === null) return;
    const value = pending;
    pending = null;
    void save(key, value);
  };

  const schedule = (value: T): void => {
    pending = value;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, delayMs);
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }

  return { schedule, flush };
}

/* ------------------------------------------------------------------ */
/* Export / import — the backup that makes a server unnecessary        */
/* ------------------------------------------------------------------ */

const CODE_PREFIX = 'TFG1.';

/** URL-safe base64 of the save JSON, prefixed so a mistyped paste fails loudly. */
export function encodeSaveCode(data: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const b64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return CODE_PREFIX + b64;
}

export function decodeSaveCode<T>(code: string): T {
  const trimmed = code.trim();
  if (!trimmed.startsWith(CODE_PREFIX)) {
    throw new Error('That does not look like a save code.');
  }
  const b64 = trimmed.slice(CODE_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
