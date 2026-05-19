export type StoredCertificate = {
  id: string;
  fileName: string;
  bytes: Uint8Array;
  importedAt: string;
};

const DB_NAME = "digital-sign-vault";
const DB_VERSION = 1;
const STORE_NAME = "certificates";
const ACTIVE_KEY = "active";

function openVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open certificate vault."));
  });
}

export async function saveCertificate(file: File): Promise<StoredCertificate> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const record: StoredCertificate = {
    id: ACTIVE_KEY,
    fileName: file.name,
    bytes,
    importedAt: new Date().toISOString()
  };

  const db = await openVault();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record, ACTIVE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to store certificate."));
  });
  db.close();

  return record;
}

export async function loadCertificate(): Promise<StoredCertificate | null> {
  const db = await openVault();
  const record = await new Promise<StoredCertificate | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(ACTIVE_KEY);
    request.onsuccess = () => resolve((request.result as StoredCertificate | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Failed to read certificate."));
  });
  db.close();
  return record;
}

export async function removeCertificate(): Promise<void> {
  const db = await openVault();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(ACTIVE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to remove certificate."));
  });
  db.close();
}
