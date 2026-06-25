import { describe, expect, it } from "vitest";
import { buildImportGroups, extractItems } from "./instagramImport.js";

describe("extractItems", () => {
  it("extracts reels and related links from Instagram DM exports", () => {
    const data = {
      messages: [
        {
          sender_name: "Raka",
          timestamp_ms: 1716100000000,
          content: "This AI workflow is useful https://www.instagram.com/reel/abc123/?utm_source=ig_web_copy_link and repo https://github.com/example/reel-tools"
        }
      ]
    };

    const items = extractItems(data, "messages/inbox/raka/message_1.json");

    expect(items).toHaveLength(1);
    expect(items[0].url).toBe("https://www.instagram.com/reel/abc123");
    expect(items[0].sourceType).toBe("instagram-dm");
    expect(items[0].sourceAccount).toBe("Raka");
    expect(items[0].relatedLinks[0].url).toBe("https://github.com/example/reel-tools");
    expect(items[0].category).toBe("Tech");
  });

  it("accepts normalized backup JSON items", () => {
    const data = {
      items: [
        {
          url: "https://www.instagram.com/reel/pasta/",
          title: "Pasta dinner",
          caption: "Garlic parmesan pasta recipe",
          category: "Cooking"
        }
      ]
    };

    const items = extractItems(data, "backup.json");

    expect(items).toHaveLength(1);
    expect(items[0].category).toBe("Cooking");
    expect(items[0].title).toBe("Pasta dinner");
    expect(buildImportGroups(items).other.count).toBe(1);
  });

  it("extracts reels from plain Instagram saved JSON arrays", () => {
    const data = [
      {
        string_map_data: {
          Link: { href: "https://www.instagram.com/reel/saved123/?utm_source=ig_web_copy_link" },
          "Saved on": { timestamp: 1716100000 }
        }
      }
    ];

    const items = extractItems(data, "saved_posts.json");

    expect(items).toHaveLength(1);
    expect(items[0].url).toBe("https://www.instagram.com/reel/saved123");
    expect(items[0].sourceType).toBe("instagram-saved");
  });
});
