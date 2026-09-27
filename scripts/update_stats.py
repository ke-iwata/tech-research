#!/usr/bin/env python3
"""data/daily/*.json を検証し、サイト用の集計 data/stats.json を作り直す。

使い方:
  python3 scripts/update_stats.py              検証＋stats.json 再生成
  python3 scripts/update_stats.py --check-only 検証のみ（ファイルは変更しない）
エラーがあれば非ゼロで終了する。

stats.json の中身:
  dates     … 日次ファイルの日付（新しい順）。アーカイブの選択肢
  days      … 日ごとの件数・分野別件数（直近 90 日）
  keywords  … キーワードごとの日次言及数（直近 84 日）、直近 7 日 / 前 7 日の合計、前週比、
              レーダーのリング（HOT / RISING / WATCH / COOLING）と先週からの移動
"""
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DAILY = ROOT / "data" / "daily"
CONFIG = ROOT / "data" / "config.json"
STATS = ROOT / "data" / "stats.json"

NETWORKS = {"x", "bluesky", "hn", "hatena", "reddit", "other"}
KEYWORD_RE = re.compile(r"^[a-z0-9][a-z0-9.+#→/-]*$")
SERIES_DAYS = 84
DAYS_KEPT = 90


def err_list(errors, where, msg):
    errors.append(f"{where}: {msg}")


def is_url(u):
    return isinstance(u, str) and u.startswith(("https://", "http://"))


def validate_day(path, d, cats):
    e = []
    w = path.name
    if d.get("date") != path.stem:
        err_list(e, w, f"date が {path.stem} ではありません")
    for k in ("generated_at", "digest", "items", "social", "releases", "stats"):
        if k not in d:
            err_list(e, w, f"'{k}' がありません")
    if e:
        return e
    if not 1 <= len(d["digest"]) <= 5:
        err_list(e, w, "digest は 1〜5 件")
    for i, g in enumerate(d["digest"]):
        if g.get("category") not in cats:
            err_list(e, f"{w} digest[{i}]", f"category は {sorted(cats)} のいずれか")
        if not g.get("text"):
            err_list(e, f"{w} digest[{i}]", "text がありません")
    ids = set()
    for i, it in enumerate(d["items"]):
        where = f"{w} items[{i}] ({it.get('id')})"
        for k in ("id", "title", "url", "source", "source_group", "category", "keywords", "score", "tldr"):
            if it.get(k) in (None, "", []) and k != "keywords":
                err_list(e, where, f"'{k}' がありません")
        if it.get("id") in ids:
            err_list(e, where, "id が重複しています")
        ids.add(it.get("id"))
        if not is_url(it.get("url")):
            err_list(e, where, "url は http(s) の URL")
        if it.get("category") not in cats:
            err_list(e, where, f"category は {sorted(cats)} のいずれか")
        if not isinstance(it.get("score"), int) or not 0 <= it["score"] <= 100:
            err_list(e, where, "score は 0〜100 の整数")
        for kw in it.get("keywords", []):
            if not KEYWORD_RE.match(kw):
                err_list(e, where, f"keyword '{kw}' は小文字・数字・ハイフンの slug にする")
        code = it.get("code")
        if code is not None and not (isinstance(code, dict) and code.get("text")):
            err_list(e, where, "code は null か {file, lang, text}")
    for i, s in enumerate(d["social"]):
        where = f"{w} social[{i}]"
        if s.get("network") not in NETWORKS:
            err_list(e, where, f"network は {sorted(NETWORKS)} のいずれか")
        if not is_url(s.get("url")):
            err_list(e, where, "url は投稿そのものの URL")
        if not s.get("text"):
            err_list(e, where, "text がありません")
        if s.get("category") not in cats:
            err_list(e, where, "category が不正です")
    for i, r in enumerate(d["releases"]):
        if not is_url(r.get("url")) or not r.get("title") or r.get("category") not in cats:
            err_list(e, f"{w} releases[{i}]", "url / title / category を確認してください")
    return e


def ring_of(c7, p7, rank_pct):
    if p7 > 0 and c7 <= p7 * 0.8:
        return "COOLING"
    if rank_pct <= 0.15 and c7 >= 3:
        return "HOT"
    if (p7 == 0 and c7 >= 2) or (p7 > 0 and c7 >= p7 * 1.3):
        return "RISING"
    return "WATCH"


def rings(series_by_kw, end):
    """end 番目（含む）までの直近 7 日と、その前 7 日でリングを決める"""
    sums = {k: (sum(s[max(0, end - 6):end + 1]), sum(s[max(0, end - 13):max(0, end - 6)])) for k, s in series_by_kw.items()}
    active = sorted((k for k, (c, _) in sums.items() if c > 0), key=lambda k: -sums[k][0])
    out = {}
    for rank, k in enumerate(active):
        c7, p7 = sums[k]
        out[k] = ring_of(c7, p7, rank / max(1, len(active)))
    for k, (c7, p7) in sums.items():
        if c7 == 0 and p7 > 0:
            out[k] = "COOLING"
    return out, sums


def build(days_data):
    latest = max(days_data)
    end_day = date.fromisoformat(latest)
    axis = [(end_day - timedelta(days=SERIES_DAYS - 1 - i)).isoformat() for i in range(SERIES_DAYS)]
    idx = {d: i for i, d in enumerate(axis)}

    counts = defaultdict(lambda: [0] * SERIES_DAYS)
    kw_cat = defaultdict(Counter)
    first_seen = {}
    for day in sorted(days_data):
        d = days_data[day]
        for rec in d["items"] + d["social"]:
            for kw in set(rec.get("keywords", [])):
                kw_cat[kw][rec["category"]] += 1
                first_seen.setdefault(kw, day)
                if day in idx:
                    counts[kw][idx[day]] += 1

    now_ring, sums = rings(counts, SERIES_DAYS - 1)
    prev_ring, _ = rings(counts, SERIES_DAYS - 8)
    history_days = len([d for d in days_data if d in idx])
    keywords = []
    for kw, s in counts.items():
        c7, p7 = sums[kw]
        if c7 == 0 and p7 == 0:
            continue
        r, pr = now_ring.get(kw), prev_ring.get(kw)
        order = ["COOLING", "WATCH", "RISING", "HOT"]
        if pr is None:
            move = "new"
        elif r == pr:
            move = "stay"
        else:
            move = "up" if order.index(r) > order.index(pr) else "down"
        keywords.append({
            "kw": kw, "category": kw_cat[kw].most_common(1)[0][0], "series": s, "c7": c7, "p7": p7,
            "wow": round((c7 - p7) / p7 * 100) if p7 else None,
            "first_seen": first_seen[kw], "ring": r, "prev_ring": pr, "move": move,
        })
    keywords.sort(key=lambda k: (-k["c7"], -k["p7"], k["kw"]))

    days = []
    for day in sorted(days_data)[-DAYS_KEPT:]:
        d = days_data[day]
        days.append({
            "date": day,
            "collected": d["stats"].get("collected", len(d["items"])),
            "items": len(d["items"]),
            "picks": sum(1 for it in d["items"] if it.get("pick")),
            "sources": d["stats"].get("sources_ok"),
            "by_category": dict(Counter(it["category"] for it in d["items"] + d["social"])),
            "keywords_new": sum(1 for k, v in first_seen.items() if v == day),
        })
    return {
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "latest": latest,
        "dates": sorted(days_data, reverse=True),
        "history_days": history_days,
        "series_start": axis[0],
        "days": days,
        "keywords": keywords,
    }


def main():
    check_only = "--check-only" in sys.argv
    cats = {c["id"] for c in json.loads(CONFIG.read_text(encoding="utf-8"))["categories"]}
    errors, days_data = [], {}
    for p in sorted(DAILY.glob("*.json")):
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", p.stem):
            errors.append(f"{p.name}: ファイル名は YYYY-MM-DD.json")
            continue
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError as ex:
            errors.append(f"{p.name}: JSON が壊れています ({ex})")
            continue
        errors += validate_day(p, d, cats)
        days_data[p.stem] = d
    if not days_data:
        errors.append("data/daily/ に日次ファイルがありません")
    if errors:
        print("\n".join("ERROR " + x for x in errors), file=sys.stderr)
        sys.exit(1)
    stats = build(days_data)
    if check_only:
        print(f"ok: {len(days_data)} days, {len(stats['keywords'])} keywords")
        return
    STATS.write_text(json.dumps(stats, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    hot = [k["kw"] for k in stats["keywords"] if k["ring"] == "HOT"][:5]
    print(f"data/stats.json: {len(days_data)} days, {len(stats['keywords'])} keywords, HOT={hot}")


if __name__ == "__main__":
    main()
