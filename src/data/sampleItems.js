export const sampleItems = [
  {
    url: "https://www.instagram.com/reel/sample-tradingview-mcp/",
    source_type: "sample",
    source_account: "main-account",
    title: "TradingView MCP setup from a reel",
    category: "MCP",
    summary:
      "A saved reel appears to mention a TradingView MCP connector, scanner workflow, and technical recommendations for watchlists.",
    tutorial:
      "Open the source, verify the package or GitHub repo name, then test whether it can return IDX symbols and TradingView recommendations.",
    raw_text: "TradingView MCP server github scanner technical recommendation IDX",
    tags: ["tradingview", "mcp", "idx", "priority"],
    priority_score: 98,
    status: "lead",
    collection_name: "AI Trading",
    saved_at: new Date().toISOString(),
    item_links: [
      {
        url: "https://github.com/search?q=tradingview+mcp",
        host: "github.com",
        link_type: "github"
      }
    ]
  },
  {
    url: "https://www.instagram.com/reel/sample-github-agent/",
    source_type: "sample",
    source_account: "ai-account",
    title: "Open-source coding agent workflow",
    category: "AI Agents",
    summary:
      "A reel about chaining a coding agent with a local knowledge base and GitHub repository discovery.",
    tutorial:
      "Extract the repo link, inspect README setup, and save install commands as a library note.",
    raw_text: "github open source coding agent local workflow",
    tags: ["agent", "github", "coding"],
    priority_score: 56,
    status: "reviewed",
    item_links: [
      {
        url: "https://github.com/topics/ai-agent",
        host: "github.com",
        link_type: "github"
      }
    ]
  },
  {
    url: "https://www.instagram.com/reel/sample-video-ai/",
    source_type: "sample",
    source_account: "main-account",
    title: "Video AI prompt workflow",
    category: "Video AI",
    summary: "A saved reel covering prompt structure for short AI-generated product clips.",
    tutorial:
      "Capture prompt template, model name, and output settings before moving it into production notes.",
    raw_text: "AI video prompt workflow reels",
    tags: ["video", "prompting"],
    priority_score: 22,
    status: "unprocessed",
    item_links: []
  }
];

