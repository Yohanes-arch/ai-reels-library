import { describe, expect, it } from "vitest";
import { localEnrich, normalizeProviderResult, parseJsonFromText } from "./enrich.js";

describe("AI enrichment helpers", () => {
  it("builds local enrichment when provider is not configured", () => {
    const result = localEnrich({
      url: "https://www.instagram.com/reel/workout",
      caption: "40 seconds squat, push-up, plank, lunge. Full body workout routine."
    });

    expect(result.category).toBe("Fitness");
    expect(result.summary).toContain("workout");
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it("parses JSON wrapped in provider text", () => {
    const parsed = parseJsonFromText('Here is JSON: {"title":"Saved Reel","category":"Tech","summary":"Useful AI workflow","steps":[{"text":"Open repo"}],"tags":["ai"],"confidence":91}');
    const normalized = normalizeProviderResult(parsed, { provider: "Test", model: "model" });

    expect(normalized.title).toBe("Saved Reel");
    expect(normalized.category).toBe("Tech");
    expect(normalized.steps[0].text).toBe("Open repo");
    expect(normalized.confidence).toBe(91);
  });
});
