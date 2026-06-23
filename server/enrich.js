const CATEGORY_RULES = [
  ["Fitness", ["workout", "gym", "fitness", "abs", "cardio", "stretch", "hiit", "push day"]],
  ["Finance", ["money", "finance", "trading", "stock", "invest", "budget", "wealth", "cash"]],
  ["Travel", ["travel", "hidden gem", "flight", "hotel", "beach", "mountain", "trip"]],
  ["Relationships", ["relationship", "boundary", "boundaries", "dating", "friend", "family"]],
  ["Faith", ["god", "faith", "bible", "pray", "timing", "church"]],
  ["Comedy", ["funny", "comedy", "joke", "laugh", "meme"]],
  ["News", ["news", "bill", "policy", "election", "government", "breaking"]],
  ["Productivity", ["productivity", "routine", "focus", "deep work", "desk", "setup"]],
  ["Tech", ["ai", "mcp", "github", "repo", "codex", "cursor", "automation", "tool"]],
  ["Cooking", ["recipe", "cook", "pasta", "meal", "protein", "dinner", "air fryer"]],
  ["DIY & Crafts", ["diy", "craft", "makeover", "build", "decor"]],
  ["Marketing", ["marketing", "brand", "ads", "content", "creator"]],
  ["Style & Fashion", ["style", "fashion", "outfit", "wardrobe"]],
  ["Home", ["home", "interior", "room", "kitchen", "garden"]]
];

export function localEnrich(item) {
  const text = [
    item.title,
    item.caption,
    item.rawText,
    item.raw_text,
    item.url,
    (item.tags || []).join(" ")
  ].filter(Boolean).join(" ");
  const lower = text.toLowerCase();
  const category = inferCategory(lower);
  const title = item.title && item.title !== "Untitled Reel" ? item.title : inferTitle(text, item.url);
  const tags = inferTags(lower, category);
  const steps = inferSteps(text, category);
  const summary = inferSummary(text, category, title);

  return {
    title,
    category,
    summary,
    steps,
    tags,
    confidence: lower.length > 120 ? 82 : 58,
    provider: "local-rules",
    model: "heuristic",
    usedVideo: false
  };
}

export function buildEnrichmentPrompt(item, includeVideo = false) {
  return [
    "You categorize and summarize Instagram reels for a personal knowledge library.",
    "Return strict JSON only with this shape:",
    "{\"title\":\"\",\"category\":\"\",\"summary\":\"\",\"steps\":[{\"text\":\"\"}],\"tags\":[\"\"],\"confidence\":0,\"usedVideo\":false}",
    "Categories must be one of: Travel, Relationships, Finance, Fitness, Motivation, Faith, Comedy, News, Productivity, Tech, Cooking, DIY & Crafts, Marketing, Style & Fashion, Home, Other.",
    "Use caption/message text first. If steps are not explicit, infer short practical steps only when useful.",
    includeVideo ? "If video evidence is provided by the provider, include it and set usedVideo true." : "No video evidence is available; set usedVideo false.",
    "",
    `URL: ${item.url || ""}`,
    `Source: ${item.sourceType || item.source_type || ""}`,
    `Caption/message/raw text: ${item.caption || item.rawText || item.raw_text || ""}`,
    `Existing title: ${item.title || ""}`,
    `Existing tags: ${(item.tags || []).join(", ")}`
  ].join("\n");
}

export async function callOpenAiCompatible({ item, includeVideo = false, env = process.env, fetchImpl = fetch }) {
  const apiKey = env.AI_API_KEY;
  const baseUrl = stripTrailingSlash(env.AI_BASE_URL || "https://integrate.api.nvidia.com/v1");
  const model = includeVideo && env.AI_VIDEO_MODEL ? env.AI_VIDEO_MODEL : env.AI_MODEL;

  if (!apiKey || !model) {
    return { ...localEnrich(item), status: "local", warning: "AI API key or model not configured." };
  }

  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: "Return valid JSON only. No markdown." },
        { role: "user", content: buildEnrichmentPrompt(item, includeVideo) }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Provider returned ${response.status}: ${body.slice(0, 220)}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content || "";
  return normalizeProviderResult(parseJsonFromText(content), {
    provider: env.AI_PROVIDER_NAME || "OpenAI-compatible",
    model,
    usedVideo: includeVideo
  });
}

export function normalizeProviderResult(result, meta = {}) {
  const fallback = localEnrich(result || {});
  return {
    title: cleanText(result?.title) || fallback.title,
    category: cleanText(result?.category) || fallback.category,
    summary: cleanText(result?.summary) || fallback.summary,
    steps: normalizeSteps(result?.steps),
    tags: normalizeTags(result?.tags),
    confidence: clampNumber(result?.confidence, 0, 100, fallback.confidence),
    provider: meta.provider || result?.provider || "OpenAI-compatible",
    model: meta.model || result?.model || "",
    usedVideo: Boolean(result?.usedVideo || meta.usedVideo),
    status: "ready"
  };
}

export function parseJsonFromText(text) {
  const source = String(text || "").trim();
  try {
    return JSON.parse(source);
  } catch {
    const match = source.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Provider response did not include JSON.");
    return JSON.parse(match[0]);
  }
}

function inferCategory(lower) {
  for (const [category, keywords] of CATEGORY_RULES) {
    if (keywords.some((keyword) => lower.includes(keyword))) return category;
  }
  return "Other";
}

function inferTags(lower, category) {
  const candidates = ["ai", "mcp", "github", "recipe", "workout", "travel", "money", "routine", "caption", "howto", "tips", "saved"];
  return [category.toLowerCase(), ...candidates.filter((tag) => lower.includes(tag))].slice(0, 6);
}

function inferTitle(text, url) {
  const cleaned = String(text || "").replace(/https?:\/\/\S+/g, "").trim();
  if (cleaned) return cleaned.split(/\s+/).slice(0, 7).join(" ");
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").filter(Boolean).slice(0, 3).join(" / ") || "Untitled Reel";
  } catch {
    return "Untitled Reel";
  }
}

function inferSummary(text, category, title) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (cleaned.length > 80) return cleaned.slice(0, 260).replace(/\s+\S*$/, "") + ".";
  return `${title} saved as a ${category} reel. Review the source caption and add notes after watching.`;
}

function inferSteps(text, category) {
  const numbered = String(text || "").match(/(?:^|\s)(?:\d+[\).]|step\s+\d+)[:\s]+([^.!?\n]{8,120})/gi);
  if (numbered?.length) {
    return numbered.slice(0, 6).map((entry) => ({ text: entry.replace(/^(?:\s|\d|\.|\)|step)+/gi, "").trim() }));
  }
  if (["Cooking", "Fitness", "Tech", "Productivity"].includes(category)) {
    return [
      { text: "Open the original reel and verify the full context." },
      { text: "Capture the key action, tool, ingredient, or routine." },
      { text: "Save any links or commands mentioned in the caption." }
    ];
  }
  return [{ text: "Watch the reel and confirm whether this summary is useful." }];
}

function normalizeSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps
    .map((step) => (typeof step === "string" ? { text: step } : { text: cleanText(step?.text || step?.title) }))
    .filter((step) => step.text)
    .slice(0, 8);
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.map(cleanText).filter(Boolean).slice(0, 8);
}

function cleanText(value) {
  return String(value || "").trim();
}

function clampNumber(value, min, max, fallback) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(min, Math.min(max, Math.round(next)));
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}
