import { useMemo, useRef, useState } from "react";
import { sampleItems } from "./data/sampleItems.js";
import {
  buildDefaultTutorial,
  categoryOrder,
  cleanTitleFromUrl,
  exportJson,
  exportMarkdown,
  filterItems,
  formatBytes,
  formatDate,
  getViewCopy,
  getViewCounts,
  isMcpLead,
  makeManualItem,
  mergeItems,
  normalizeItems,
  persistLocalItems,
  readLocalItems,
  splitTags
} from "./lib/library.js";

const initialItems = () => {
  const stored = readLocalItems();
  if (Array.isArray(stored)) return stored;
  const seededItems = normalizeItems(sampleItems);
  persistLocalItems(seededItems);
  return seededItems;
};

export default function App() {
  const [items, setItems] = useState(initialItems);
  const [view, setView] = useState("mcp");
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("tradingview mcp");
  const [selectedId, setSelectedId] = useState(() => initialItems()[0]?.id ?? null);
  const [toast, setToast] = useState("");
  const settingsRef = useRef(null);
  const addLinkRef = useRef(null);
  const fileInputRef = useRef(null);

  const filteredItems = useMemo(() => filterItems(items, view, category, search), [items, view, category, search]);
  const selectedItem = items.find((item) => item.id === selectedId) || filteredItems[0] || items[0] || null;
  const selectedItemId = selectedItem?.id ?? null;
  const viewCopy = getViewCopy(view, filteredItems.length);
  const counts = getViewCounts(items);
  const stats = [
    { label: "Total reels", value: items.length },
    { label: "MCP leads", value: counts.mcp },
    { label: "GitHub links", value: counts.github },
    { label: "Unprocessed", value: counts.unprocessed }
  ];

  const saveItems = (nextItems, status = "Saved locally") => {
    persistLocalItems(nextItems);
    setItems(nextItems);
    showToast(status);
  };

  const showToast = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text());
      const imported = normalizeItems(Array.isArray(parsed) ? parsed : parsed.items || []);
      if (!imported.length) {
        showToast("No items found in the JSON file.");
        return;
      }

      const merged = mergeItems(items, imported);
      persistLocalItems(merged);
      setItems(merged);
      setSelectedId(imported[0].id);
      showToast(`Imported ${imported.length} items.`);
    } catch (error) {
      showToast(`Import failed: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  };

  const markReviewed = (item) => {
    const nextItems = items.map((entry) => (entry.id === item.id ? { ...entry, status: "reviewed" } : entry));
    saveItems(nextItems, "Marked reviewed.");
  };

  const saveItem = (updatedItem) => {
    const nextItems = items.map((entry) => (entry.id === updatedItem.id ? updatedItem : entry));
    saveItems(nextItems, "Item saved.");
  };

  const addManualItem = (fields) => {
    const item = makeManualItem(fields);
    if (!item) {
      showToast("Add a valid URL first.");
      return;
    }
    const nextItems = mergeItems(items, [item]);
    persistLocalItems(nextItems);
    setItems(nextItems);
    setSelectedId(item.id);
    setView("all");
    setSearch("");
    showToast("Link added.");
  };

  const resetSampleLibrary = () => {
    const nextItems = normalizeItems(sampleItems);
    persistLocalItems(nextItems);
    setItems(nextItems);
    setSelectedId(nextItems[0]?.id ?? null);
    showToast("Sample library restored.");
  };

  const clearLibrary = () => {
    const confirmed = window.confirm("Clear the local ReelMind library from this browser?");
    if (!confirmed) return;
    persistLocalItems([]);
    setItems([]);
    setSelectedId(null);
    showToast("Local library cleared.");
  };

  return (
    <div className="app-shell">
      <Sidebar
        counts={counts}
        currentView={view}
        onViewChange={setView}
        onOpenSettings={() => settingsRef.current?.showModal()}
        onExportMarkdown={() => exportMarkdown(filteredItems)}
      />

      <main className="main-panel">
        <header className="topbar">
          <div className="search-wrap">
            <span className="search-icon" aria-hidden="true" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" aria-label="Search reels" />
          </div>
          <div className="topbar-actions">
            <input ref={fileInputRef} onChange={handleImportFile} type="file" accept="application/json,.json" hidden />
            <button className="secondary-button" type="button" onClick={resetSampleLibrary}>
              Load Sample
            </button>
            <button className="secondary-button" type="button" onClick={() => addLinkRef.current?.showModal()}>
              Add Link
            </button>
            <button className="primary-button" type="button" onClick={() => fileInputRef.current?.click()}>
              Import JSON
            </button>
          </div>
        </header>

        <StatsGrid stats={stats} />

        <section className="content-grid">
          <div className="library-panel">
            <div className="section-head">
              <div>
                <h1>{viewCopy.title}</h1>
                <p>{viewCopy.subtitle}</p>
              </div>
              <div className="sync-state online">Local only</div>
            </div>

            <CategoryFilters currentCategory={category} onCategoryChange={setCategory} />
            <ItemList items={filteredItems} selectedId={selectedItemId} onSelect={setSelectedId} />
          </div>

          <DetailPanel item={selectedItem} onMarkReviewed={markReviewed} onSaveItem={saveItem} />
        </section>
      </main>

      <LocalSettingsDialog
        ref={settingsRef}
        itemCount={items.length}
        onExportJson={() => {
          exportJson(items);
          showToast("JSON backup exported.");
        }}
        onClearLibrary={clearLibrary}
        onResetSample={resetSampleLibrary}
      />

      <AddLinkDialog ref={addLinkRef} onAddItem={addManualItem} />

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

function Sidebar({ counts, currentView, onViewChange, onOpenSettings, onExportMarkdown }) {
  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="brand">
        <div className="brand-mark">R</div>
        <div>
          <div className="brand-name">ReelMind</div>
          <div className="brand-subtitle">AI reel library</div>
        </div>
      </div>

      <nav className="nav-list">
        {Object.entries({
          dashboard: "Dashboard",
          all: "All Reels",
          mcp: "MCP Leads",
          github: "GitHub Repos",
          unprocessed: "Unprocessed"
        }).map(([id, label]) => (
          <button key={id} data-view={id} className={`nav-button ${currentView === id ? "active" : ""}`} type="button" onClick={() => onViewChange(id)}>
            <span>{label}</span>
            <span className="nav-count">{counts[id] ?? 0}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button className="ghost-button" type="button" onClick={onOpenSettings}>
          Settings
        </button>
        <button className="ghost-button" type="button" onClick={onExportMarkdown}>
          Export Markdown
        </button>
      </div>
    </aside>
  );
}

function StatsGrid({ stats }) {
  return (
    <section className="stats-grid" aria-label="Library statistics">
      {stats.map((stat) => (
        <article className="stat-card" key={stat.label}>
          <div className="stat-label">{stat.label}</div>
          <div className="stat-value">{stat.value}</div>
        </article>
      ))}
    </section>
  );
}

function CategoryFilters({ currentCategory, onCategoryChange }) {
  return (
    <div className="filter-row">
      {categoryOrder.map((entry) => (
        <button key={entry} className={`filter-chip ${entry === currentCategory ? "active" : ""}`} type="button" onClick={() => onCategoryChange(entry)}>
          {entry}
        </button>
      ))}
    </div>
  );
}

function ItemList({ items, selectedId, onSelect }) {
  if (!items.length) {
    return <div className="item-list"><div className="detail-empty">No matching reels yet. Try a broader search or import the Instagram export JSON.</div></div>;
  }

  return (
    <div className="item-list" aria-live="polite">
      {items.map((item) => {
        const tags = [...new Set([item.category, ...item.tags])].filter(Boolean).slice(0, 5);
        return (
          <button key={item.id} className={`item-row ${selectedId === item.id ? "selected" : ""}`} type="button" onClick={() => onSelect(item.id)}>
            <div className="item-row-main">
              <div className="item-title-line">
                <span className={`priority-dot ${item.priority_score >= 75 ? "hot" : ""}`} />
                <div className="item-title">{item.title || cleanTitleFromUrl(item.url)}</div>
              </div>
              <div className="item-summary">{item.summary || item.raw_text || "No summary yet."}</div>
              <div className="item-meta">
                {tags.map((tag) => (
                  <span key={tag} className={`tag ${tag.toLowerCase().includes("mcp") ? "priority" : ""}`}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            <div className="item-side">
              <span className="score">{item.priority_score}</span>
              <span>{item.source_type || "import"}</span>
              <span>{formatDate(item.saved_at || item.sent_at)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function DetailPanel({ item, onMarkReviewed, onSaveItem }) {
  if (!item) {
    return (
      <aside className="detail-panel" aria-label="Selected knowledge detail">
        <div className="detail-empty">Select a reel to inspect its links and notes.</div>
      </aside>
    );
  }

  return (
    <aside className="detail-panel" aria-label="Selected knowledge detail">
      <div className="detail-head">
        <h2>{item.title || cleanTitleFromUrl(item.url)}</h2>
        <div className="item-meta">
          <span className={`tag ${item.category === "MCP" ? "priority" : ""}`}>{item.category || "Uncategorized"}</span>
          <span className="tag amber">Score {item.priority_score}</span>
          <span className="tag">{item.status || "unprocessed"}</span>
        </div>
        <div className="detail-actions">
          <a className="primary-button" href={item.url} target="_blank" rel="noreferrer">
            {getSourceActionLabel(item.url)}
          </a>
          <button className="secondary-button" type="button" onClick={() => onMarkReviewed(item)}>
            Mark Reviewed
          </button>
        </div>
      </div>

      <div className="detail-body">
        <div className="source-box">
          <a href={item.url} target="_blank" rel="noreferrer">
            {item.url}
          </a>
        </div>

        <ItemEditForm item={item} onSaveItem={onSaveItem} />

        <DetailSection title="Extracted Links">
          {item.item_links.length ? (
            <ul className="link-list">
              {item.item_links.map((link) => (
                <li key={link.url}>
                  <a href={link.url} target="_blank" rel="noreferrer">
                    {link.url}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p>No extra links found yet.</p>
          )}
        </DetailSection>

        <DetailSection title="Raw Context">
          <p>{item.raw_text || "No raw text captured."}</p>
        </DetailSection>
      </div>
    </aside>
  );
}

function getSourceActionLabel(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("instagram.com")) return "Open in Instagram";
    if (host.includes("github.com")) return "Open GitHub";
    return "Open Source";
  } catch {
    return "Open Source";
  }
}

function ItemEditForm({ item, onSaveItem }) {
  const handleSubmit = (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSaveItem({
      ...item,
      title: String(data.get("title") || "").trim() || cleanTitleFromUrl(item.url),
      category: String(data.get("category") || "Uncategorized"),
      status: String(data.get("status") || "unprocessed"),
      summary: String(data.get("summary") || "").trim(),
      tutorial: String(data.get("tutorial") || "").trim(),
      tags: splitTags(String(data.get("tags") || ""))
    });
  };

  return (
    <form className="edit-form" key={item.id} onSubmit={handleSubmit}>
      <label>
        Title
        <input name="title" defaultValue={item.title || cleanTitleFromUrl(item.url)} />
      </label>
      <div className="edit-grid">
        <label>
          Category
          <select name="category" defaultValue={item.category || "Uncategorized"}>
            {categoryOrder.filter((entry) => entry !== "All").map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select name="status" defaultValue={item.status || "unprocessed"}>
            <option value="lead">Lead</option>
            <option value="unprocessed">Unprocessed</option>
            <option value="reviewed">Reviewed</option>
            <option value="archived">Archived</option>
          </select>
        </label>
      </div>
      <label>
        Summary
        <textarea name="summary" rows="4" defaultValue={item.summary || ""} placeholder="Short explanation of the reel/tool/repo." />
      </label>
      <label>
        Tutorial Notes
        <textarea name="tutorial" rows="4" defaultValue={item.tutorial || buildDefaultTutorial(item)} placeholder="Steps, commands, or what to try next." />
      </label>
      <label>
        Tags
        <input name="tags" defaultValue={item.tags.join(", ")} placeholder="mcp, tradingview, github" />
      </label>
      <button className="primary-button" type="submit">
        Save Notes
      </button>
    </form>
  );
}

function DetailSection({ title, children }) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function LocalSettingsDialog({ ref, itemCount, onExportJson, onClearLibrary, onResetSample }) {
  const bytes = new Blob([localStorage.getItem("reelmind.items") || ""]).size;

  return (
    <dialog className="settings-dialog" ref={ref}>
      <form method="dialog" className="settings-card">
        <div className="dialog-head">
          <div>
            <h2>Local Library</h2>
            <p>Data stays in this browser. Export JSON before clearing browser data.</p>
          </div>
          <button className="icon-button" value="close" aria-label="Close settings">
            X
          </button>
        </div>
        <div className="storage-summary">
          <div className="storage-row">
            <span>Items stored</span>
            <strong>{itemCount}</strong>
          </div>
          <div className="storage-row">
            <span>Browser storage used by library</span>
            <strong>{formatBytes(bytes)}</strong>
          </div>
          <div className="storage-note">
            Raw Instagram exports are not stored in the app. Keep them in <code>data/raw</code> and export JSON backups after important imports.
          </div>
        </div>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onResetSample}>
            Reset Sample
          </button>
          <button className="secondary-button" type="button" onClick={onClearLibrary}>
            Clear Library
          </button>
          <button className="primary-button" type="button" onClick={onExportJson}>
            Export JSON
          </button>
        </div>
      </form>
    </dialog>
  );
}

function AddLinkDialog({ ref, onAddItem }) {
  const handleSubmit = (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    onAddItem({
      url: String(data.get("url") || "").trim(),
      title: String(data.get("title") || "").trim(),
      category: String(data.get("category") || ""),
      status: String(data.get("status") || "unprocessed"),
      summary: String(data.get("summary") || "").trim(),
      tutorial: String(data.get("tutorial") || "").trim(),
      tags: String(data.get("tags") || "").trim(),
      raw_text: String(data.get("raw_text") || "").trim()
    });
    form.reset();
    ref.current?.close();
  };

  return (
    <dialog className="settings-dialog" ref={ref}>
      <form className="settings-card" onSubmit={handleSubmit}>
        <div className="dialog-head">
          <div>
            <h2>Add Link</h2>
            <p>Paste a reel, GitHub repo, docs page, or tool URL.</p>
          </div>
          <button className="icon-button" value="close" type="button" aria-label="Close add link" onClick={() => ref.current?.close()}>
            X
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
        <div className="edit-grid">
          <label>
            Category
            <select name="category" defaultValue="Uncategorized">
              {categoryOrder.filter((entry) => entry !== "All").map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select name="status" defaultValue="unprocessed">
              <option value="lead">Lead</option>
              <option value="unprocessed">Unprocessed</option>
              <option value="reviewed">Reviewed</option>
              <option value="archived">Archived</option>
            </select>
          </label>
        </div>
        <label>
          Summary
          <textarea name="summary" rows="3" placeholder="What is this about?" />
        </label>
        <label>
          Tutorial Notes
          <textarea name="tutorial" rows="3" placeholder="Steps, commands, or what to inspect later." />
        </label>
        <label>
          Tags
          <input name="tags" placeholder="mcp, tradingview, github" />
        </label>
        <label>
          Raw Context
          <textarea name="raw_text" rows="3" placeholder="Paste caption/message text if you have it." />
        </label>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={() => ref.current?.close()}>
            Cancel
          </button>
          <button className="primary-button" type="submit">
            Add Link
          </button>
        </div>
      </form>
    </dialog>
  );
}
