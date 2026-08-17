const DB_NAME = 'pakanime-downloads';
const STORE_NAME = 'items';

function openDownloadsDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function downloadKey(username, animeId) {
  return `${username}::${animeId}`;
}

async function saveDownload(username, anime, blob) {
  const db = await openDownloadsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({
      key: downloadKey(username, anime.id),
      username,
      animeId: anime.id,
      title: anime.title,
      genre: anime.genre,
      posterPath: anime.poster_path,
      size: blob.size,
      downloadedAt: Date.now(),
      blob,
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getDownload(username, animeId) {
  const db = await openDownloadsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(downloadKey(username, animeId));
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function listDownloads(username) {
  const db = await openDownloadsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      resolve(all.filter((item) => item.username === username).sort((a, b) => b.downloadedAt - a.downloadedAt));
    };
    req.onerror = () => reject(req.error);
  });
}

async function removeDownload(username, animeId) {
  const db = await openDownloadsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(downloadKey(username, animeId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Fetches the video, reports progress, and hands back a Blob once complete.
async function fetchVideoWithProgress(url, onProgress) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('download_failed');

  const total = Number(res.headers.get('Content-Length')) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total && onProgress) onProgress(received / total);
  }

  return new Blob(chunks, { type: res.headers.get('Content-Type') || 'video/mp4' });
}
