const DB_NAME = "nexus-director-media";
const STORE_NAME = "videos";
const LATEST_KEY = "nexus_video_latest";
const META_KEY = "nexus_video_meta";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function storeVideoBlob(file: File, durationSecs: number): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(file, LATEST_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  localStorage.setItem(META_KEY, JSON.stringify({ name: file.name, durationSecs, type: file.type }));
}

export async function getVideoObjectUrl(): Promise<string | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(LATEST_KEY);
      req.onsuccess = () => {
        const blob = req.result as Blob | undefined;
        resolve(blob ? URL.createObjectURL(blob) : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export function getVideoMeta(): { name: string; durationSecs: number; type: string } | null {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? (JSON.parse(raw) as { name: string; durationSecs: number; type: string }) : null;
  } catch {
    return null;
  }
}
