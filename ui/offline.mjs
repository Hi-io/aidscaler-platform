const db = () =>
  new Promise((resolve, reject) => {
    const r = indexedDB.open("nexo-field-v1", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("queue", { keyPath: "clientId" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
export async function offlineQueue(operation, value) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction("queue", "readwrite"),
      s = tx.objectStore("queue");
    let r;
    if (operation === "put") r = s.put(value);
    if (operation === "all") r = s.getAll();
    if (operation === "delete") r = s.delete(value);
    if (operation === "clear") r = s.clear();
    let result;
    r.onsuccess = () => (result = r.result);
    tx.oncomplete = () => {
      d.close();
      resolve(result);
    };
    tx.onerror = () => reject(tx.error);
  });
}
