import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callOpenAiCompatible, localEnrich } from "./enrich.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 4174);
const apiOnly = process.argv.includes("--api-only");

app.use(cors());
app.use(express.json({ limit: "8mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    provider: process.env.AI_PROVIDER_NAME || "OpenAI-compatible",
    configured: Boolean(process.env.AI_API_KEY && process.env.AI_MODEL),
    model: process.env.AI_MODEL || null,
    videoModel: process.env.AI_VIDEO_MODEL || null
  });
});

app.post("/api/enrich", async (req, res) => {
  try {
    const item = req.body?.item || req.body || {};
    const result = await callOpenAiCompatible({ item, includeVideo: false });
    res.json({ ok: true, result });
  } catch (error) {
    const fallback = localEnrich(req.body?.item || req.body || {});
    res.status(200).json({
      ok: true,
      result: {
        ...fallback,
        status: "fallback",
        warning: error.message
      }
    });
  }
});

app.post("/api/enrich-video", async (req, res) => {
  try {
    const item = req.body?.item || req.body || {};
    const result = await callOpenAiCompatible({ item, includeVideo: true });
    res.json({ ok: true, result });
  } catch (error) {
    const fallback = localEnrich(req.body?.item || req.body || {});
    res.status(200).json({
      ok: true,
      result: {
        ...fallback,
        status: "fallback",
        usedVideo: false,
        warning: `Video enrichment unavailable: ${error.message}`
      }
    });
  }
});

if (!apiOnly) {
  const distDir = path.resolve(__dirname, "..", "dist");
  app.use(express.static(distDir));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(port, "0.0.0.0", () => {
  console.log(`AI Reels API listening on http://127.0.0.1:${port}`);
});
