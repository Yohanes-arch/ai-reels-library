export const LEGACY_LOCAL_ITEMS_KEY = "reelmind.items";

export const categoryOrder = [
  "All",
  "Travel",
  "Relationships",
  "Finance",
  "Fitness",
  "Motivation",
  "Faith",
  "Comedy",
  "News",
  "Productivity",
  "Tech",
  "Cooking",
  "DIY & Crafts",
  "Marketing",
  "Style & Fashion",
  "Home",
  "Other",
  "Uncategorized"
];

export const sourceLabels = {
  "instagram-dm": "DM Inbox",
  "instagram-saved": "Saved Reel",
  "instagram-export": "Instagram Export",
  manual: "Manual"
};

const urlRegex = /https?:\/\/[^\s"'<>]+/gi;

export function normalizeItems(items) {
  return (Array.isArray(items) ? items : [])
    .map(normalizeItem)
    .filter((item) => item.url);
}

export function normalizeItem(item) {
  const url = cleanUrl(item.url || item.reel_url || item.source || "");
  const rawText = item.rawText || item.raw_text || item.message || item.caption || "";
  const caption = item.caption || item.rawText || item.raw_text || item.summary || "";
  const relatedLinks = normalizeRelatedLinks([
    ...(item.relatedLinks || []),
    ...(item.item_links || []),
    ...(item.extracted_links || []),
    ...extractLinks(rawText)
  ], url);
  const title = cleanText(item.title) || buildTitle(rawText, url);
  const category = normalizeCategory(item.category || inferCategory(`${title} ${rawText} ${relatedLinks.map((link) => link.url).join(" ")}`));
  const tags = unique([
    ...splitTags(item.tags),
    ...inferTags(`${title} ${rawText} ${category}`)
  ]).slice(0, 8);

  return {
    id: item.id || url || crypto.randomUUID(),
    url,
    title,
    category,
    sourceType: item.sourceType || item.source_type || "instagram-export",
    sourceAccount: item.sourceAccount || item.source_account || item.sender || "",
    sourcePath: item.sourcePath || item.source_path || "",
    savedAt: item.savedAt || item.saved_at || null,
    sentAt: item.sentAt || item.sent_at || null,
    importedAt: item.importedAt || new Date().toISOString(),
    collectionName: item.collectionName || item.collection_name || "",
    caption,
    rawText,
    summary: item.summary || "",
    steps: normalizeSteps(item.steps || item.tutorial),
    tags,
    status: item.status || (item.summary ? "ready" : "needs_review"),
    confidence: Number.isFinite(Number(item.confidence ?? item.priority_score)) ? Number(item.confidence ?? item.priority_score) : scorePriority(`${title} ${rawText} ${url}`),
    provider: item.provider || "",
    model: item.model || "",
    aiStatus: item.aiStatus || (item.summary ? "ready" : "pending"),
    aiWarning: item.aiWarning || "",
    usedVideo: Boolean(item.usedVideo),
    embedStatus: item.embedStatus || "unknown",
    duration: item.duration || "",
    thumbnailUrl: item.thumbnailUrl || item.thumbnail_url || "",
    relatedLinks
  };
}

export function makeManualItem(fields) {
  return normalizeItem({
    ...fields,
    sourceType: "manual",
    rawText: [fields.rawText, fields.caption, fields.summary, fields.tags].filter(Boolean).join(" "),
    importedAt: new Date().toISOString()
  });
}

export function mergeItems(existing, incoming) {
  const byUrl = new Map(normalizeItems(existing).map((item) => [item.url, item]));
  normalizeItems(incoming).forEach((item) => {
    const old = byUrl.get(item.url);
    if (!old) {
      byUrl.set(item.url, item);
      return;
    }
    byUrl.set(item.url, {
      ...old,
      ...item,
      title: item.title || old.title,
      summary: item.summary || old.summary,
      steps: item.steps?.length ? item.steps : old.steps,
      status: old.status === "reviewed" ? old.status : item.status || old.status,
      tags: unique([...old.tags, ...item.tags]),
      relatedLinks: mergeLinks(old.relatedLinks, item.relatedLinks),
      thumbnailUrl: item.thumbnailUrl || old.thumbnailUrl,
      confidence: Math.max(old.confidence || 0, item.confidence || 0)
    });
  });
  return [...byUrl.values()].sort(sortNewest);
}

export function filterItems(items, filters) {
  const query = cleanText(filters.search).toLowerCase();
  return items
    .filter((item) => {
      if (filters.category && filters.category !== "All" && item.category !== filters.category) return false;
      if (filters.source === "saved" && item.sourceType !== "instagram-saved") return false;
      if (filters.source === "dm" && item.sourceType !== "instagram-dm") return false;
      if (filters.source === "review" && item.status !== "needs_review") return false;
      if (!query) return true;
      return searchableText(item).includes(query);
    })
    .sort(filters.sort === "confidence" ? sortConfidence : sortNewest);
}

export function getStats(items) {
  return {
    total: items.length,
    saved: items.filter((item) => item.sourceType === "instagram-saved").length,
    dm: items.filter((item) => item.sourceType === "instagram-dm").length,
    analyzing: items.filter((item) => item.aiStatus === "analyzing").length,
    needsReview: items.filter((item) => item.status === "needs_review").length,
    ready: items.filter((item) => item.aiStatus === "ready").length
  };
}

export function getCategoryCounts(items) {
  const counts = new Map();
  items.forEach((item) => counts.set(item.category, (counts.get(item.category) || 0) + 1));
  return categoryOrder
    .filter((category) => category !== "Uncategorized")
    .map((category) => ({ category, count: category === "All" ? items.length : counts.get(category) || 0 }))
    .filter((entry) => entry.category === "All" || entry.count > 0);
}

export function groupShelves(items) {
  const shelves = [];
  const latest = [...items].sort(sortNewest).slice(0, 12);
  const needsReview = items.filter((item) => item.status === "needs_review").slice(0, 12);
  const highConfidence = items.filter((item) => item.confidence >= 75).slice(0, 12);
  if (latest.length) shelves.push({ id: "latest", title: "Latest Imports", items: latest });
  if (needsReview.length) shelves.push({ id: "review", title: "Needs Review", items: needsReview });
  if (highConfidence.length) shelves.push({ id: "confidence", title: "High Confidence", items: highConfidence });
  categoryOrder
    .filter((category) => !["All", "Uncategorized"].includes(category))
    .forEach((category) => {
      const categoryItems = items.filter((item) => item.category === category).slice(0, 12);
      if (categoryItems.length) shelves.push({ id: category, title: category, items: categoryItems });
    });
  return shelves.slice(0, 8);
}

export function exportJson(items) {
  const payload = {
    generated_at: new Date().toISOString(),
    version: 2,
    count: items.length,
    items
  };
  downloadText("ai-reels-library-backup.json", JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
}

export function exportMarkdown(items) {
  const markdown = [
    "# AI Reels Library Export",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    ...items.map(itemToMarkdown)
  ].join("\n");
  downloadText("ai-reels-library.md", markdown, "text/markdown;charset=utf-8");
}

export function readLegacyLocalItems() {
  try {
    const stored = localStorage.getItem(LEGACY_LOCAL_ITEMS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return normalizeItems(Array.isArray(parsed) ? parsed : parsed.items || []);
  } catch {
    return [];
  }
}

export function sourceLabel(item) {
  return sourceLabels[item.sourceType] || item.sourceType || "Unknown";
}

export function searchableText(item) {
  return [
    item.url,
    item.title,
    item.category,
    item.caption,
    item.rawText,
    item.summary,
    item.steps.map((step) => step.text).join(" "),
    item.tags.join(" "),
    item.relatedLinks.map((link) => link.url).join(" ")
  ].join(" ").toLowerCase();
}

export function extractLinks(text) {
  return String(text || "")
    .match(urlRegex)
    ?.map((url) => cleanUrl(url.replace(/[),.;]+$/g, ""))) || [];
}

export function cleanUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(String(url).trim());
    parsed.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "igsh", "igshid"].forEach((key) => parsed.searchParams.delete(key));
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return String(url).trim();
  }
}

export function cleanTitleFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").filter(Boolean).slice(0, 3).join(" / ") || parsed.hostname;
  } catch {
    return "Untitled Reel";
  }
}

export function splitTags(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  return String(value || "").split(",").map(cleanText).filter(Boolean);
}

export function formatDate(value) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return String(value).slice(0, 16);
  return date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatShortDate(value) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return String(value).slice(0, 10);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function normalizeRelatedLinks(values, sourceUrl) {
  return unique(values.map((value) => (typeof value === "string" ? value : value?.url)).map(cleanUrl).filter(Boolean))
    .filter((url) => url !== sourceUrl)
    .map((url) => {
      const host = safeHost(url);
      return {
        url,
        host,
        label: host || url,
        type: host.includes("github.com") ? "github" : host.includes("instagram.com") ? "instagram" : host.includes("tradingview.com") ? "trading" : "link"
      };
    });
}

function normalizeSteps(value) {
  if (Array.isArray(value)) {
    return value.map((step) => (typeof step === "string" ? { text: step } : { text: cleanText(step?.text || step?.title) })).filter((step) => step.text);
  }
  if (typeof value === "string" && value.trim()) return [{ text: value.trim() }];
  return [];
}

function inferCategory(text) {
  const haystack = text.toLowerCase();
  const rules = [
    ["Fitness", ["workout", "gym", "fitness", "abs", "cardio", "stretch", "hiit"]],
    ["Finance", ["money", "finance", "trading", "stock", "invest", "budget"]],
    ["Travel", ["travel", "hidden gem", "flight", "hotel", "beach", "mountain"]],
    ["Relationships", ["relationship", "boundary", "boundaries", "dating", "friend"]],
    ["Faith", ["god", "faith", "bible", "pray", "timing"]],
    ["Comedy", ["funny", "comedy", "joke", "meme"]],
    ["News", ["news", "bill", "policy", "election", "government"]],
    ["Productivity", ["productivity", "routine", "focus", "deep work", "desk setup"]],
    ["Tech", ["ai", "mcp", "github", "repo", "codex", "cursor", "automation"]],
    ["Cooking", ["recipe", "cook", "pasta", "meal", "protein", "dinner"]],
    ["DIY & Crafts", ["diy", "craft", "makeover", "decor"]],
    ["Marketing", ["marketing", "brand", "ads", "content"]],
    ["Style & Fashion", ["style", "fashion", "outfit"]],
    ["Home", ["home", "interior", "room", "kitchen"]]
  ];
  return rules.find(([, words]) => words.some((word) => haystack.includes(word)))?.[0] || "Other";
}

function inferTags(text) {
  const haystack = text.toLowerCase();
  const candidates = ["ai", "mcp", "github", "recipe", "workout", "travel", "money", "routine", "howto", "tips", "saved"];
  return candidates.filter((tag) => haystack.includes(tag));
}

function scorePriority(text) {
  const haystack = text.toLowerCase();
  const weights = [
    ["mcp", 25],
    ["github", 22],
    ["trading", 20],
    ["recipe", 15],
    ["how to", 15],
    ["step", 12],
    ["tips", 10]
  ];
  return Math.min(100, weights.reduce((total, [word, score]) => total + (haystack.includes(word) ? score : 0), 55));
}

function normalizeCategory(category) {
  return categoryOrder.includes(category) ? category : "Other";
}

function buildTitle(text, url) {
  const cleaned = String(text || "").replace(urlRegex, "").replace(/\s+/g, " ").trim();
  if (cleaned) return cleaned.split(/\s+/).slice(0, 7).join(" ");
  return cleanTitleFromUrl(url);
}

function mergeLinks(a = [], b = []) {
  const byUrl = new Map([...a, ...b].map((link) => [link.url, link]));
  return [...byUrl.values()];
}

function itemToMarkdown(item) {
  const links = item.relatedLinks.map((link) => `- ${link.url}`).join("\n") || "- None";
  const steps = item.steps.map((step, index) => `${index + 1}. ${step.text}`).join("\n") || "No steps yet.";
  return `## ${item.title}

- Category: ${item.category}
- Source: ${sourceLabel(item)}
- Status: ${item.status}
- Confidence: ${item.confidence}%
- URL: ${item.url}

### AI Summary

${item.summary || "No summary yet."}

### Steps

${steps}

### Caption

${item.caption || item.rawText || "No caption captured."}

### Related Links

${links}
`;
}

function downloadText(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function sortNewest(a, b) {
  return String(b.savedAt || b.sentAt || b.importedAt || "").localeCompare(String(a.savedAt || a.sentAt || a.importedAt || ""));
}

function sortConfidence(a, b) {
  return (b.confidence || 0) - (a.confidence || 0) || sortNewest(a, b);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function cleanText(value) {
  return String(value || "").trim();
}

function safeHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
