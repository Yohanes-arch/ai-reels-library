from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
import argparse
import json
import re
import tempfile
import zipfile


URL_RE = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)
REEL_HINTS = ("/reel/", "/p/", "/tv/")
PRIORITY_KEYWORDS = {
    "tradingview": 35,
    "mcp": 35,
    "model context protocol": 35,
    "github.com": 18,
    "scanner": 10,
    "indicator": 10,
    "technical recommendation": 12,
    "idx": 12,
    "pine": 8,
    "trading": 8,
}


@dataclass
class Item:
    url: str
    source_type: str
    source_account: str
    source_path: str
    saved_at: str | None
    sent_at: str | None
    collection_name: str
    raw_text: str
    title: str
    category: str
    summary: str
    tutorial: str
    tags: list[str]
    priority_score: int
    status: str
    item_links: list[dict[str, str]]


def main() -> int:
    parser = argparse.ArgumentParser(description="Normalize Instagram export JSON into ReelMind import JSON.")
    parser.add_argument("--input", required=True, help="Instagram export ZIP or extracted folder.")
    parser.add_argument("--out", default="data/processed/reels-normalized.json", help="Output JSON path.")
    args = parser.parse_args()

    input_path = Path(args.input)
    out_path = Path(args.out)
    items = parse_export(input_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "source": str(input_path),
                "count": len(items),
                "items": [asdict(item) for item in items],
            },
            ensure_ascii=True,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"wrote {len(items)} items to {out_path}")
    return 0


def parse_export(path: Path) -> list[Item]:
    if path.is_file() and path.suffix.lower() == ".zip":
        with tempfile.TemporaryDirectory(prefix="reelmind-instagram-") as tmp:
            with zipfile.ZipFile(path) as archive:
                archive.extractall(tmp)
            return parse_folder(Path(tmp))
    if path.is_dir():
        return parse_folder(path)
    if path.is_file() and path.suffix.lower() == ".json":
        data = read_json(path)
        return dedupe_items(extract_items(data, path.name))
    raise ValueError(f"Unsupported input: {path}")


def parse_folder(folder: Path) -> list[Item]:
    items: list[Item] = []
    for file_path in folder.rglob("*.json"):
        try:
            data = read_json(file_path)
        except Exception as exc:
            print(f"skip {file_path}: {exc}")
            continue
        rel_path = str(file_path.relative_to(folder)).replace("\\", "/")
        items.extend(extract_items(data, rel_path))
    return dedupe_items(items)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def extract_items(data: Any, source_path: str) -> list[Item]:
    candidates: list[tuple[str, dict[str, Any], str]] = []
    walk(data, {}, source_path, candidates)
    items: list[Item] = []
    for url, context, raw_text in candidates:
        cleaned_url = clean_url(url)
        if "instagram.com" not in cleaned_url and "github.com" not in cleaned_url and "tradingview.com" not in cleaned_url:
            continue
        if "instagram.com" in cleaned_url and not any(hint in cleaned_url for hint in REEL_HINTS):
            continue
        extracted_links = [clean_url(link) for link in extract_urls(raw_text) if clean_url(link) != cleaned_url]
        text_blob = " ".join([raw_text, cleaned_url, " ".join(extracted_links)])
        score = score_priority(text_blob)
        category = infer_category(text_blob)
        title = infer_title(context, raw_text, cleaned_url)
        item = Item(
            url=cleaned_url,
            source_type=infer_source_type(source_path),
            source_account=str(context.get("sender_name") or context.get("sender") or context.get("source_account") or ""),
            source_path=source_path,
            saved_at=infer_datetime(context, ("saved_on", "saved_at", "timestamp", "timestamp_ms")) if "saved" in source_path.lower() else None,
            sent_at=infer_datetime(context, ("timestamp_ms", "timestamp", "sent_at", "date")) if "message" in source_path.lower() else None,
            collection_name=str(context.get("collection_name") or context.get("title") or ""),
            raw_text=raw_text[:4000],
            title=title,
            category=category,
            summary="",
            tutorial="",
            tags=infer_tags(text_blob),
            priority_score=score,
            status="lead" if score >= 75 else "unprocessed",
            item_links=[url_to_link(link) for link in extracted_links],
        )
        items.append(item)
    return dedupe_items(items)


def walk(value: Any, context: dict[str, Any], source_path: str, candidates: list[tuple[str, dict[str, Any], str]]) -> None:
    if isinstance(value, dict):
        next_context = context.copy()
        for key, item in value.items():
            normalized_key = normalize_key(key)
            if isinstance(item, (str, int, float)) and normalized_key in {
                "sender_name",
                "sender",
                "timestamp_ms",
                "timestamp",
                "saved_on",
                "title",
                "collection_name",
                "href",
                "value",
                "text",
                "content",
            }:
                next_context[normalized_key] = item
        raw_text = flatten_text(value)
        for url in extract_urls(raw_text):
            candidates.append((url, next_context, raw_text))
        for item in value.values():
            walk(item, next_context, source_path, candidates)
    elif isinstance(value, list):
        for item in value:
            walk(item, context, source_path, candidates)
    elif isinstance(value, str):
        for url in extract_urls(value):
            candidates.append((url, context, value))


def flatten_text(value: Any) -> str:
    parts: list[str] = []

    def collect(item: Any) -> None:
        if isinstance(item, dict):
            for key, child in item.items():
                if normalize_key(key) in {"content", "text", "title", "value", "href", "url", "link"}:
                    collect(child)
        elif isinstance(item, list):
            for child in item:
                collect(child)
        elif isinstance(item, (str, int, float)):
            text = str(item).strip()
            if text:
                parts.append(text)

    collect(value)
    return " ".join(parts)


def extract_urls(text: str) -> list[str]:
    return [match.rstrip(").,;") for match in URL_RE.findall(text or "")]


def clean_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if not parsed.scheme or not parsed.netloc:
        return url.strip()
    drop = {"utm_source", "utm_medium", "utm_campaign", "igsh", "igshid"}
    query = urlencode([(key, value) for key, value in parse_qsl(parsed.query) if key not in drop])
    cleaned = parsed._replace(query=query, fragment="")
    return urlunparse(cleaned).rstrip("/")


def dedupe_items(items: list[Item]) -> list[Item]:
    by_url: dict[str, Item] = {}
    for item in items:
        old = by_url.get(item.url)
        if not old:
            by_url[item.url] = item
            continue
        old.raw_text = longest(old.raw_text, item.raw_text)
        old.priority_score = max(old.priority_score, item.priority_score)
        old.status = "lead" if old.priority_score >= 75 else old.status
        old.tags = sorted(set(old.tags + item.tags))
        link_urls = {link["url"] for link in old.item_links}
        old.item_links.extend([link for link in item.item_links if link["url"] not in link_urls])
    return sorted(by_url.values(), key=lambda item: item.priority_score, reverse=True)


def infer_source_type(source_path: str) -> str:
    lowered = source_path.lower()
    if "message" in lowered or "inbox" in lowered:
        return "instagram-dm"
    if "saved" in lowered:
        return "instagram-saved"
    return "instagram-export"


def infer_datetime(context: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = context.get(key)
        if value is None:
            continue
        if key == "timestamp_ms":
            try:
                return datetime.fromtimestamp(float(value) / 1000, timezone.utc).isoformat()
            except Exception:
                continue
        text = str(value).strip()
        if text:
            return text
    return None


def infer_title(context: dict[str, Any], raw_text: str, url: str) -> str:
    for key in ("title", "collection_name", "text", "content"):
        value = str(context.get(key) or "").strip()
        if value and not value.startswith("http"):
            return " ".join(value.split()[:10])
    if raw_text:
        without_urls = URL_RE.sub("", raw_text).strip()
        if without_urls:
            return " ".join(without_urls.split()[:10])
    parsed = urlparse(url)
    parts = [part for part in parsed.path.split("/") if part]
    return " / ".join(parts) if parts else parsed.netloc


def infer_category(text: str) -> str:
    lowered = text.lower()
    if "mcp" in lowered or "model context protocol" in lowered:
        return "MCP"
    if any(word in lowered for word in ("tradingview", "idx", "indicator", "scanner", "pine")):
        return "Trading"
    if "github.com" in lowered or " repo" in lowered:
        return "GitHub"
    if "agent" in lowered:
        return "AI Agents"
    if any(word in lowered for word in ("cursor", "codex", "cline", "coding")):
        return "Coding Tools"
    if any(word in lowered for word in ("n8n", "zapier", "automation")):
        return "Automation"
    if "video" in lowered:
        return "Video AI"
    return "Uncategorized"


def infer_tags(text: str) -> list[str]:
    lowered = text.lower()
    tags = ["mcp", "tradingview", "github", "idx", "agent", "automation", "coding", "video", "scanner", "indicator"]
    return [tag for tag in tags if tag in lowered]


def score_priority(text: str) -> int:
    lowered = text.lower()
    score = sum(weight for keyword, weight in PRIORITY_KEYWORDS.items() if keyword in lowered)
    return min(100, score)


def url_to_link(url: str) -> dict[str, str]:
    host = urlparse(url).netloc.replace("www.", "")
    if "github.com" in host:
        link_type = "github"
    elif "tradingview.com" in host:
        link_type = "trading"
    else:
        link_type = "tool"
    return {"url": url, "host": host, "link_type": link_type, "label": host}


def normalize_key(key: str) -> str:
    return key.strip().lower().replace(" ", "_")


def longest(a: str, b: str) -> str:
    return a if len(a or "") >= len(b or "") else b


if __name__ == "__main__":
    raise SystemExit(main())
