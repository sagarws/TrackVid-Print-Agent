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
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the Scan & Pack database."));
  });
  // A failed open must not be cached, otherwise every later call rejects with
  // the same stale error and the module never recovers.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
};

const runRequest = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });

export const listBatches = async (): Promise<ScanPackBatch[]> => {
  const db = await openDb();
  const tx = db.transaction(BATCH_STORE, "readonly");
  const batches = await runRequest<ScanPackBatch[]>(tx.objectStore(BATCH_STORE).getAll());
  return batches.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export const getBatch = async (id: string): Promise<ScanPackBatch | undefined> => {
  const db = await openDb();
  const tx = db.transaction(BATCH_STORE, "readonly");
  return runRequest<ScanPackBatch | undefined>(tx.objectStore(BATCH_STORE).get(id));
};

export const saveBatch = async (batch: ScanPackBatch): Promise<void> => {
  const db = await openDb();
  const tx = db.transaction(BATCH_STORE, "readwrite");
  await runRequest(tx.objectStore(BATCH_STORE).put(batch));
};

export const saveDocuments = async (documents: ScanPackDocument[]): Promise<void> => {
  if (!documents.length) return;
  const db = await openDb();
  const tx = db.transaction(DOC_STORE, "readwrite");
  const store = tx.objectStore(DOC_STORE);
  await Promise.all(documents.map((doc) => runRequest(store.put(doc))));
};

export const getDocument = async (id: string): Promise<ScanPackDocument | undefined> => {
  const db = await openDb();
  const tx = db.transaction(DOC_STORE, "readonly");
  return runRequest<ScanPackDocument | undefined>(tx.objectStore(DOC_STORE).get(id));
};

export const deleteBatch = async (id: string): Promise<void> => {
  const db = await openDb();

  // The document keys are looked up in their own transaction first. An IndexedDB
  // transaction commits as soon as the event loop drains with no request
  // outstanding, so awaiting a read and *then* issuing writes on the same
  // transaction is the classic way to hit TransactionInactiveError.
  const lookup = db.transaction(DOC_STORE, "readonly");
  const docIds = await runRequest<IDBValidKey[]>(
    lookup.objectStore(DOC_STORE).index("batchId").getAllKeys(IDBKeyRange.only(id))
  );

  const tx = db.transaction([BATCH_STORE, DOC_STORE], "readwrite");
  const docStore = tx.objectStore(DOC_STORE);
  // Every request is issued synchronously, so they all share one transaction:
  // the batch and its PDFs go away together or not at all.
  const pending = [
    runRequest(tx.objectStore(BATCH_STORE).delete(id)),
    ...docIds.map((key) => runRequest(docStore.delete(key))),
  ];
  await Promise.all(pending);
};
