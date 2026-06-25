import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js";
import { cleanUrl, extractLinks, mergeItems, normalizeItems } from "./library.js";

const REEL_HINTS = ["/reel/", "/p/", "/tv/"];
const SAVED_HINT = /(^|[\\/])(saved|saved_posts|saved_items|saved_collections)([\\/_.]|$)/i;
const MESSAGE_HINT = /(^|[\\/])messages([\\/_.]|$)|[\\/]inbox[\\/]/i;

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
  const groups = buildImportGroups(items);

  return {
    batch: {
      id: crypto.randomUUID(),
      fileNames: files.map((file) => file.name),
      importedAt: new Date().toISOString(),
      documentCount: documents.length,
      itemCount: items.length,
      savedCount: groups.saved.count,
      messageThreads: groups.messages.map(({ account, count }) => ({ account, count })),
      errors,
      status: errors.length ? "partial" : "imported"
    },
    groups,
    items
  };
}

export function extractItems(data, sourcePath = "import.json") {
  if (Array.isArray(data?.items)) {
    const normalized = normalizeItems(data.items);
    if (normalized.length) return normalized;
  }
  if (Array.isArray(data)) {
    const normalized = normalizeItems(data);
    if (normalized.length) return normalized;
  }

  const sourceType = inferSourceType(sourcePath, data);
  const candidates = [];

  if (sourceType === "instagram-saved") {
    extractSavedCandidates(data, sourcePath).forEach((candidate) => candidates.push(candidate));
  } else if (sourceType === "instagram-dm") {
    extractMessageCandidates(data, sourcePath).forEach((candidate) => candidates.push(candidate));
  }

  walk(data, {}, sourcePath, candidates);
  const seen = new Map();

  candidates.forEach(({ url, context, rawText }) => {
    const cleanedUrl = cleanUrl(url);
    if (!isUsefulUrl(cleanedUrl)) return;

    const type = inferSourceType(sourcePath, data);
    const relatedLinks = extractLinks(rawText).filter((link) => cleanUrl(link) !== cleanedUrl);
    const item = {
      id: cleanedUrl,
      url: cleanedUrl,
      sourceType: type,
      sourceAccount: type === "instagram-dm" ? inferConversationName(data, sourcePath, context) : "",
      sourcePath,
      savedAt: type === "instagram-saved" ? inferDate(context) : null,
      sentAt: type === "instagram-dm" ? inferDate(context) : null,
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

export function buildImportGroups(items) {
  const savedItems = items.filter((item) => item.sourceType === "instagram-saved");
  const otherItems = items.filter((item) => item.sourceType !== "instagram-saved" && item.sourceType !== "instagram-dm");
  const messages = new Map();

  items.filter((item) => item.sourceType === "instagram-dm").forEach((item) => {
    const account = item.sourceAccount || "Unknown conversation";
    messages.set(account, [...(messages.get(account) || []), item.id]);
  });

  return {
    saved: {
      id: "saved",
      label: "Saved reels",
      count: savedItems.length,
      itemIds: savedItems.map((item) => item.id)
    },
    other: {
      id: "other",
      label: "Other export reels",
      count: otherItems.length,
      itemIds: otherItems.map((item) => item.id)
    },
    messages: [...messages.entries()]
      .map(([account, itemIds]) => ({ id: account, account, count: itemIds.length, itemIds }))
      .sort((a, b) => b.count - a.count || a.account.localeCompare(b.account))
  };
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

function extractSavedCandidates(data, sourcePath) {
  return findSavedEntries(data).flatMap((entry) => {
    const rawText = flattenText(entry);
    const context = collectContext(entry);
    return extractLinks(rawText).map((url) => ({ url, context, rawText, sourcePath }));
  });
}

function extractMessageCandidates(data, sourcePath) {
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  return messages.flatMap((message) => {
    const rawText = flattenText(message);
    const messageContext = collectContext(message);
    const context = { ...messageContext, source_account: inferConversationName(data, sourcePath, messageContext) };
    return extractLinks(rawText).map((url) => ({ url, context, rawText, sourcePath }));
  });
}

function findSavedEntries(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(findSavedEntries);
  if (typeof value !== "object") return [];
  if (value.string_map_data || value.media || value.title) return [value];
  return Object.values(value).flatMap(findSavedEntries);
}

function walk(value, context, sourcePath, candidates) {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, context, sourcePath, candidates));
    return;
  }

  if (value && typeof value === "object") {
    const nextContext = { ...context, ...collectContext(value) };
    const rawText = flattenText(value);
    extractLinks(rawText).forEach((url) => candidates.push({ url, context: nextContext, rawText }));
    Object.values(value).forEach((child) => walk(child, nextContext, sourcePath, candidates));
    return;
  }

  if (typeof value === "string") {
    extractLinks(value).forEach((url) => candidates.push({ url, context, rawText: value }));
  }
}

function collectContext(value) {
  const context = {};
  if (!value || typeof value !== "object") return context;

  Object.entries(value).forEach(([key, child]) => {
    const normalizedKey = normalizeKey(key);
    if (["sender_name", "sender", "timestamp_ms", "timestamp", "saved_on", "saved_at", "title", "collection_name", "href", "value", "text", "content"].includes(normalizedKey)) {
      if (["string", "number"].includes(typeof child)) context[normalizedKey] = child;
    }
  });

  const savedOn = value.string_map_data?.["Saved on"]?.timestamp;
  if (savedOn) context.saved_on = savedOn;
  return context;
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
        if (["content", "text", "title", "value", "href", "url", "link", "name", "share_text", "original_content_owner", "string_map_data"].includes(normalizeKey(key))) collect(child);
      });
      return;
    }
    if (["string", "number"].includes(typeof item)) {
      const text = String(item).trim();
      if (text) parts.push(text);
    }
  };
  collect(value);
  return [...new Set(parts)].join(" ");
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

function inferSourceType(sourcePath, data) {
  const lower = sourcePath.toLowerCase();
  if (MESSAGE_HINT.test(lower) || Array.isArray(data?.messages)) return "instagram-dm";
  if (SAVED_HINT.test(lower) || data?.saved_saved_media || data?.saved_posts) return "instagram-saved";
  return "instagram-export";
}

function inferConversationName(data, sourcePath, context = {}) {
  if (context.source_account) return String(context.source_account);
  const participants = data?.participants?.map((participant) => participant.name).filter(Boolean);
  if (participants?.length) return participants.join(", ");
  if (context.sender_name || context.sender) return String(context.sender_name || context.sender);
  const parts = sourcePath.split(/[\\/]/).filter(Boolean);
  const inboxIndex = parts.findIndex((part) => part.toLowerCase() === "inbox");
  if (inboxIndex >= 0 && parts[inboxIndex + 1]) return parts[inboxIndex + 1].replace(/_\d+$/, "").replace(/_/g, " ");
  return "Unknown conversation";
}

function inferDate(context) {
  const value = context.timestamp_ms || context.timestamp || context.saved_on || context.saved_at;
  if (!value) return null;
  const number = Number(value);
  if (Number.isFinite(number)) {
    const date = new Date(number > 10_000_000_000 ? number : number * 1000);
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
