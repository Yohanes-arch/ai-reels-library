import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js";
import { cleanUrl, extractLinks, mergeItems, normalizeItems } from "./library.js";

const REEL_HINTS = ["/reel/", "/p/", "/tv/"];

export async function parseImportFiles(fileList) {
  const files = Array.from(fileList || []);
  const documents = [];
  const errors = [];

  for (const file of files) {
    try {
      if (isZip(file)) {
        documents.push(...(await readZipJson(file)));
      } else if (isJson(file)) {
        documents.push(await readPlainJson(file));
      } else {
        errors.push(`${file.name}: unsupported file type`);
      }
    } catch (error) {
      errors.push(`${file.name}: ${error.message}`);
    }
  }

  const parsedItems = documents.flatMap((doc) => extractItems(doc.data, doc.path));
  const items = mergeItems([], normalizeItems(parsedItems));
  return {
    batch: {
      id: crypto.randomUUID(),
      fileNames: files.map((file) => file.name),
      importedAt: new Date().toISOString(),
      documentCount: documents.length,
      itemCount: items.length,
      errors,
      status: errors.length ? "partial" : "imported"
    },
    items
  };
}

export function extractItems(data, sourcePath = "import.json") {
  if (Array.isArray(data?.items)) return normalizeItems(data.items);
  if (Array.isArray(data)) return normalizeItems(data);

  const candidates = [];
  walk(data, {}, sourcePath, candidates);
  const seen = new Map();

  candidates.forEach(({ url, context, rawText }) => {
    const cleanedUrl = cleanUrl(url);
    if (!isUsefulUrl(cleanedUrl)) return;

    const relatedLinks = extractLinks(rawText).filter((link) => cleanUrl(link) !== cleanedUrl);
    const item = {
      id: cleanedUrl,
      url: cleanedUrl,
      sourceType: inferSourceType(sourcePath),
      sourceAccount: String(context.sender_name || context.sender || context.source_account || ""),
      sourcePath,
      savedAt: sourcePath.toLowerCase().includes("saved") ? inferDate(context) : null,
      sentAt: sourcePath.toLowerCase().includes("message") || sourcePath.toLowerCase().includes("inbox") ? inferDate(context) : null,
      collectionName: String(context.collection_name || context.title || ""),
      rawText: rawText.slice(0, 5000),
      caption: stripUrls(rawText).slice(0, 2500),
      title: inferTitle(context, rawText, cleanedUrl),
      relatedLinks
    };

    const old = seen.get(cleanedUrl);
    if (!old || (item.rawText || "").length > (old.rawText || "").length) {
      seen.set(cleanedUrl, item);
    }
  });

  return normalizeItems([...seen.values()]);
}

async function readZipJson(file) {
  const reader = new ZipReader(new BlobReader(file));
  const entries = await reader.getEntries();
  const docs = [];

  for (const entry of entries) {
    if (entry.directory || !entry.filename.toLowerCase().endsWith(".json")) continue;
    try {
      const text = await entry.getData(new TextWriter());
      docs.push({ path: entry.filename, data: JSON.parse(text) });
    } catch {
      // Skip malformed Instagram sidecar JSON entries.
    }
  }

  await reader.close();
  return docs;
}

async function readPlainJson(file) {
  return { path: file.name, data: JSON.parse(await file.text()) };
}

function walk(value, context, sourcePath, candidates) {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, context, sourcePath, candidates));
    return;
  }

  if (value && typeof value === "object") {
    const nextContext = { ...context };
    Object.entries(value).forEach(([key, child]) => {
      const normalizedKey = normalizeKey(key);
      if (["sender_name", "sender", "timestamp_ms", "timestamp", "saved_on", "saved_at", "title", "collection_name", "href", "value", "text", "content"].includes(normalizedKey)) {
        if (["string", "number"].includes(typeof child)) nextContext[normalizedKey] = child;
      }
    });

    const rawText = flattenText(value);
    extractLinks(rawText).forEach((url) => candidates.push({ url, context: nextContext, rawText }));
    Object.values(value).forEach((child) => walk(child, nextContext, sourcePath, candidates));
    return;
  }

  if (typeof value === "string") {
    extractLinks(value).forEach((url) => candidates.push({ url, context, rawText: value }));
  }
}

function flattenText(value) {
  const parts = [];
  const collect = (item) => {
    if (Array.isArray(item)) {
      item.forEach(collect);
      return;
    }
    if (item && typeof item === "object") {
      Object.entries(item).forEach(([key, child]) => {
        if (["content", "text", "title", "value", "href", "url", "link", "name"].includes(normalizeKey(key))) collect(child);
      });
      return;
    }
    if (["string", "number"].includes(typeof item)) {
      const text = String(item).trim();
      if (text) parts.push(text);
    }
  };
  collect(value);
  return parts.join(" ");
}

function inferTitle(context, rawText, url) {
  const contextTitle = String(context.title || context.collection_name || "").trim();
  if (contextTitle && !contextTitle.startsWith("http")) return contextTitle.split(/\s+/).slice(0, 8).join(" ");
  const caption = stripUrls(rawText).trim();
  if (caption) return caption.split(/\s+/).slice(0, 8).join(" ");
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").filter(Boolean).slice(0, 3).join(" / ") || parsed.hostname;
  } catch {
    return "Untitled Reel";
  }
}

function inferSourceType(sourcePath) {
  const lower = sourcePath.toLowerCase();
  if (lower.includes("message") || lower.includes("inbox")) return "instagram-dm";
  if (lower.includes("saved")) return "instagram-saved";
  return "instagram-export";
}

function inferDate(context) {
  const value = context.timestamp_ms || context.timestamp || context.saved_on || context.saved_at;
  if (!value) return null;
  if (context.timestamp_ms) {
    const date = new Date(Number(value));
    return Number.isNaN(date.valueOf()) ? null : date.toISOString();
  }
  return String(value);
}

function isUsefulUrl(url) {
  if (!url) return false;
  return url.includes("instagram.com") && REEL_HINTS.some((hint) => url.includes(hint));
}

function isZip(file) {
  return file.name.toLowerCase().endsWith(".zip") || file.type.includes("zip");
}

function isJson(file) {
  return file.name.toLowerCase().endsWith(".json") || file.type.includes("json");
}

function stripUrls(text) {
  return String(text || "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
}

function normalizeKey(key) {
  return key.trim().toLowerCase().replace(/\s+/g, "_");
}
