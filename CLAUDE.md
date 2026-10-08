# tech-radar

技術（AI・バックエンド・インフラ・セキュリティ）と金融・投資（マクロ・株式・投資信託・仮想通貨・不動産）の情報を毎日集めて、
GitHub Pages のダッシュボード（`index.html`）を更新するリポジトリ。
サイトはビルド不要の静的 HTML で、`data/*.json` を読んで表示する。

**このリポジトリは public。** 持ち主の個人情報（氏名・住所・勤務先・資産額・保有銘柄・年収など）は、ファイルにもコミットメッセージにも絶対に書かないこと。
投資の話題は「情報の要約」にとどめ、売買の推奨や断定的な相場予想は書かない。

---

## 日次更新ルーチン

Claude Code のルーチンから「CLAUDE.md の日次更新ルーチンを実行して」と呼ばれたら、以下を上から順に実行する。
無人実行なので質問はせず、判断した前提は digest や note に書く。今日の日付を D（Asia/Tokyo、`YYYY-MM-DD`）とする。

### 0. 最新の main から始める

**更新は main に直接 push する。** 作業ブランチ（`claude/…`）に push しただけでは Pages の公開に失敗することがあるため、必ず main を更新する。

```bash
git fetch origin main
git checkout -B main origin/main         # セッションが claude/… ブランチで始まっていても main で作業する
```

### 1. 収集（スクリプト）

```bash
python3 scripts/collect.py      # RSS・Hacker News・GitHub タグ → data/raw/D.json（コミットしない）と data/state/tags.json
python3 scripts/markets.py      # 株価指数・為替・金利・暗号資産 → data/markets.json
```

- `data/raw/D.json` の `items` は候補。`category_guess` と `interest_hits` はキーワード照合による目安なので、最終的な分類は自分で判断する
- `source_status` で `failed` のソースは、`data/daily/D.json` の `stats.failed_sources` に列挙する（深追いしない）
- `releases` は git タグの差分から作った新しいリリース。`first_run: true` は初回取得（＝現時点の最新版）なので `kind: "release"`、note に「初回取得・現在の最新版」と書く

### 2. SNS・コミュニティ（WebSearch）

`data/config.json` の `social_queries` を、技術・マネーそれぞれ 2〜3 本ずつ WebSearch する（`allowed_domains` 例：`x.com`, `bsky.app`, `news.ycombinator.com`, `b.hatena.ne.jp`, `reddit.com`）。

- 投稿そのものの URL が取れて、本文が確認できたものだけを `social` に入れる（1 日 3〜8 件）。取れなければ空配列でよい
- `text` は投稿の要点を 1〜2 文で。長文の転載はしない
- `author` は公開アカウント名（`@...`）。取れなければ `null`
- `metrics`（例 `♥ 1,240  ⟲ 312`、`▲ 643  ✉ 218`）と `heat`（0〜100、反応の大きさの目安）は分かる範囲で。分からなければ `null`
- X / Bluesky の投稿 URL が取れない日は、raw の Hacker News 候補のうち `items` に入れた記事の議論スレッド（`discussion`）を `network: "hn"` で入れてよい。`text` は「『タイトル』のスレッド。N 件のコメント」のように事実だけ書き、`heat` は `min(100, ポイント / 4)` を目安にする

### 2b. マネー系の補完（WebSearch）

マネー系の RSS は政治・生活の記事が多く、株式・投資信託・不動産の話題が薄い。次の 3 つを WebSearch で 1 本ずつ調べ、その日のニュースがあれば `items` に加える（1〜2 件ずつ）。

- 株式：前営業日の日経平均・米国株の終値と主な材料（例「日経平均 終値 M月D日」）
- 投資信託・NISA：資金流入や新商品・信託報酬の引き下げ（例「投資信託 資金流入 YYYY年M月」）
- 不動産：住宅ローン金利・マンション価格・J-REIT（例「住宅ローン金利 M月 予想」）

検索結果の要約しか読めなかった記事は `pick` にせず、`tldr` は確認できた事実だけにする。本文が有料・ブロックで読めない場合も同じ。

### 3. 選別・要約（WebFetch）

raw の候補から、技術・マネーそれぞれ 8〜15 件、合計 15〜30 件を選んで `items` にする。

- 選ぶ基準：`interests` との一致 > 反応の大きさ（はてブ数・HN ポイント）> 新規性。同じ話題は 1 件にまとめる
- 公式発表（日本銀行・金融庁）は重要度が高いものを優先的に入れる
- そのうち 6〜10 件を `pick: true`（ピックアップ）にする。技術・マネーの両方から選ぶ
- **pick の記事は WebFetch で本文を読み**、`tldr`（2〜3 文）・`points`（3 点）を書く。技術記事で本文にコードがあれば、要点を示す 3〜12 行を `code` に抜き出す（なければ `null`）
- pick 以外の記事は RSS の要約とタイトルから `tldr` を 1〜2 文で書く（`points` は空配列でよい）。本文を読んでいないのに具体的な数字や結論を書かない
- `score`（0〜100）は持ち主の関心との一致度。`why` にその理由を短く（例 `matched: go, 認可` / `日銀の公式発表`）
- `keywords`：記事ごとに 1〜4 個。**小文字・数字・ハイフンの slug**（例 `mcp-server`, `pgvector`, `new-nisa`, `boj-rate-hike`, `bitcoin`, `j-reit`）。過去の日次ファイルや `data/stats.json` にある既存の slug を優先して使い、表記ゆれを作らない（レーダーとマーケットマップはこの slug で集計する）
- 金融記事は `why` や `tldr` で売買を勧めない。事実と論点の要約にとどめる

### 4. `data/daily/D.json` を書く

```json
{
  "date": "2026-09-28",
  "generated_at": "2026-09-28T06:12:00+09:00",
  "stats": {
    "collected": 161,                         // raw の count
    "sources_ok": 26, "sources_total": 27,
    "by_group": {"tech_blog": 60, "news": 50, "hackernews": 26, "official": 3},   // raw の group_counts
    "failed_sources": ["morningstar"]
  },
  "digest": [                                 // 今日の要点。技術・マネー合わせて 3〜5 件
    {"category": "ai", "text": "…を 1〜2 文で", "keywords": ["mcp-server"]}
  ],
  "items": [
    {
      "id": "2026-09-28-zenn-mcp-authz",      // D-ソース-短い英字。日内で一意
      "url": "https://…", "title": "…", "source": "zenn.dev", "source_group": "tech_blog",
      "published_at": "2026-09-28T03:00:00+09:00",
      "category": "ai",                       // config.json の categories[].id
      "keywords": ["mcp-server", "oauth"],
      "score": 92, "why": "matched: 認可, go", "read_min": 12,
      "tldr": "…", "points": ["…", "…", "…"],
      "code": {"file": "server.go", "lang": "go", "text": "…"},   // なければ null
      "signal": "B! 186",                     // はてブ数・HN ポイントなど。なければ null
      "pick": true
    }
  ],
  "social": [
    {"network": "x", "author": "@…", "url": "https://x.com/…/status/…", "text": "…", "metrics": "♥ 1,240", "heat": 80,
     "category": "ai", "keywords": ["mcp-server"], "posted_at": "2026-09-28T09:12:00+09:00"}
  ],
  "releases": [
    {"date": "2026-09-28", "title": "pgvector v0.8.6", "repo": "pgvector/pgvector", "url": "https://github.com/…",
     "kind": "release", "note": "…", "category": "be"}
  ]
}
```

- `network` は `x` / `bluesky` / `hn` / `hatena` / `reddit` / `other`
- `releases.kind` は `release`（OSS のリリース）/ `policy`（日銀・金融庁などの制度・政策の発表）/ `event`（予定されているイベント。決算発表日・FOMC・勉強会など）
- 日銀の金融政策決定会合・FOMC・米雇用統計などの予定が 1 週間以内にあれば `kind: "event"` で入れてよい（日付を確認できたものだけ）
- 取得できない項目は `null`。推測で埋めない

### 5. 検証・集計・コミット・push

```bash
python3 scripts/update_stats.py        # 日次ファイルを検証して data/stats.json を再生成。エラーなら直してやり直す
git add -A
git commit -m "data: D 日次更新（記事N件・pickN件）"
git push origin HEAD:main                # main を更新する（これで Actions が Pages に公開する）
```

- push が拒否されたら `git pull --rebase origin main` してから `python3 scripts/update_stats.py` をやり直し、もう一度 `git push origin HEAD:main` する
- それでも main に push できないとき（権限エラーなど）だけ、`claude/` で始まるブランチに push する。Actions が main にマージして公開するが、main の更新に失敗した旨とエラー全文を最終メッセージに書く

- `data/raw/` は `.gitignore` 済み（コミットしない）。`data/state/tags.json` はコミットする
- 最後に digest と pick の一覧を最終メッセージとして出力する

---

## ファイル構成

| パス | 内容 |
|---|---|
| `index.html`, `assets/app.js`, `assets/style.css` | ダッシュボード（白地・黒罫・黄色の「DAILY」ポスター様式）。`#today`（今日のブリーフ。上段の輪からストーリー形式で要点・pick・レーダー・予定・SNS を全画面で読める）/ `#reader`（キーボード操作で読むリーダー）/ `#radar`（キーワード・レーダー＋リング別一覧）/ `#market`（市況とキーワードのマーケットマップ）の 4 画面。右上で tech / money を切り替え、`[` `]` で前日・翌日。スマホは下タブ |
| `data/config.json` | 分野（categories・quadrants）、関心キーワード（interests）、収集元（sources・releases・markets）、SNS 検索語 |
| `data/daily/YYYY-MM-DD.json` | 日次ファイル（ルーチンが書く） |
| `data/stats.json` | 日次ファイルから集計したキーワードの推移・リングなど（`update_stats.py` が生成。手で書かない） |
| `data/markets.json` | 市況（`markets.py` が生成） |
| `data/state/tags.json` | 監視している OSS の既知タグ（`collect.py` が更新） |
| `scripts/collect.py` | RSS / HN / git タグの収集 |
| `scripts/markets.py` | Yahoo Finance chart API から終値を取得 |
| `scripts/update_stats.py` | 検証と集計 |
| `.github/workflows/pages.yml` | claude/** → main マージと Pages デプロイ |

## レーダーのリング（`update_stats.py`）

キーワードごとに直近 7 日（c7）と前 7 日（p7）の言及数を数え、次の順に判定する。

- `COOLING`：p7 > 0 かつ c7 ≤ p7 × 0.8
- `HOT`：c7 が全キーワード中の上位 15% かつ c7 ≥ 3
- `RISING`：p7 = 0 かつ c7 ≥ 2、または c7 ≥ p7 × 1.3
- `WATCH`：それ以外

1 週間前の時点でも同じ判定をして、リングの移動（▲ / ▼ / new）を出す。

## 収集元を増やすとき

- RSS は `data/config.json` の `sources` に `{id, name, domain, group, kind: "rss", url}` を追加する。`python3 scripts/collect.py --dry-run` で取得できるか確認してからコミットする
- github.com の Atom / API はルーチン環境から 403 になるので、OSS のリリースは `releases` に repo を足す（`git ls-remote --tags` で取る）
- 市況は `markets` に Yahoo Finance のシンボルを足す

ローカル確認：`python3 -m http.server` を実行して http://localhost:8000 を開く。
