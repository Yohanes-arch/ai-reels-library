export const LOCAL_ITEMS_KEY = "reelmind.items";

export const navItems = [
  { id: "dashboard", label: "Dashboard" },
  { id: "all", label: "All Reels" },
  { id: "mcp", label: "MCP Leads" },
  { id: "github", label: "GitHub Repos" },
  { id: "unprocessed", label: "Unprocessed" }
];

export const categoryOrder = [
  "All",
  "MCP",
  "Trading",
  "GitHub",
  "AI Agents",
  "Coding Tools",
  "Automation",
  "Video AI",
  "Uncategorized"
];

const urlRegex = /https?:\/\/[^\s"'<>]+/gi;

export function readLocalItems() {
  const stored = localStorage.getItem(LOCAL_ITEMS_KEY);
  return stored === null ? null : safeJson(stored, []);
}

export function persistLocalItems(items) {
  localStorage.setItem(LOCAL_ITEMS_KEY, JSON.stringify(items));
}

export function normalizeItems(items) {
  return items
    .map((item) => {
      const url = cleanUrl(item.url || item.reel_url || "");
      const rawText = item.raw_text || item.message || item.caption || "";
      const incomingLinks = [
        ...extractLinks(rawText),
        ...(item.extracted_links || []),
        ...((item.item_links || []).map((link) => link.url || link))
      ];
      const itemLinks = [...new Set(incomingLinks.map(cleanUrl).filter(Boolean))]
        .filter((link) => link !== url)
        .map(urlToLink);
      const title = item.title || buildTitle(item, rawText, url);
      const category = item.category || inferCategory(`${title} ${rawText} ${itemLinks.map((link) => link.url).join(" ")}`);
      const tags = item.tags || inferTags(`${title} ${rawText} ${category}`);
      const priorityScore = Number.isFinite(Number(item.priority_score))
        ? Number(item.priority_score)
        : scorePriority(`${title} ${rawText} ${url} ${itemLinks.map((link) => link.url).join(" ")}`);

      return {
        id: item.id || url || crypto.randomUUID(),
        url,
        source_type: item.source_type || "instagram-export",
        source_account: item.source_account || "",
        source_path: item.source_path || "",
        saved_at: item.saved_at || null,
        sent_at: item.sent_at || null,
        collection_name: item.collection_name || "",
        raw_text: rawText,
        title,
        category,
        summary: item.summary || "",
        tutorial: item.tutorial || "",
        tags,
        priority_score: priorityScore,
        status: item.status || (priorityScore >= 75 ? "lead" : "unprocessed"),
        item_links: itemLinks
      };
    })
    .filter((item) => item.url);
}

export function makeManualItem(fields) {
  const rawText = [
    fields.raw_text,
    fields.summary,
    fields.tutorial,
    fields.tags
  ].filter(Boolean).join(" ");

  return normalizeItems([
    {
      url: fields.url,
      source_type: "manual",
      raw_text: rawText,
      title: fields.title,
      category: fields.category,
      summary: fields.summary,
      tutorial: fields.tutorial,
      tags: splitTags(fields.tags),
      status: fields.status || "unprocessed",
      saved_at: new Date().toISOString()
    }
  ])[0];
}

export function splitTags(value) {
  if (Array.isArray(value)) return value.map(String).map((tag) => tag.trim()).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function mergeItems(existing, incoming) {
  const byUrl = new Map(existing.map((item) => [item.url, item]));
  incoming.forEach((item) => {
    const old = byUrl.get(item.url);
    byUrl.set(item.url, old ? { ...old, ...item, item_links: mergeLinks(old.item_links, item.item_links) } : item);
  });
  return [...byUrl.values()];
}

export function getViewCounts(items) {
  return {
    dashboard: items.length,
    all: items.length,
    mcp: items.filter(isMcpLead).length,
    github: items.filter((item) => item.item_links.some((link) => link.link_type === "github")).length,
    unprocessed: items.filter((item) => item.status === "unprocessed").length
  };
}

export function filterItems(items, view, category, search) {
  const query = search.toLowerCase();
  return items
    .filter((item) => {
      if (view === "mcp" && !isMcpLead(item)) return false;
      if (view === "github" && !item.item_links.some((link) => link.link_type === "github")) return false;
      if (view === "unprocessed" && item.status !== "unprocessed") return false;
      if (category !== "All" && item.category !== category) return false;
      if (!query) return true;
      return searchableText(item).includes(query);
    })
    .toSorted((a, b) => b.priority_score - a.priority_score || String(b.saved_at || "").localeCompare(String(a.saved_at || "")));
}

export function getViewCopy(view, count) {
  const titles = {
    dashboard: "Dashboard",
    all: "All Reels",
    mcp: "MCP Leads",
    github: "GitHub Repos",
    unprocessed: "Unprocessed"
  };
  const subtitles = {
    dashboard: "Overview of saved AI knowledge and high-priority leads.",
    all: "Every saved or DM-shared reel currently in the library.",
    mcp: "Likely TradingView, MCP, GitHub, and automation leads from saved reels.",
    github: "Items with extracted GitHub links or repository clues.",
    unprocessed: "Items that still need summary, category cleanup, or manual review."
  };

  return {
    title: `${titles[view]} (${count})`,
    subtitle: subtitles[view]
  };
}

export function isMcpLead(item) {
  return item.category === "MCP" || item.priority_score >= 60 || searchableText(item).includes("mcp");
}

export function searchableText(item) {
  return [
    item.url,
    item.title,
    item.category,
    item.summary,
    item.tutorial,
    item.raw_text,
    item.collection_name,
    item.tags.join(" "),
    item.item_links.map((link) => link.url).join(" ")
  ]
    .join(" ")
    .toLowerCase();
}

export function extractLinks(text) {
  if (!text) return [];
  return String(text)
    .match(urlRegex)
    ?.map((url) => cleanUrl(url.replace(/[),.;]+$/g, ""))) || [];
}

export function urlToLink(url) {
  const host = safeHost(url);
  return {
    url,
    host,
    link_type: host.includes("github.com") ? "github" : host.includes("tradingview.com") ? "trading" : "tool",
    label: host
  };
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
  if (!url) return "Untitled reel";
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    return parts.length ? parts.join(" / ") : parsed.hostname;
  } catch {
    return "Untitled reel";
  }
}

export function buildDefaultTutorial(item) {
  if (item.category === "MCP" || item.priority_score >= 75) {
    return "Open the reel, confirm the exact tool or repo name, capture install commands, then test whether it exposes a usable MCP endpoint.";
  }
  return "Open the source, capture the tool name, summarize the workflow, and add any setup links to this item.";
}

export function exportMarkdown(items) {
  const markdown = [
    "# ReelMind Library Export",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    ...items.map(itemToMarkdown)
  ].join("\n");
  downloadText("reelmind-export.md", markdown, "text/markdown;charset=utf-8");
}

export function exportJson(items) {
  const payload = {
    generated_at: new Date().toISOString(),
    storage: "local-browser",
    count: items.length,
    items
  };
  downloadText("reelmind-library-backup.json", JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
}

export function formatDate(value) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return String(value).slice(0, 10);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function mergeLinks(a = [], b = []) {
  const byUrl = new Map([...a, ...b].map((link) => [link.url, link]));
  return [...byUrl.values()];
}

function safeHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function buildTitle(item, rawText, url) {
  const source = item.collection_name || rawText || cleanTitleFromUrl(url);
  return source.split(/\s+/).slice(0, 10).join(" ").replace(/\s+/g, " ").trim() || cleanTitleFromUrl(url);
}

function inferCategory(text) {
  const haystack = text.toLowerCase();
  if (haystack.includes("mcp") || haystack.includes("model context protocol")) return "MCP";
  if (haystack.includes("tradingview") || haystack.includes("idx") || haystack.includes("indicator") || haystack.includes("scanner")) return "Trading";
  if (haystack.includes("github.com") || haystack.includes("repo")) return "GitHub";
  if (haystack.includes("agent") || haystack.includes("autonomous")) return "AI Agents";
  if (haystack.includes("cursor") || haystack.includes("codex") || haystack.includes("cline") || haystack.includes("coding")) return "Coding Tools";
  if (haystack.includes("n8n") || haystack.includes("zapier") || haystack.includes("automation")) return "Automation";
  if (haystack.includes("video") || haystack.includes("reel") || haystack.includes("runway")) return "Video AI";
  return "Uncategorized";
}

function inferTags(text) {
  const haystack = text.toLowerCase();
  const candidates = ["mcp", "tradingview", "github", "idx", "agent", "automation", "coding", "video", "scanner", "indicator"];
  return candidates.filter((candidate) => haystack.includes(candidate));
}

function scorePriority(text) {
  const haystack = text.toLowerCase();
  const weights = [
    ["tradingview", 35],
    ["mcp", 35],
    ["model context protocol", 35],
    ["github.com", 18],
    ["scanner", 10],
    ["indicator", 10],
    ["technical recommendation", 12],
    ["idx", 12],
    ["pine", 8],
    ["trading", 8]
  ];
  return Math.min(100, weights.reduce((total, [keyword, value]) => total + (haystack.includes(keyword) ? value : 0), 0));
}

function itemToMarkdown(item) {
  const links = item.item_links.map((link) => `- ${link.url}`).join("\n") || "- None";
  const tags = item.tags.join(", ") || "None";
  return `## ${item.title || cleanTitleFromUrl(item.url)}

- Category: ${item.category}
- Priority score: ${item.priority_score}
- Status: ${item.status}
- Tags: ${tags}
- Source: ${item.url}

### Summary

${item.summary || "No summary yet."}

### Tutorial Notes

${item.tutorial || buildDefaultTutorial(item)}

### Extracted Links

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

function safeJson(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}
