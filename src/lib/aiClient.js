export async function enrichItem(item, mode = "text") {
  const endpoint = mode === "video" ? "/api/enrich-video" : "/api/enrich";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item })
  });
  if (!response.ok) throw new Error(`AI request failed: ${response.status}`);
  const payload = await response.json();
  return payload.result;
}

export async function readProviderHealth() {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 1500);
    const response = await fetch("/api/health", { signal: controller.signal });
    window.clearTimeout(timer);
    if (!response.ok) throw new Error(`Health failed: ${response.status}`);
    return response.json();
  } catch {
    return {
      ok: false,
      provider: "Local rules",
      configured: false,
      model: null,
      videoModel: null
    };
  }
}
