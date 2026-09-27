#!/usr/bin/env python3
"""data/config.json の markets に並べた指標の日次終値を取得し、data/markets.json に書き出す。

使い方:
  python3 scripts/markets.py

Yahoo Finance の chart API（非公式）を使う。取得に失敗した指標は前回の値を残し、stale: true を付ける。
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "data" / "config.json"
OUT = ROOT / "data" / "markets.json"
JST = timezone(timedelta(hours=9))
URL = "https://query1.finance.yahoo.com/v8/finance/chart/{}?range=6mo&interval=1d"


def fetch(symbol):
    req = urllib.request.Request(URL.format(urllib.parse.quote(symbol, safe="")), headers={"User-Agent": "Mozilla/5.0 tech-radar"})
    with urllib.request.urlopen(req, timeout=20) as r:
        res = json.load(r)["chart"]["result"][0]
    closes = res["indicators"]["quote"][0]["close"]
    rows = [(datetime.fromtimestamp(t, JST).strftime("%Y-%m-%d"), round(c, 4))
            for t, c in zip(res["timestamp"], closes) if c is not None]
    return rows


def pct(a, b):
    return round((a - b) / b * 100, 2) if b else None


def main():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    prev = {m["symbol"]: m for m in json.loads(OUT.read_text(encoding="utf-8")).get("series", [])} if OUT.exists() else {}
    out, failed = [], []
    for m in cfg.get("markets", []):
        try:
            rows = fetch(m["symbol"])
            closes = [c for _, c in rows]
            last = closes[-1]
            out.append({
                **m, "date": rows[-1][0], "last": last,
                "d1": pct(last, closes[-2]) if len(closes) > 1 else None,
                "w1": pct(last, closes[-6]) if len(closes) > 5 else None,
                "m1": pct(last, closes[-22]) if len(closes) > 21 else None,
                "dates": [d for d, _ in rows], "closes": closes, "stale": False,
            })
        except Exception as e:  # noqa: BLE001 — 1 指標の失敗で全体を止めない
            failed.append(m["symbol"])
            print(f"[failed] {m['symbol']}: {e}", file=sys.stderr)
            if m["symbol"] in prev:
                out.append({**prev[m["symbol"]], "stale": True})
        time.sleep(0.5)
    OUT.write_text(json.dumps({"updated_at": datetime.now(JST).isoformat(timespec="seconds"), "series": out},
                              ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"data/markets.json: {len(out) - len(failed)} ok, failed={failed}")


if __name__ == "__main__":
    main()
