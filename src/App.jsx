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
  Inbox,
  Library,
  Link as LinkIcon,
  List,
  Loader2,
  MoreHorizontal,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  Tags,
  Trash2,
  UploadCloud,
  UserRound,
  X
} from "lucide-react";
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
  const [pendingImport, setPendingImport] = useState(null);
  const [importSelection, setImportSelection] = useState({ saved: true, other: true, messages: [] });
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarHovered, setSidebarHovered] = useState(false);
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
        const withoutSeedItems = nextItems.filter((item) => !String(item.id || "").startsWith("sample-"));
        if (withoutSeedItems.length !== nextItems.length) {
          nextItems = withoutSeedItems;
          await replaceItems(nextItems);
        }
        if (nextItems.length) await putItems(nextItems);
        if (!active) return;
        setItems(nextItems);
        setBatches(storedBatches);
        setSelectedId(nextItems[0]?.id || null);
        setProvider(health);
        const resumeQueue = nextItems.filter((item) => item.status === "needs_review" || ["pending", "analyzing", "error"].includes(item.aiStatus));
        if (resumeQueue.length) {
          window.setTimeout(() => runEnrichment(resumeQueue), 350);
        }
      } catch (error) {
        if (!active) return;
        setItems([]);
        setSelectedId(null);
        setProvider({ provider: "Local rules", configured: false });
        showToast(`Storage check failed: ${error.message}`);
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
  const selectedItem = selectedId ? items.find((item) => item.id === selectedId) || null : null;
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
      if (!result.items.length) {
        showToast("No Instagram reels found in that export.");
        return;
      }
      setPendingImport(result);
      setImportSelection({
        saved: result.groups.saved.count > 0,
        other: result.groups.other.count > 0,
        messages: result.groups.messages.map((group) => group.account)
      });
      showToast(`Found ${result.items.length} reels. Choose what to import.`);
    } catch (error) {
      showToast(`Import failed: ${error.message}`);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const selectedImportItems = useMemo(() => {
    if (!pendingImport) return [];
    return filterPendingImportItems(pendingImport, importSelection);
  }, [pendingImport, importSelection]);

  const commitPendingImport = async () => {
    if (!pendingImport) return;
    if (!selectedImportItems.length) {
      showToast("Choose at least one saved group or message person first.");
      return;
    }
    setLoading(true);
    try {
      const nextItems = mergeItems(items, selectedImportItems);
      const batch = {
        ...pendingImport.batch,
        itemCount: selectedImportItems.length,
        selectedSaved: importSelection.saved,
        selectedOther: importSelection.other,
        selectedMessages: importSelection.messages
      };
      await putItems(nextItems);
      await addBatch(batch);
      setItems(nextItems);
      setBatches((current) => [batch, ...current]);
      setSelectedId(selectedImportItems[0]?.id || nextItems[0]?.id || null);
      setFilters((current) => ({ ...current, source: "all", category: "All" }));
      setPendingImport(null);
      showToast(`Imported ${selectedImportItems.length} reels. AI review started.`);
      void runEnrichment(selectedImportItems);
    } catch (error) {
      showToast(`Import failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const cancelPendingImport = () => {
    setPendingImport(null);
    setImportSelection({ saved: true, other: true, messages: [] });
  };

  const toggleMessageImport = (account) => {
    setImportSelection((current) => ({
      ...current,
      messages: current.messages.includes(account)
        ? current.messages.filter((entry) => entry !== account)
        : [...current.messages, account]
    }));
  };

  const runEnrichment = async (queue, mode = "text") => {
    for (const item of queue) {
      const analyzingItem = { ...item, aiStatus: "analyzing", status: item.status === "reviewed" ? "reviewed" : "needs_review" };
      patchItem(item.id, analyzingItem);
      await updateItem(analyzingItem);
      try {
        const result = await enrichItem(analyzingItem, mode);
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
    const confirmed = window.confirm("Reset this browser library and remove every imported reel? Export JSON first if you need a backup.");
    if (!confirmed) return;
    await clearLibrary();
    setItems([]);
    setBatches([]);
    setSelectedId(null);
    showToast("Library reset.");
  };

  if (loading && !items.length) {
    return <LoadingScreen />;
  }

  return (
    <div
      className={[
        "reel-app",
        dragging ? "dragging" : "",
        sidebarCollapsed ? "sidebar-collapsed" : "",
        sidebarCollapsed && sidebarHovered ? "sidebar-hovered" : "",
        selectedItem ? "has-detail" : "detail-closed"
      ].filter(Boolean).join(" ")}
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
        collapsed={sidebarCollapsed}
        hoverExpanded={sidebarCollapsed && sidebarHovered}
        onHoverStart={() => setSidebarHovered(true)}
        onHoverEnd={() => setSidebarHovered(false)}
        onToggleCollapsed={() => {
          setSidebarHovered(false);
          setSidebarCollapsed((current) => !current);
        }}
        onSourceChange={(source) => setFilters((current) => ({ ...current, source }))}
        onExportJson={() => exportJson(items)}
        onExportMarkdown={() => exportMarkdown(visibleItems)}
        onAddLink={() => addLinkRef.current?.showModal()}
        onClear={handleClear}
      />

      <main className={`catalog-main ${loading ? "is-loading" : ""}`} aria-busy={loading}>
        {loading ? <LoadingVeil /> : null}
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
            <EmptyState hasItems={items.length > 0} onImport={() => fileInputRef.current?.click()} />
          )
        ) : (
          visibleItems.length ? (
            <ReelList items={visibleItems} selectedId={selectedItem?.id} onSelect={setSelectedId} />
          ) : (
            <EmptyState hasItems={items.length > 0} onImport={() => fileInputRef.current?.click()} />
          )
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

      {pendingImport ? (
        <ImportReviewLayer
          pendingImport={pendingImport}
          selection={importSelection}
          selectedCount={selectedImportItems.length}
          onToggleSaved={() => setImportSelection((current) => ({ ...current, saved: !current.saved }))}
          onToggleOther={() => setImportSelection((current) => ({ ...current, other: !current.other }))}
          onToggleMessage={toggleMessageImport}
          onCancel={cancelPendingImport}
          onContinue={commitPendingImport}
        />
      ) : null}
      {dragging ? <div className="drop-overlay">Drop Instagram ZIP or JSON to import</div> : null}
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-orb">
        <Loader2 className="spin" size={28} />
      </div>
      <div>
        <strong>Loading AI Reels Library</strong>
        <span>Preparing your local library</span>
      </div>
      <div className="loading-skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function LoadingVeil() {
  return (
    <div className="loading-veil" aria-hidden="true">
      <Loader2 className="spin" size={22} />
      <span>Reading import and updating library...</span>
    </div>
  );
}

function Sidebar({
  stats,
  active,
  collapsed,
  hoverExpanded,
  onHoverStart,
  onHoverEnd,
  onToggleCollapsed,
  onSourceChange,
  onExportJson,
  onExportMarkdown,
  onAddLink,
  onClear
}) {
  const visuallyCollapsed = collapsed && !hoverExpanded;
  const nav = [
    { id: "all", label: "Library", count: stats.total, icon: Library },
    { id: "saved", label: "Saved Reels", count: stats.saved, icon: Bookmark },
    { id: "dm", label: "DM Inbox", count: stats.dm, icon: Inbox },
    { id: "review", label: "Needs Review", count: stats.needsReview, icon: ShieldCheck }
  ];

  return (
    <aside
      className={`side-nav ${visuallyCollapsed ? "collapsed" : ""} ${hoverExpanded ? "hover-expanded" : ""}`}
      onPointerEnter={collapsed ? onHoverStart : undefined}
      onPointerLeave={collapsed ? onHoverEnd : undefined}
      onMouseEnter={collapsed ? onHoverStart : undefined}
      onMouseLeave={collapsed ? onHoverEnd : undefined}
    >
      <div className="brand-row">
        <div className="brand-title">AI Reels Library</div>
        <button
          className="icon-button subtle collapse-toggle"
          type="button"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
          title={visuallyCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <List size={19} />
        </button>
      </div>

      <nav className="nav-group" aria-label="Library filters">
        {nav.map((entry) => {
          const Icon = entry.icon;
          return (
            <button
              key={entry.id}
              className={`nav-item ${active === entry.id ? "active" : ""}`}
              type="button"
              aria-label={`${entry.label}: ${entry.count}`}
              title={visuallyCollapsed ? entry.label : undefined}
              onClick={() => onSourceChange(entry.id)}
            >
              <Icon size={18} />
              <span>{entry.label}</span>
              <strong>{entry.count}</strong>
            </button>
          );
        })}
      </nav>

      <div className="nav-group quiet">
        <button className="nav-item" type="button" aria-label="Add link" title={visuallyCollapsed ? "Add Link" : undefined} onClick={onAddLink}>
          <LinkIcon size={18} />
          <span>Add Link</span>
        </button>
        <button className="nav-item" type="button" aria-label="Export JSON" title={visuallyCollapsed ? "Export JSON" : undefined} onClick={onExportJson}>
          <Download size={18} />
          <span>Export JSON</span>
        </button>
        <button className="nav-item" type="button" aria-label="Export Markdown" title={visuallyCollapsed ? "Export Markdown" : undefined} onClick={onExportMarkdown}>
          <FileDown size={18} />
          <span>Export Markdown</span>
        </button>
        <button className="nav-item danger" type="button" aria-label="Reset library" title={visuallyCollapsed ? "Reset Library" : undefined} onClick={onClear}>
          <Trash2 size={18} />
          <span>Reset Library</span>
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
        <strong>{latestBatch ? formatDate(latestBatch.importedAt) : "No import yet"}</strong>
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
    return <aside className="detail-drawer" aria-hidden="true" />;
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

function ImportReviewLayer({ pendingImport, selection, selectedCount, onToggleSaved, onToggleOther, onToggleMessage, onCancel, onContinue }) {
  const saved = pendingImport.groups.saved;
  const other = pendingImport.groups.other;
  const messages = pendingImport.groups.messages;

  return (
    <div className="import-review-layer" role="dialog" aria-modal="true" aria-labelledby="import-review-title">
      <div className="import-review-card">
        <div className="modal-head">
          <div>
            <h2 id="import-review-title">Choose What To Import</h2>
            <p>Review found reels before adding them to your library and starting AI review.</p>
          </div>
          <button className="icon-button" type="button" aria-label="Cancel import" onClick={onCancel}><X size={17} /></button>
        </div>

        <div className="import-review-summary">
          <StatusMetric icon={CheckCircle2} label="Found" value={pendingImport.items.length} />
          <StatusMetric icon={Bookmark} label="Saved" value={saved.count} />
          <StatusMetric icon={Library} label="Other" value={other.count} />
          <StatusMetric icon={Inbox} label="Message People" value={messages.length} />
        </div>

        <div className="import-choice-list">
          <label className={`import-choice ${selection.saved ? "selected" : ""} ${saved.count ? "" : "disabled"}`}>
            <input type="checkbox" checked={selection.saved} disabled={!saved.count} onChange={onToggleSaved} />
            <Bookmark size={18} />
            <span>
              <strong>Saved reels</strong>
              <small>{saved.count} reels from your saved export</small>
            </span>
          </label>

          <label className={`import-choice ${selection.other ? "selected" : ""} ${other.count ? "" : "disabled"}`}>
            <input type="checkbox" checked={selection.other} disabled={!other.count} onChange={onToggleOther} />
            <Library size={18} />
            <span>
              <strong>Other export reels</strong>
              <small>{other.count} reels from JSON/export backup files</small>
            </span>
          </label>

          <div className="message-choice-head">
            <strong>DM reels by person</strong>
            <small>Select only the conversations you want to import.</small>
          </div>

          {messages.length ? messages.map((group) => (
            <label key={group.account} className={`import-choice ${selection.messages.includes(group.account) ? "selected" : ""}`}>
              <input type="checkbox" checked={selection.messages.includes(group.account)} onChange={() => onToggleMessage(group.account)} />
              <Inbox size={18} />
              <span>
                <strong>{group.account}</strong>
                <small>{group.count} reels found in messages</small>
              </span>
            </label>
          )) : <p className="muted">No DM reels found in this import.</p>}
        </div>

        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>Cancel</button>
          <button className="primary-button" type="button" disabled={!selectedCount} onClick={onContinue}>Import {selectedCount} Reels</button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ hasItems, onImport }) {
  return (
    <div className="empty-state">
      <UploadCloud size={32} />
      <h2>{hasItems ? "No matching reels" : "No reels imported yet"}</h2>
      <p>{hasItems ? "Broaden filters or search for a different topic." : "Import your Instagram ZIP or JSON export to build the library."}</p>
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

function filterPendingImportItems(pendingImport, selection) {
  const selectedIds = new Set();
  if (selection.saved) {
    pendingImport.groups.saved.itemIds.forEach((id) => selectedIds.add(id));
  }
  if (selection.other) {
    pendingImport.groups.other.itemIds.forEach((id) => selectedIds.add(id));
  }
  pendingImport.groups.messages
    .filter((group) => selection.messages.includes(group.account))
    .forEach((group) => group.itemIds.forEach((id) => selectedIds.add(id)));
  return pendingImport.items.filter((item) => selectedIds.has(item.id));
}



