# AI Reels Library

Local-first web app for turning Instagram DM-shared reels and saved reels into a browsable movie-style library.

Import an Instagram export ZIP or JSON in the browser, let the app extract reel links/captions, auto-categorize and summarize them, then review everything in a poster-grid library with captions, steps, tags, and Instagram watch links.

## Run Locally

```powershell
git clone git@github.com:Yohanes-arch/ai-reels-library.git
cd ai-reels-library
npm install
npm run dev
```

Open:

```text
http://localhost:4173/
```

The dev command starts both:

- Vite web app on `4173`
- local AI/API server on `4174`

## Normal User Flow

1. Open the app.
2. Click **Drop Instagram ZIP** or **Import**.
3. Choose an Instagram export `.zip` or one/more `.json` files.
4. The app scans the export, extracts Instagram reels/posts, dedupes them, and stores them in browser IndexedDB.
5. The local API enriches each reel from caption/message/URL context.
6. Browse by Library, Saved Reels, DM Inbox, Needs Review, or category chips.
7. Pick a poster card to inspect AI Summary, Steps, Caption, and Watch.
8. Export JSON or Markdown when you want a backup.

No manual `data/raw` step is required for normal use now.

## AI Setup

AI enrichment uses an OpenAI-compatible local server so API keys stay out of the browser.

Copy `.env.example` to `.env`:

```powershell
Copy-Item .env.example .env
```

Then set:

```text
AI_PROVIDER_NAME=NVIDIA NIM
AI_BASE_URL=https://integrate.api.nvidia.com/v1
AI_MODEL=your-text-model
AI_VIDEO_MODEL=
AI_API_KEY=your-key
PORT=4174
```

If no API key/model is configured, the app still works with local rule-based categorization and summaries. Video analysis is best-effort: it runs only when a configured provider/model can inspect available video evidence. Instagram public embeds are also best-effort, with an **Open Instagram** fallback.

## Commands

```powershell
npm run dev      # API + Vite app
npm run build    # production build
npm start        # serve built app + API
npm test         # parser and AI helper tests
```

PowerShell helpers still exist:

```powershell
.\scripts\install-deps.ps1
.\scripts\start-local-server.ps1
.\scripts\build-app.ps1
```

## Project Layout

```text
src/App.jsx                 movie-library UI
src/styles.css              Option B light catalog design
src/lib/instagramImport.js  browser ZIP/JSON Instagram parser
src/lib/storage.js          IndexedDB storage
src/lib/aiClient.js         browser API client
src/lib/library.js          normalization, filters, exports
server/index.js             local Express API
server/enrich.js            OpenAI-compatible enrichment + local fallback
scripts/                    optional PowerShell helpers
```

## Data And Privacy

- Browser library data lives in IndexedDB.
- AI keys live only in `.env` on the local API server.
- `.env`, raw exports, generated exports, `node_modules`, and `dist` are ignored by Git.
- Use **Export JSON** for backups before clearing browser data.
