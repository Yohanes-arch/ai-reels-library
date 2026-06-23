import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Bookmark,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  FileDown,
  Filter,
  Grid2X2,
  Import,
  Inbox,
  Library,
  Link as LinkIcon,
  List,
  Loader2,
  MoreHorizontal,
  Play,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Tags,
  UploadCloud,
  UserRound,
  X
} from "lucide-react";
import { sampleItems } from "./data/sampleItems.js";
import { enrichItem, readProviderHealth } from "./lib/aiClient.js";
import { parseImportFiles } from "./lib/instagramImport.js";
import {
  categoryOrder,
  exportJson,
  exportMarkdown,
  filterItems,
  formatDate,
  formatShortDate,
  getCategoryCounts,
  getStats,
  groupShelves,
  makeManualItem,
  mergeItems,
  normalizeItems,
  readLegacyLocalItems,
  sourceLabel
} from "./lib/library.js";
import { addBatch, clearLibrary, putItems, readBatches, readItems, replaceItems, updateItem } from "./lib/storage.js";

const tabs = ["AI Summary", "Steps", "Caption", "Watch"];

export default function App() {
  const [items, setItems] = useState([]);
  const [batches, setBatches] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [filters, setFilters] = useState({ source: "all", category: "All", search: "", sort: "newest" });
  const [layout, setLayout] = useState("grid");
  const [activeTab, setActiveTab] = useState("AI Summary");
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [provider, setProvider] = useState({ provider: "Local rules", configured: false });
  const fileInputRef = useRef(null);
  const addLinkRef = useRef(null);

  useEffect(() => {
    let active = true;
    async function boot() {
      try {
        const [storedItems, storedBatches, health] = await Promise.all([readItems(), readBatches(), readProviderHealth()]);
        let nextItems = normalizeItems(storedItems);
        if (!nextItems.length) {
          nextItems = normalizeItems(readLegacyLocalItems());
        }
        if (!nextItems.length) {
          nextItems = normalizeItems(sampleItems);
        }
        await putItems(nextItems);
        if (!active) return;
        setItems(nextItems);
        setBatches(storedBatches);
        setSelectedId(nextItems[0]?.id || null);
        setProvider(health);
      } catch (error) {
        const fallbackItems = normalizeItems(sampleItems);
        if (!active) return;
        setItems(fallbackItems);
        setSelectedId(fallbackItems[0]?.id || null);
        setProvider({ provider: "Local rules", configured: false });
        showToast(`Loaded sample library: ${error.message}`);
      } finally {
        if (active) setLoading(false);
      }
    }
    boot();
    return () => {
      active = false;
    };
  }, []);

  const visibleItems = useMemo(() => filterItems(items, filters), [items, filters]);
  const selectedItem = items.find((item) => item.id === selectedId) || visibleItems[0] || items[0] || null;
  const selectedCategory = filters.category;
  const stats = useMemo(() => getStats(items), [items]);
  const categories = useMemo(() => getCategoryCounts(items), [items]);
  const shelves = useMemo(() => groupShelves(visibleItems), [visibleItems]);
  const latestBatch = batches.toSorted((a, b) => String(b.importedAt).localeCompare(String(a.importedAt)))[0];

  const showToast = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3000);
  };

  const patchItem = (id, patch) => {
    setItems((current) => {
      const next = current.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, ...patch };
        void updateItem(updated);
        return updated;
      });
      return next;
    });
  };

  const handleFiles = async (files) => {
    if (!files?.length) return;
    setLoading(true);
    try {
      const result = await parseImportFiles(files);
      const nextItems = mergeItems(items, result.items);
      await putItems(nextItems);
      await addBatch(result.batch);
      setItems(nextItems);
      setBatches((current) => [result.batch, ...current]);
      setSelectedId(result.items[0]?.id || nextItems[0]?.id || null);
      setFilters((current) => ({ ...current, source: "all", category: "All" }));
      showToast(`Imported ${result.items.length} reels from ${result.batch.documentCount} JSON files.`);
      void runEnrichment(result.items);
    } catch (error) {
      showToast(`Import failed: ${error.message}`);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const runEnrichment = async (queue, mode = "text") => {
    for (const item of queue) {
      patchItem(item.id, { aiStatus: "analyzing", status: item.status === "reviewed" ? "reviewed" : "needs_review" });
      try {
        const result = await enrichItem(item, mode);
        patchItem(item.id, {
          title: result.title || item.title,
          category: result.category || item.category,
          summary: result.summary || item.summary,
          steps: result.steps?.length ? result.steps : item.steps,
          tags: mergeTags(item.tags, result.tags),
          confidence: result.confidence ?? item.confidence,
          provider: result.provider || provider.provider,
          model: result.model || "",
          usedVideo: Boolean(result.usedVideo),
          aiStatus: result.status === "local" ? "local" : "ready",
          aiWarning: result.warning || "",
          status: "ready"
        });
      } catch (error) {
        patchItem(item.id, {
          aiStatus: "error",
          aiWarning: error.message,
          status: "needs_review"
        });
      }
    }
  };

  const handleAddManual = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const item = makeManualItem({
      url: String(data.get("url") || ""),
      title: String(data.get("title") || ""),
      category: String(data.get("category") || "Other"),
      caption: String(data.get("caption") || ""),
      tags: String(data.get("tags") || "")
    });
    const nextItems = mergeItems(items, [item]);
    await putItems(nextItems);
    setItems(nextItems);
    setSelectedId(item.id);
    form.reset();
    addLinkRef.current?.close();
    showToast("Link added.");
    void runEnrichment([item]);
  };

  const handleClear = async () => {
    const confirmed = window.confirm("Clear this browser library? Export JSON first if you need a backup.");
    if (!confirmed) return;
    await clearLibrary();
    const seeds = normalizeItems(sampleItems);
    await putItems(seeds);
    setItems(seeds);
    setBatches([]);
    setSelectedId(seeds[0]?.id || null);
    showToast("Library reset to sample reels.");
  };

  if (loading && !items.length) {
    return (
      <div className="loading-screen">
        <Loader2 className="spin" size={28} />
        <span>Loading AI Reels Library</span>
      </div>
    );
  }

  return (
    <div
      className={`reel-app ${dragging ? "dragging" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void handleFiles(event.dataTransfer.files);
      }}
    >
      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        multiple
        accept=".zip,.json,application/json,application/zip"
        onChange={(event) => void handleFiles(event.target.files)}
      />

      <Sidebar
        stats={stats}
        active={filters.source}
        onSourceChange={(source) => setFilters((current) => ({ ...current, source }))}
        onExportJson={() => exportJson(items)}
        onExportMarkdown={() => exportMarkdown(visibleItems)}
        onAddLink={() => addLinkRef.current?.showModal()}
        onClear={handleClear}
      />

      <main className="catalog-main">
        <Topbar
          search={filters.search}
          provider={provider}
          onSearch={(search) => setFilters((current) => ({ ...current, search }))}
          onImport={() => fileInputRef.current?.click()}
        />

        <ImportStatus latestBatch={latestBatch} stats={stats} onImport={() => fileInputRef.current?.click()} />

        <CategoryRail categories={categories} active={selectedCategory} onSelect={(category) => setFilters((current) => ({ ...current, category }))} />

        <Toolbar
          count={visibleItems.length}
          layout={layout}
          sort={filters.sort}
          onLayout={setLayout}
          onSort={(sort) => setFilters((current) => ({ ...current, sort }))}
        />

        {layout === "grid" ? (
          shelves.length ? (
            <div className="shelf-stack">
              {shelves.map((shelf) => (
                <Shelf key={shelf.id} shelf={shelf} selectedId={selectedItem?.id} onSelect={setSelectedId} />
              ))}
            </div>
          ) : (
            <EmptyState onImport={() => fileInputRef.current?.click()} />
          )
        ) : (
          <ReelList items={visibleItems} selectedId={selectedItem?.id} onSelect={setSelectedId} />
        )}
      </main>

      <DetailPanel
        item={selectedItem}
        activeTab={activeTab}
        onTab={setActiveTab}
        onClose={() => setSelectedId(null)}
        onReprocess={(mode) => selectedItem && void runEnrichment([selectedItem], mode)}
        onMarkReviewed={() => selectedItem && patchItem(selectedItem.id, { status: "reviewed" })}
      />

      <dialog ref={addLinkRef} className="modal">
        <form className="modal-card" onSubmit={handleAddManual}>
          <div className="modal-head">
            <div>
              <h2>Add Reel Link</h2>
              <p>Paste Instagram, GitHub, docs, or tool URL.</p>
            </div>
            <button className="icon-button" type="button" aria-label="Close" onClick={() => addLinkRef.current?.close()}>
              <X size={17} />
            </button>
          </div>
          <label>
            URL
            <input name="url" type="url" required placeholder="https://www.instagram.com/reel/..." />
          </label>
          <label>
            Title
            <input name="title" placeholder="Optional title" />
          </label>
          <label>
            Caption or context
            <textarea name="caption" rows="4" placeholder="Paste caption or DM context if available." />
          </label>
          <div className="form-grid">
            <label>
              Category
              <select name="category" defaultValue="Other">
                {categoryOrder.filter((category) => category !== "All").map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </label>
            <label>
              Tags
              <input name="tags" placeholder="ai, recipe, workflow" />
            </label>
          </div>
          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={() => addLinkRef.current?.close()}>Cancel</button>
            <button className="primary-button" type="submit">Add Link</button>
          </div>
        </form>
      </dialog>

      {dragging ? <div className="drop-overlay">Drop Instagram ZIP or JSON to import</div> : null}
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

function Sidebar({ stats, active, onSourceChange, onExportJson, onExportMarkdown, onAddLink, onClear }) {
  const nav = [
    { id: "all", label: "Library", count: stats.total, icon: Library },
    { id: "saved", label: "Saved Reels", count: stats.saved, icon: Bookmark },
    { id: "dm", label: "DM Inbox", count: stats.dm, icon: Inbox },
    { id: "review", label: "Needs Review", count: stats.needsReview, icon: ShieldCheck }
  ];

  return (
    <aside className="side-nav">
      <div className="brand-row">
        <div className="brand-title">AI Reels Library</div>
        <button className="icon-button subtle" type="button" aria-label="Menu">
          <List size={19} />
        </button>
      </div>

      <nav className="nav-group" aria-label="Library filters">
        {nav.map((entry) => {
          const Icon = entry.icon;
          return (
            <button key={entry.id} className={`nav-item ${active === entry.id ? "active" : ""}`} type="button" onClick={() => onSourceChange(entry.id)}>
              <Icon size={18} />
              <span>{entry.label}</span>
              <strong>{entry.count}</strong>
            </button>
          );
        })}
      </nav>

      <div className="nav-group quiet">
        <button className="nav-item" type="button" onClick={onAddLink}>
          <LinkIcon size={18} />
          <span>Add Link</span>
        </button>
        <button className="nav-item" type="button" onClick={onExportJson}>
          <Download size={18} />
          <span>Export JSON</span>
        </button>
        <button className="nav-item" type="button" onClick={onExportMarkdown}>
          <FileDown size={18} />
          <span>Export Markdown</span>
        </button>
        <button className="nav-item" type="button" onClick={onClear}>
          <Settings size={18} />
          <span>Reset Sample</span>
        </button>
      </div>

      <div className="storage-card">
        <div>
          <span>Library</span>
          <strong>{stats.total.toLocaleString()} reels</strong>
        </div>
        <div className="meter"><span style={{ width: `${Math.min(92, 22 + stats.total / 25)}%` }} /></div>
        <small>{stats.ready} enriched, {stats.needsReview} need review</small>
      </div>
    </aside>
  );
}

function Topbar({ search, provider, onSearch, onImport }) {
  return (
    <header className="topbar">
      <div className="search-box">
        <Search size={18} />
        <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search reels, captions, people, topics..." />
        <kbd>Ctrl K</kbd>
      </div>
      <button className="drop-button" type="button" onClick={onImport}>
        <UploadCloud size={18} />
        Drop Instagram ZIP
      </button>
      <button className="import-button" type="button" onClick={onImport}>
        Import
        <ChevronDown size={16} />
      </button>
      <div className={`provider-pill ${provider.configured ? "online" : ""}`}>
        <Sparkles size={15} />
        <span>{provider.configured ? provider.provider : "Local rules"}</span>
      </div>
      <Bell size={19} />
      <div className="avatar"><UserRound size={18} /></div>
    </header>
  );
}

function ImportStatus({ latestBatch, stats, onImport }) {
  return (
    <section className="import-strip">
      <div>
        <span>Latest Import</span>
        <strong>{latestBatch ? formatDate(latestBatch.importedAt) : "Sample library loaded"}</strong>
      </div>
      <StatusMetric icon={CheckCircle2} label="Imported" value={stats.total.toLocaleString()} />
      <StatusMetric icon={Loader2} label="Analyzing" value={stats.analyzing} spinning={stats.analyzing > 0} />
      <StatusMetric icon={ShieldCheck} label="Needs Review" value={stats.needsReview} tone="warn" />
      <button className="strip-link" type="button" onClick={onImport}>View All Imports</button>
    </section>
  );
}

function StatusMetric({ icon: Icon, label, value, spinning, tone }) {
  return (
    <div className={`status-metric ${tone || ""}`}>
      <Icon className={spinning ? "spin" : ""} size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CategoryRail({ categories, active, onSelect }) {
  return (
    <div className="category-rail">
      {categories.map((entry) => (
        <button key={entry.category} className={`category-chip ${entry.category === active ? "active" : ""}`} type="button" onClick={() => onSelect(entry.category)}>
          <span>{entry.category}</span>
          <strong>{entry.count.toLocaleString()}</strong>
        </button>
      ))}
    </div>
  );
}

function Toolbar({ count, layout, sort, onLayout, onSort }) {
  return (
    <div className="catalog-toolbar">
      <div className="layout-toggle">
        <button className={layout === "grid" ? "active" : ""} type="button" aria-label="Grid view" onClick={() => onLayout("grid")}><Grid2X2 size={17} /></button>
        <button className={layout === "list" ? "active" : ""} type="button" aria-label="List view" onClick={() => onLayout("list")}><List size={17} /></button>
      </div>
      <label className="sort-control">
        Sort:
        <select value={sort} onChange={(event) => onSort(event.target.value)}>
          <option value="newest">Newest</option>
          <option value="confidence">Confidence</option>
        </select>
      </label>
      <span className="result-count">{count.toLocaleString()} reels</span>
      <button className="secondary-button compact" type="button"><Filter size={16} /> Filters</button>
    </div>
  );
}

function Shelf({ shelf, selectedId, onSelect }) {
  return (
    <section className="shelf">
      <div className="shelf-head">
        <h2>{shelf.title}</h2>
        <button type="button">See All</button>
      </div>
      <div className="poster-row">
        {shelf.items.map((item) => (
          <PosterCard key={item.id} item={item} selected={item.id === selectedId} onClick={() => onSelect(item.id)} />
        ))}
      </div>
    </section>
  );
}

function PosterCard({ item, selected, onClick }) {
  return (
    <button className={`poster-card ${selected ? "selected" : ""}`} type="button" onClick={onClick}>
      <div className="poster-art" style={posterStyle(item)}>
        <span className="duration">{item.duration || "0:30"}</span>
        <Bookmark className="save-icon" size={19} />
        <div className="poster-scrim" />
        <div className="poster-copy">
          <h3>{item.title}</h3>
          <span>{item.category}</span>
          <small>{formatShortDate(item.savedAt || item.sentAt || item.importedAt)} - {sourceLabel(item)}</small>
        </div>
        <span className="ready-dot" />
      </div>
    </button>
  );
}

function ReelList({ items, selectedId, onSelect }) {
  return (
    <div className="reel-list">
      {items.map((item) => (
        <button key={item.id} className={`reel-row ${selectedId === item.id ? "selected" : ""}`} type="button" onClick={() => onSelect(item.id)}>
          <div className="row-thumb" style={posterStyle(item)} />
          <div>
            <strong>{item.title}</strong>
            <span>{item.summary || item.caption || "No summary yet."}</span>
          </div>
          <small>{item.category}</small>
          <small>{item.confidence}%</small>
        </button>
      ))}
    </div>
  );
}

function DetailPanel({ item, activeTab, onTab, onClose, onReprocess, onMarkReviewed }) {
  if (!item) {
    return (
      <aside className="detail-drawer empty">
        <p>Select a reel to inspect summary, steps, caption, and embed.</p>
      </aside>
    );
  }

  const date = item.savedAt || item.sentAt || item.importedAt;

  return (
    <aside className="detail-drawer">
      <div className="drawer-actions">
        <button className="icon-button subtle" type="button" aria-label="Close details" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="detail-hero">
        <div className="detail-thumb" style={posterStyle(item)}>
          <span>{item.duration || "0:30"}</span>
        </div>
        <div>
          <h2>{item.title}</h2>
          <p>{formatDate(date)}</p>
          <span className="soft-pill">{item.category}</span>
          <div className="source-line">
            <Bookmark size={14} />
            <span>Source: {sourceLabel(item)}</span>
          </div>
          <div className="detail-buttons">
            <a className="secondary-button compact" href={item.url} target="_blank" rel="noreferrer">
              <ExternalLink size={16} /> Open Instagram
            </a>
            <button className="icon-button" type="button" aria-label="More"><MoreHorizontal size={17} /></button>
          </div>
        </div>
      </div>

      <div className="tabs">
        {tabs.map((tab) => (
          <button key={tab} className={activeTab === tab ? "active" : ""} type="button" onClick={() => onTab(tab)}>{tab}</button>
        ))}
      </div>

      <div className="tab-body">
        {activeTab === "AI Summary" ? <SummaryTab item={item} onReprocess={onReprocess} onMarkReviewed={onMarkReviewed} /> : null}
        {activeTab === "Steps" ? <StepsTab item={item} /> : null}
        {activeTab === "Caption" ? <CaptionTab item={item} /> : null}
        {activeTab === "Watch" ? <WatchTab item={item} /> : null}
      </div>
    </aside>
  );
}

function SummaryTab({ item, onReprocess, onMarkReviewed }) {
  return (
    <>
      <section className="detail-section">
        <h3><Sparkles size={15} /> AI Summary</h3>
        {item.aiStatus === "analyzing" ? (
          <p className="muted"><Loader2 className="spin inline-icon" size={16} /> Analyzing caption and available reel context.</p>
        ) : (
          <p>{item.summary || "No summary yet. Reprocess with AI to generate one from caption and context."}</p>
        )}
        <div className="confidence-row">
          <span className="good-pill">Confidence: {item.confidence || 0}%</span>
          <span className="soft-pill">Source: {item.usedVideo ? "Caption + Video" : "Caption + URL"}</span>
        </div>
        {item.aiWarning ? <small className="warning-text">{item.aiWarning}</small> : null}
      </section>
      <section className="detail-section">
        <h3><Tags size={15} /> Tags</h3>
        <div className="tag-list">
          {item.tags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      </section>
      <div className="detail-action-row">
        <button className="primary-button" type="button" onClick={() => onReprocess("text")}>
          <Sparkles size={16} /> Reprocess with AI
        </button>
        <button className="secondary-button" type="button" onClick={onMarkReviewed}>Mark Reviewed</button>
      </div>
    </>
  );
}

function StepsTab({ item }) {
  return (
    <section className="detail-section">
      <h3><List size={15} /> Step-by-step</h3>
      <ol className="steps-list">
        {(item.steps.length ? item.steps : [{ text: "Watch the original reel and capture steps here." }]).map((step, index) => (
          <li key={`${step.text}-${index}`}>
            <span>{index + 1}</span>
            <p>{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function CaptionTab({ item }) {
  return (
    <section className="detail-section">
      <h3><FileDown size={15} /> Caption</h3>
      <p>{item.caption || item.rawText || "No caption captured in the imported data."}</p>
      <section className="related-links">
        <h4>Related Links</h4>
        {(item.relatedLinks.length ? item.relatedLinks : [{ url: item.url, label: "Original Reel on Instagram" }]).map((link) => (
          <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
            <span>{link.label || link.url}</span>
            <ExternalLink size={14} />
          </a>
        ))}
      </section>
    </section>
  );
}

function WatchTab({ item }) {
  const embedUrl = getInstagramEmbedUrl(item.url);
  return (
    <section className="detail-section">
      <h3><Play size={15} /> Instagram Embed</h3>
      {embedUrl ? (
        <div className="embed-frame">
          <iframe title={item.title} src={embedUrl} loading="lazy" allowTransparency="true" />
        </div>
      ) : (
        <div className="embed-empty">Embed unavailable for this source.</div>
      )}
      <a className="primary-button full" href={item.url} target="_blank" rel="noreferrer">
        <ExternalLink size={16} /> Open Instagram
      </a>
    </section>
  );
}

function EmptyState({ onImport }) {
  return (
    <div className="empty-state">
      <UploadCloud size={32} />
      <h2>No matching reels</h2>
      <p>Import an Instagram ZIP/JSON export or broaden filters.</p>
      <button className="primary-button" type="button" onClick={onImport}>Import Instagram Export</button>
    </div>
  );
}

function posterStyle(item) {
  if (item.thumbnailUrl) {
    return { backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.04), rgba(0,0,0,0.78)), url("${item.thumbnailUrl}")` };
  }
  return { backgroundImage: `linear-gradient(145deg, ${categoryColor(item.category)}, #111827)` };
}

function categoryColor(category) {
  const colors = {
    Travel: "#1e6091",
    Relationships: "#b4535a",
    Finance: "#172554",
    Fitness: "#334155",
    Motivation: "#7c2d12",
    Faith: "#6d5d2e",
    Comedy: "#b45309",
    News: "#374151",
    Productivity: "#0f766e",
    Tech: "#1d4ed8",
    Cooking: "#9a3412",
    Other: "#111827"
  };
  return colors[category] || "#111827";
}

function getInstagramEmbedUrl(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("instagram.com")) return "";
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (!parts.length) return "";
    return `https://www.instagram.com/${parts.slice(0, 2).join("/")}/embed`;
  } catch {
    return "";
  }
}

function mergeTags(a = [], b = []) {
  return [...new Set([...a, ...(b || [])].filter(Boolean))].slice(0, 8);
}
