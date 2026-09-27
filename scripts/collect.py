#!/usr/bin/env python3
"""data/config.json の sources / releases から候補記事を集め、data/raw/YYYY-MM-DD.json に書き出す。

使い方:
  python3 scripts/collect.py [--hours 36] [--dry-run] [YYYY-MM-DD]

標準ライブラリのみ。取得できなかったソースは source_status に "failed" と記録して続行する。
出力はルーチンが要約・選別するための下書きで、サイトはこのファイルを読まない（.gitignore 済み）。

リリース情報は `git ls-remote --tags` でタグ一覧を取り、data/state/tags.json（前回までに見たタグ）との差分を
新しいリリースとして扱う（github.com の Atom/API はルーチン環境から取得できないため）。
"""
import argparse
import html
import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "data" / "config.json"
RAW_DIR = ROOT / "data" / "raw"
TAGS_STATE = ROOT / "data" / "state" / "tags.json"
DEFAULT_TAG_PATTERN = r"^v?\d+\.\d+(\.\d+)?$"
JST = timezone(timedelta(hours=9))
UA = "tech-radar/1.0 (+https://github.com/ke-iwata/tech-research)"


def fetch(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def parse_date(s):
    if not s:
        return None
    s = s.strip()
    try:
        d = parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d


def strip_tags(s, limit=400):
    s = html.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    s = re.sub(r"\s+", " ", s).strip()
    return s[:limit]


def local(tag):
    return tag.rsplit("}", 1)[-1]


def parse_feed(raw):
    """RSS 2.0 / RSS 1.0 (RDF) / Atom を [{title, url, published, summary}] にする"""
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        # 「&」のエスケープ漏れなど、よくある壊れ方だけ直して再挑戦する
        text = raw.decode("utf-8", "replace")
        text = re.sub(r"&(?!#?\w+;)", "&amp;", text)
        root = ET.fromstring(text.encode("utf-8"))
    out = []
    for el in root.iter():
        name = local(el.tag)
        if name not in ("item", "entry"):
            continue
        rec = {"title": "", "url": "", "published": None, "summary": ""}
        for c in el:
            n = local(c.tag)
            if n == "title":
                rec["title"] = strip_tags(c.text or "", 300)
            elif n == "link":
                href = c.get("href")
                if href and c.get("rel", "alternate") == "alternate":
                    rec["url"] = href
                elif not href and c.text:
                    rec["url"] = c.text.strip()
            elif n in ("pubDate", "published", "updated", "date") and not rec["published"]:
                rec["published"] = parse_date(c.text)
            elif n in ("description", "summary", "content", "encoded") and not rec["summary"]:
                rec["summary"] = strip_tags(c.text or "")
        if rec["title"] and rec["url"]:
            out.append(rec)
    return out


def categorize(text, categories):
    t = text.lower()
    best, best_hits = None, 0
    for c in categories:
        hits = sum(1 for h in c["hints"] if re.search(r"(?<![a-z])" + re.escape(h.lower()) + r"(?![a-z])", t))
        if hits > best_hits:
            best, best_hits = c["id"], hits
    return best


def interest_hits(text, interests):
    """英数字のキーワードは単語境界で照合する（"go" が "Google" に当たらないように）"""
    t = text.lower()
    hits = []
    for k in interests:
        k2 = k.lower()
        pat = r"(?<![a-z0-9])" + re.escape(k2) + r"(?![a-z0-9])" if re.fullmatch(r"[a-z0-9 .+-]+", k2) else re.escape(k2)
        if re.search(pat, t):
            hits.append(k)
    return hits


def collect_rss(src, since):
    items = []
    for e in parse_feed(fetch(src["url"])):
        if e["published"] and e["published"] < since:
            continue
        items.append({
            "title": e["title"], "url": e["url"], "summary": e["summary"],
            "published_at": e["published"].astimezone(JST).isoformat() if e["published"] else None,
        })
    return items


def collect_hn(src, since):
    q = urllib.parse.urlencode({
        "tags": "story",
        "numericFilters": f"created_at_i>{int(since.timestamp())},points>={src.get('min_points', 100)}",
        "hitsPerPage": 50,
    })
    data = json.loads(fetch("https://hn.algolia.com/api/v1/search?" + q))
    items = []
    for h in data.get("hits", []):
        url = h.get("url") or f"https://news.ycombinator.com/item?id={h['objectID']}"
        items.append({
            "title": h.get("title", ""), "url": url, "summary": "",
            "published_at": datetime.fromtimestamp(h["created_at_i"], JST).isoformat(),
            "signal": f"▲ {h.get('points', 0)}",
            "discussion": f"https://news.ycombinator.com/item?id={h['objectID']}",
            "comments": h.get("num_comments", 0),
        })
    return items


def version_key(tag):
    return tuple(int(n) for n in re.findall(r"\d+", tag))


def remote_tags(repo, pattern):
    out = subprocess.run(["git", "ls-remote", "--tags", "--refs", f"https://github.com/{repo}"],
                         capture_output=True, text=True, timeout=120, check=True).stdout
    tags = [line.split("refs/tags/", 1)[1] for line in out.splitlines() if "refs/tags/" in line]
    return sorted((t for t in tags if re.search(pattern, t)), key=version_key)


def collect_releases(rel, known, today):
    """前回見たタグとの差分を返す。初回は最新タグ 1 件だけを返す"""
    tags = remote_tags(rel["repo"], rel.get("tag_pattern", DEFAULT_TAG_PATTERN))
    before = set(known.get(rel["repo"], []))
    new = [t for t in tags if t not in before] if before else tags[-1:]
    known[rel["repo"]] = tags[-30:]
    return [{
        "repo": rel["repo"], "tag": t, "title": f"{rel['repo'].split('/')[-1]} {t}",
        "url": f"https://github.com/{rel['repo']}/releases/tag/{t}", "category": rel["category"],
        "date": today, "first_run": not before,
    } for t in new[-5:]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("date", nargs="?")
    ap.add_argument("--hours", type=int, default=36, help="何時間前までの記事を集めるか")
    ap.add_argument("--dry-run", action="store_true", help="data/state/tags.json を更新しない")
    args = ap.parse_args()

    now = datetime.now(JST)
    day = args.date or now.strftime("%Y-%m-%d")
    since = now - timedelta(hours=args.hours)
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    cats, interests = cfg["categories"], cfg.get("interests", [])

    status, items, seen = {}, [], set()
    for src in cfg["sources"]:
        try:
            got = collect_hn(src, since) if src["kind"] == "hn" else collect_rss(src, since)
            status[src["id"]] = {"status": "ok", "count": len(got)}
        except Exception as e:  # noqa: BLE001 — どのソースが落ちても他は続ける
            status[src["id"]] = {"status": "failed", "error": str(e)[:200]}
            print(f"[failed] {src['id']}: {e}", file=sys.stderr)
            continue
        for it in got:
            key = it["url"].split("#")[0].rstrip("/")
            if key in seen:
                continue
            seen.add(key)
            text = it["title"] + " " + it.get("summary", "")
            own = [c for c in cats if c["domain"] == src["domain"]]
            it.update({
                "source": src["name"], "source_id": src["id"], "source_group": src["group"], "domain": src["domain"],
                "category_guess": categorize(text, own) or categorize(text, cats),
                "interest_hits": interest_hits(text, interests),
            })
            items.append(it)

    releases = []
    known = json.loads(TAGS_STATE.read_text(encoding="utf-8")) if TAGS_STATE.exists() else {}
    for rel in cfg.get("releases", []):
        try:
            got = collect_releases(rel, known, day)
            releases += got
            status["release:" + rel["repo"]] = {"status": "ok", "count": len(got)}
        except Exception as e:  # noqa: BLE001
            status["release:" + rel["repo"]] = {"status": "failed", "error": str(e)[:200]}
    if not args.dry_run:
        TAGS_STATE.parent.mkdir(parents=True, exist_ok=True)
        TAGS_STATE.write_text(json.dumps(known, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    items.sort(key=lambda x: (len(x["interest_hits"]), x.get("published_at") or ""), reverse=True)
    groups = {}
    for it in items:
        groups[it["source_group"]] = groups.get(it["source_group"], 0) + 1
    out = {
        "group_counts": groups,
        "date": day, "collected_at": now.isoformat(timespec="seconds"), "since": since.isoformat(timespec="seconds"),
        "source_status": status, "count": len(items), "items": items, "releases": releases,
    }
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    path = RAW_DIR / f"{day}.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    ok = sum(1 for s in status.values() if s["status"] == "ok")
    print(f"{path.relative_to(ROOT)}: {len(items)} items, {len(releases)} releases, sources ok {ok}/{len(status)}")


if __name__ == "__main__":
    main()
