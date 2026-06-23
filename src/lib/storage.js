import { openDB } from "idb";

const DB_NAME = "ai-reels-library";
const DB_VERSION = 1;
const ITEMS_KEY = "ai-reels-library.items";
const BATCHES_KEY = "ai-reels-library.batches";
let dbPromise;

async function getDb() {
  if (!hasIndexedDb()) return null;
  dbPromise ||= withTimeout(openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("items")) {
        const store = db.createObjectStore("items", { keyPath: "id" });
        store.createIndex("url", "url", { unique: true });
        store.createIndex("category", "category");
        store.createIndex("sourceType", "sourceType");
      }
      if (!db.objectStoreNames.contains("batches")) {
        db.createObjectStore("batches", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta");
      }
    }
  }), 1200).catch(() => null);
  return dbPromise;
}

export async function readItems() {
  const db = await getDb();
  if (!db) return readLocalArray(ITEMS_KEY);
  return db.getAll("items");
}

export async function putItems(items) {
  const db = await getDb();
  if (!db) {
    const byId = new Map(readLocalArray(ITEMS_KEY).map((item) => [item.id, item]));
    items.forEach((item) => byId.set(item.id, item));
    writeLocalArray(ITEMS_KEY, [...byId.values()]);
    return;
  }
  const tx = db.transaction("items", "readwrite");
  await Promise.all(items.map((item) => tx.store.put(item)));
  await tx.done;
}

export async function replaceItems(items) {
  const db = await getDb();
  if (!db) {
    writeLocalArray(ITEMS_KEY, items);
    return;
  }
  const tx = db.transaction("items", "readwrite");
  await tx.store.clear();
  await Promise.all(items.map((item) => tx.store.put(item)));
  await tx.done;
}

export async function updateItem(item) {
  const db = await getDb();
  if (!db) {
    const items = readLocalArray(ITEMS_KEY).map((entry) => (entry.id === item.id ? item : entry));
    if (!items.some((entry) => entry.id === item.id)) items.push(item);
    writeLocalArray(ITEMS_KEY, items);
    return;
  }
  await db.put("items", item);
}

export async function readBatches() {
  const db = await getDb();
  if (!db) return readLocalArray(BATCHES_KEY);
  return db.getAll("batches");
}

export async function addBatch(batch) {
  const db = await getDb();
  if (!db) {
    writeLocalArray(BATCHES_KEY, [batch, ...readLocalArray(BATCHES_KEY)]);
    return;
  }
  await db.put("batches", batch);
}

export async function clearLibrary() {
  const db = await getDb();
  if (!db) {
    localStorage.removeItem(ITEMS_KEY);
    localStorage.removeItem(BATCHES_KEY);
    return;
  }
  const tx = db.transaction(["items", "batches"], "readwrite");
  await tx.objectStore("items").clear();
  await tx.objectStore("batches").clear();
  await tx.done;
}

function hasIndexedDb() {
  return typeof indexedDB !== "undefined";
}

function readLocalArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalArray(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => window.setTimeout(() => resolve(null), ms))
  ]);
}
