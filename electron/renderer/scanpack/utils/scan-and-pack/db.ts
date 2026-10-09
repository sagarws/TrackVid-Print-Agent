/**
 * IndexedDB persistence for Scan & Pack.
 *
 * The module is frontend-only for now, so batches survive a reload here rather
 * than on a server. PDF bytes live in their own object store: the batch list
 * reads hundreds of rows of metadata and must never drag megabytes of PDF along
 * with it.
 */
import type { ScanPackBatch, ScanPackDocument } from "../../types/scanAndPack.types";

const DB_NAME = "trackvid-scan-and-pack";
const DB_VERSION = 1;
const BATCH_STORE = "batches";
const DOC_STORE = "documents";

let dbPromise: Promise<IDBDatabase> | null = null;

const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BATCH_STORE)) {
        db.createObjectStore(BATCH_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(DOC_STORE)) {
        const store = db.createObjectStore(DOC_STORE, { keyPath: "id" });
        store.createIndex("batchId", "batchId", { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // The browser can close a connection on its own (storage pressure, disk
      // error, site data cleared) and another window can ask for it to be
      // released. Either way the cached handle is dead: every later
      // `db.transaction()` throws "The database connection is closing", so drop
      // it and let the next call reopen.
      db.onclose = () => forgetDb(db);
      db.onversionchange = () => {
        db.close();
        forgetDb(db);
      };
      currentDb = db;
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open the Scan & Pack database."));
    request.onblocked = () =>
      reject(new Error("The Scan & Pack database is in use by another window. Close it and try again."));
  });
  // A failed open must not be cached, otherwise every later call rejects with
  // the same stale error and the module never recovers.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
};

let currentDb: IDBDatabase | null = null;

const forgetDb = (db: IDBDatabase) => {
  if (currentDb === db) {
    currentDb = null;
    dbPromise = null;
  }
};

const isClosingError = (err: unknown) =>
  err instanceof DOMException && err.name === "InvalidStateError";

/**
 * Opens a transaction, reopening the connection once if the cached one turns
 * out to be closed. `onclose` does not fire for a `db.close()` that is still in
 * progress, so the error itself is the only reliable signal.
 */
const transaction = async (
  stores: string | string[],
  mode: IDBTransactionMode
): Promise<IDBTransaction> => {
  for (let attempt = 0; ; attempt++) {
    const db = await openDb();
    try {
      return db.transaction(stores, mode);
    } catch (err) {
      if (attempt > 0 || !isClosingError(err)) throw err;
      try {
        db.close();
      } catch {
        // already closing
      }
      dbPromise = null;
      currentDb = null;
    }
  }
};

const runRequest = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });

// A write is only durable once its transaction commits. Resolving on the
// request alone would report success for a transaction that is later aborted
// (e.g. QuotaExceededError while storing a large PDF).
const whenDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction was aborted."));
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed."));
  });

export const listBatches = async (): Promise<ScanPackBatch[]> => {
  const tx = await transaction(BATCH_STORE, "readonly");
  const batches = await runRequest<ScanPackBatch[]>(tx.objectStore(BATCH_STORE).getAll());
  return batches.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export const getBatch = async (id: string): Promise<ScanPackBatch | undefined> => {
  const tx = await transaction(BATCH_STORE, "readonly");
  return runRequest<ScanPackBatch | undefined>(tx.objectStore(BATCH_STORE).get(id));
};

export const saveBatch = async (batch: ScanPackBatch): Promise<void> => {
  const tx = await transaction(BATCH_STORE, "readwrite");
  const done = whenDone(tx);
  tx.objectStore(BATCH_STORE).put(batch);
  await done;
};

export const saveDocuments = async (documents: ScanPackDocument[]): Promise<void> => {
  if (!documents.length) return;
  const tx = await transaction(DOC_STORE, "readwrite");
  const done = whenDone(tx);
  const store = tx.objectStore(DOC_STORE);
  documents.forEach((doc) => store.put(doc));
  await done;
};

export const getDocument = async (id: string): Promise<ScanPackDocument | undefined> => {
  const tx = await transaction(DOC_STORE, "readonly");
  return runRequest<ScanPackDocument | undefined>(tx.objectStore(DOC_STORE).get(id));
};

export const deleteBatch = async (id: string): Promise<void> => {
  // The document keys are looked up in their own transaction first. An IndexedDB
  // transaction commits as soon as the event loop drains with no request
  // outstanding, so awaiting a read and *then* issuing writes on the same
  // transaction is the classic way to hit TransactionInactiveError.
  const lookup = await transaction(DOC_STORE, "readonly");
  const docIds = await runRequest<IDBValidKey[]>(
    lookup.objectStore(DOC_STORE).index("batchId").getAllKeys(IDBKeyRange.only(id))
  );

  const tx = await transaction([BATCH_STORE, DOC_STORE], "readwrite");
  const done = whenDone(tx);
  const docStore = tx.objectStore(DOC_STORE);
  // Every request is issued synchronously, so they all share one transaction:
  // the batch and its PDFs go away together or not at all.
  tx.objectStore(BATCH_STORE).delete(id);
  docIds.forEach((key) => docStore.delete(key));
  await done;
};
