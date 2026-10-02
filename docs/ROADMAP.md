# ROADMAP — レビューと次の4機能の設計

対象: `main` @ 8adacb4（187銘柄・入口バッジ・$10株数まで入った状態）。この文書は設計のみ。アプリのコードは変えていない。

## 0. 不変ルール

- 読み取り専用。注文・発注・口座接続は将来も作らない。判断は毎回本人。
- リポジトリは公開。口座番号、明細CSV、保有株数、取得単価、残高、円建て防衛ラインの金額は **コミットしない**（コード・テスト・fixture・この文書も含む）。
- `IGNORED_TICKERS = ["ONDS"]` を全機能（保有、相関、アラート、KPI、買う前チェック）で除外する。ウォッチリストの行表示は残してよい。
- 電話が先。1列カード、タップ領域 44px 以上、数値入力は `inputMode="decimal"`。
- 時刻の内部表現は UTC の ISO 文字列、表示は JST。営業日の判定は米国東部（ET）。

## 1. 現状のアーキテクチャ（要約）

```
Yahoo v8 chart (6mo, 1d) ──┐  FETCH_CONCURRENCY=5, Chrome UA, query1→query2→query1
                           ├─ market.ts: メモリ + data/.cache/market.json（TTL 15分, 全銘柄一括更新）
Yahoo EPS (crumb/v7/HTML) ─┘  eps.ts: バックグラウンドで6銘柄ずつ, 成功24h/失敗10分
compute.ts (純関数): 箱, 15/25%線, 反発日数, ATR14単純平均, $10株数, entrySignal, 出来高, 傾き
corr.ts: 60日リターン相関（data/corr_basket.json の株数加重, SOXX）
/api/market (170KB, no-store) / /api/picks / /api/chart/[t] / /api/health
UI: dashboard.tsx(636行, client) + detail-panel + pick-cards。URL クエリでフィルタ
テスト: node:test + tsx, src/lib/*.test.ts 53件（純関数のみ, ネットワーク無し）。CI 無し
```

実測（2026-10-03 07時頃 JST）: スリープ明けの `/api/health` 22秒 → `/api/market` 5秒（190銘柄取得）→ 187/187 成功。ただし **P/E は 0/187**（再起動で EPS キャッシュが消え、ウォーム前）。

## 2. 弱点とリスク（優先度順）

| # | 重要度 | 内容 | 根拠 | 対処 |
|---|---|---|---|---|
| R1 | 高 | 個人の保有株数が公開リポジトリにある | `data/corr_basket.json`、`corr.test.ts` の株数、watchlist の「保有」メモ | PR1 で basket を環境変数（Render Secret）へ移し、テストは架空の銘柄・株数に置換。履歴に残る分の書き換え（force push）は本人判断 |
| R2 | 高 | ONDS が相関バスケットに入っている | `corr_basket.json` | `IGNORED_TICKERS` を basket 読み込み時に適用 |
| R3 | 高 | 認証・非公開ストレージが無い | 全 API が公開。Render 無料枠のディスクは揮発 | §3 の共通基盤（パスコード + Postgres、取引ログはブラウザ内） |
| R4 | 高 | TTL 切れの全件再取得で、失敗した銘柄は前回の正常な日足を捨てる | `refresh()` は stale 時 `series = {}` から作り直す | 失敗時は直前の正常値を残し `stale: true` を付ける |
| R5 | 中 | 失敗結果が15分キャッシュされる。429 にバックオフが無い | `missing` は「キーが無い」だけを見る。再試行は 400ms 1回 | エラー行は 2分で再取得。429 は指数バックオフ + ジッタ、chart と EPS で共通のレート制御 |
| R6 | 中 | 15分ごとに最初の閲覧者が全件取得（約5秒）を待つ | stale-while-revalidate が無い | 古い値を即返し、裏で更新 |
| R7 | 中 | コールドスタート | 無料枠は15分無操作でスリープ。起動22秒 + 取得5秒、EPS は数分 | アラートは要求時計算 + 決定的 ID（§4.1）。`instrumentation.ts` で起動時に価格取得を開始 |
| R8 | 中 | 引け直後の終値が暫定 | `dropPartialBar` は引け+90秒で当日足を確定扱い。Yahoo はクロージング・オークション値を数分遅れで反映。15分キャッシュされる | 16:20 ET より前の当日足は `provisional` とし、アラートの入口シグナルは出さない |
| R9 | 中 | `previousClose` 系の取り違え | 現状は使っていない（日足の終値のみ）。`meta.chartPreviousClose` は「期間開始前の終値」で前日終値ではない | 今後も前日比は日足 `c[n-1]` から計算する、とテストで固定する |
| R10 | 中 | 決算日が 70/187 銘柄で未登録、過去日付が残る | watchlist.yaml | アラート(a)は「未登録」を明示（§4.1）。季節ごとの手更新チェックを `check-market.ts` に追加 |
| R11 | 中 | CI が無く、テストを通さずに main が自動デプロイされる | `.github/` 無し。Render の build は型検査と lint のみ | GitHub Actions（test・lint・`tsc --noEmit`）+ render.yaml `autoDeployTrigger: checksPass` |
| R12 | 中 | 決済日（T+1）の暦が NYSE 休場日と違う | コロンブスデー（2026-10-12）、退役軍人の日（2026-11-11）は取引あり・決済なし | `SETTLEMENT_HOLIDAYS` を別に持つ |
| R13 | 低 | テストの穴 | market.ts のキャッシュ・TTL・エラー保持、eps.ts のフォールバック、API の形、UI はテスト無し。`tsx` は型を検査しない | fetcher を注入できる形に分割して単体テスト。API は型ガードで形を固定 |
| R14 | 低 | market.ts（571行）に価格キャッシュ・EPS・payload 組み立てが同居 | 機能追加のたびに肥大 | `price-cache.ts` / `eps-cache.ts` / `payload.ts` に分割 |
| R15 | 低 | 配当未調整 | MO・公益など高配当銘柄は権利落ちで箱と ATR が少し歪む | 表示の注記で足りる。バックテストでは既知の偏りとして記録 |
| R16 | 低 | メモリ | 384MB old-space。EDGAR の大型 JSON（Morgan Stanley の submissions は 4MB）を同時に読むと膨らむ | EDGAR は1社ずつ逐次処理し、直近7日分だけ保持。バックテストはサーバで動かさない |

性能そのもの（計算・170KB の JSON は gzip 済み）は問題にならない。効くのは外部取得と揮発キャッシュ。

## 3. 共通基盤（4機能の前提）

### 3.1 非公開データの置き場所

| データ | 置き場所 | 理由 |
|---|---|---|
| 明細 CSV（生） | どこにも保存しない。ブラウザでパースして破棄 | 口座番号を含む |
| 取引（約定）・KPI | ブラウザの localStorage（`rt.fills.v1`）。JSON の書き出し・読み込みボタン付き | サーバ不要。端末を替えるときは JSON を移す |
| 保有・現金・防衛ライン・見直しライン | **Render Postgres（有料 Basic）** | アラート(b) はサーバ側で保有を知る必要がある。無料 Postgres は30日で失効、無料 Key Value は永続しない、ディスクは有料インスタンスが必要 |

費用を避けたい場合の代替: 保有を Render の Secret 環境変数 `PRIVATE_HOLDINGS_JSON` に置く（編集は Render Dashboard、変更ごとに再起動）。アプリ内での入力はできなくなる。

### 3.2 認証（単一ユーザー）

- `APP_PASSCODE` と `SESSION_SECRET`（Render Secret）。`/login` でパスコード → HMAC 署名の httpOnly Cookie（30日）。
- `middleware.ts` で `/holdings`、`/api/holdings*`、`/api/precheck` を保護。
- 外部アシスタント用に `ALERTS_TOKEN`。`Authorization: Bearer` があるときだけ、アラートに保有由来の項目を入れる。
- 既存の公開ページ（レンジ表・チーム注目）は今のまま公開。

### 3.3 小さな共通部品

- `src/lib/ignore.ts`: `IGNORED_TICKERS` と `withoutIgnored()`。
- `src/lib/settlement.ts`: `settleDate(tradeDate)`。T+1 は NYSE 営業日かつ決済休日でない日。
- `JPY=X`（USDJPY 日足）を価格キャッシュに追加。表には出さない。
- `src/lib/time.ts`: `toJst(iso)`、`sessionCloseUtc(date)`（16:00 ET → UTC、夏時間対応）。

## 4. 機能設計

### 4.1 アラートフィード `/api/alerts`

**方針**: サーバは定時実行しない（無料枠はスリープする）。アシスタントのポーリングで起き、要求時に計算する。ID は入力データだけから決まるので、再起動しても同じ項目は同じ ID になり、重複除去はアシスタント側で ID を比べるだけで済む。サーバ側に既読状態は持たない。

**スロット**（ET 基準、表示は JST）

| slot | 時間帯 (ET) | 用途 |
|---|---|---|
| `post_close` | 16:20〜翌 04:00 | 確定日足からのシグナル（夏時間なら JST 05:20〜） |
| `pre_open` | 04:00〜09:30 | 夜間の EDGAR 提出、決算までの営業日の更新 |
| `session` | 場中 | 前日の確定足のまま。EDGAR だけ更新 |

**データモデル**

```ts
type AlertKind =
  | "entry_in_ok"      // (a)
  | "review_break"     // (b) 認証時のみ
  | "sec_8k" | "sec_form4_sell" | "sec_offering"  // (c)
  | "anthropic_s1";    // (c) 最優先

type AlertItem = {
  id: string;              // 決定的。下表
  kind: AlertKind;
  severity: "critical" | "action" | "info";
  ticker: string | null;
  title: string;           // 日本語1行。通知本文にそのまま使える
  body: string;            // 2〜3行。数字の根拠
  eventAt: string;         // UTC ISO。シグナル=その日の引け、提出=EDGAR acceptanceDateTime
  eventAtJst: string;      // "2026-10-03 05:00 JST"
  url: string | null;      // EDGAR の提出インデックス、またはサイトの詳細
  facts: Record<string, string | number | boolean | null>;
};

type AlertsPayload = {
  v: 1;
  generatedAt: string; generatedAtJst: string;
  slot: "post_close" | "pre_open" | "session";
  barDate: string | null;
  complete: boolean;       // false = EDGAR 巡回中。60秒後に再取得
  sources: {
    prices: { ok: boolean; fetchedAtJst: string; provisional: boolean };
    edgar: { ok: boolean; lastSweepJst: string | null; error: string | null };
  };
  items: AlertItem[];      // eventAt 降順。シグナルは最新 barDate、提出は直近3暦日（?days=1..7）
};
```

| kind | id | 条件 |
|---|---|---|
| entry_in_ok | `entry:{T}:{連続 in_ok の初日}` | `entrySignal === "in_ok"` かつ `atr14/close ≥ 3%` かつ決算まで5営業日超（または過去）。watchOnly と ONDS は除外。終値 > $450 は `facts.overBudget`。決算日未登録は除外せず `severity: "info"` と「決算日未登録」を付ける |
| review_break | `review:{T}:{連続して終値<見直しラインになった初日}` | 保有の確定終値が見直しライン未満。日足の履歴から初日を逆算するので状態保存は不要 |
| sec_8k | `sec:{accession}` | Item が 1.01/1.02/1.03/2.01/3.01/4.02/5.01 → action、5.02/8.01 → info。2.02（決算）、7.01、9.01 だけの提出は除外 |
| sec_form4_sell | `sec:{accession}` | 非デリバティブ表に `transactionCode=S`、`<aff10b5One>` が 1 でない、脚注に "10b5-1" が無い、売却額 ≥ $250K（定数） |
| sec_offering | `sec:{accession}` | 424B1/B3/B4/B5/B7。**424B2 は除外**（Morgan Stanley だけで1週間 650 件の仕組債）。financials グループは既定で除外 |
| anthropic_s1 | `sec:{accession}:anthropic` | 提出者名が `^ANTHROPIC,? PBC$` に一致し、フォームが S-1/S-1/A/F-1/424B4。`critical` |

**EDGAR の取り方**（無料、登録不要）

- User-Agent は `SEC_USER_AGENT` 環境変数（"range-table 連絡先メール"）。メールはリポジトリに書かない。未設定なら EDGAR を止めて `sources.edgar.error` に出す。
- CIK 対応表: `https://www.sec.gov/files/company_tickers.json` からスクリプトで 187 銘柄分だけ抜き、`data/sec_cik.json` にコミットする（公開情報。全 187 銘柄が対応することを確認済み）。
- 各社の提出: `https://data.sec.gov/submissions/CIK##########.json`。`form`、`items`、`acceptanceDateTime`（UTC と確認済み）、`primaryDocument` が取れる。5 req/s のトークンバケット（SEC の上限は 10 req/s）、1社 30分キャッシュ、逐次処理、直近7日分だけ保持。1巡（187社）は約40秒。
- Form 4 の XML は `primaryDocument` の `xslF345X06/` を外したパス。`<aff10b5One>` が入っていることを確認済み。
- Anthropic: 社名検索では「Anthropic」を名前に含む SPV（ファンド）しか出ず、本体の CIK は未確認。全文検索の S-1 ヒットは SpaceX・Figma など **他社の目論見書が Anthropic に言及しているだけ**。そのため
  1. 各巡回で `browse-edgar?action=getcurrent&type=S-1&count=100&output=atom`（S-1/A、F-1 も）を読み、**提出者名**で照合する。名前に SERIES/FUND/SPV/LLC/LP を含むものは除外。
  2. 1日1回 `efts.sec.gov/LATEST/search-index?q="Anthropic, PBC"&forms=S-1,S-1/A,F-1` を読み、`display_names` が提出者本人のものだけ採用する。
  3. 一致したら CIK を `data/edgar_watch.json` に固定し、以後は submissions で 424B4（価格決定）も追う。
- 403/429 は 60秒から指数バックオフ。共有 IP で弾かれた場合は `edgar.ok=false` を返し、価格由来のアラートは出し続ける。

**UI（電話）**: `/alerts` タブ。critical → action → info の順でカードを並べ、各カードはタイトル・JST 時刻・根拠2行・リンク。上部に「データ: 2026-10-02 終値（確定）/ EDGAR 05:41 JST」。

**ファイル**

```
src/lib/alerts/{types,signals,holdings,ids}.ts
src/lib/edgar/{client,ratelimit,submissions,form4,anthropic,filters}.ts
src/app/api/alerts/route.ts   src/app/alerts/page.tsx   src/components/alert-card.tsx
scripts/build-sec-cik.ts      data/sec_cik.json         data/edgar_watch.json
src/lib/fixtures/edgar/*.json|*.xml   # 公開提出物を縮めたもの
```

**テスト**: ID が入力だけで決まること（同じ入力→同じ ID、終値が変わっても初日が同じなら同じ ID）、in_ok×ATR%×決算の真理値表、決算日未登録の扱い、16:20 ET 前は provisional でシグナルを出さないこと、8-K Item の振り分け、Form 4（10b5-1 チェック・脚注・買い・少額）、424B2 除外、Anthropic の照合（本体は一致、SPV と他社 S-1 の言及は不一致）、JST 変換（夏時間の前後）、EDGAR 失敗時もシグナルが返ること。ネットワークは使わない。

**規模**: L。新規約 12 ファイル・1,200 行。PR 3本（§5）。

### 4.2 取引ログと KPI

**方針**: CSV はブラウザでパースし、生データは保存しない。口座情報セクションは読み飛ばす。約定だけを localStorage に保存。サーバ API は作らない。

**IBKR CSV の形**: 1行 = `セクション名,Header|Data|SubTotal|Total|Notes,項目…`。日本語版は `Statement,Header,フィールド名,フィールド価値` で始まり、見出しも日本語。セクション名に頼らず、**Header 行の列の組み合わせ**で「取引」セクションを見つける。

| 内部名 | 英語見出し | 日本語見出し（候補。実物の Header 行1本で確定） |
|---|---|---|
| discriminator | DataDiscriminator | DataDiscriminator |
| asset | Asset Category | 資産区分 |
| currency | Currency | 通貨 |
| symbol | Symbol | シンボル |
| dateTime | Date/Time | 日付/時間 |
| quantity | Quantity | 数量 |
| price | T. Price | 取引価格 |
| proceeds | Proceeds | 代金 / 取引代金 |
| commission | Comm/Fee | 手数料 |
| realized | Realized P/L | 実現損益 |
| code | Code | コード |

見出しが別名表で解決できないときは、列の対応を選ぶ画面を出し、対応を localStorage に保存する。Flex Query（英語・列固定）の CSV にも対応する。

**データモデル**

```ts
type Fill = {
  id: string;            // hash(symbol, dateTime, qty, price)。再アップロードで重複しない
  symbol: string; tradeAt: string /* ET */; tradeDate: string;
  side: "BUY" | "SELL"; qty: number; price: number;
  commission: number;    // USD, ≤ 0
  ibkrRealized: number | null;  // 照合用
};
type ClosedTrade = {     // 売り1注文（同一銘柄・同日・同価格帯の約定をまとめる）= 1トレード
  symbol: string; openDate: string; closeDate: string; qty: number;
  cost: number;          // FIFO ロットの取得額 + 按分した買い手数料
  proceeds: number;      // 売却額 − 売り手数料
  pnl: number; holdDays: number;
};
type Kpi = {
  trades: number; winRate: number; avgPnl: number; totalPnl: number; totalFees: number;
  days10: { hit: number; tradingDays: number };  // 確定損益の日計 ≥ $10 の日数
  byDay: Array<{ date: string; pnl: number }>;
  bySymbol: Array<{ symbol: string; trades: number; pnl: number }>;
  reconcile: Array<{ symbol: string; ours: number; ibkr: number }>;  // 差 > $0.05 だけ
};
```

**計算**: 約定を時刻順に並べ、銘柄ごとに FIFO ロット（買い手数料は1株あたりに按分）。部分約定・複数回の買い増し・一部売りに対応。売りが保有を超えたら（現物口座ではありえない）警告して止める。Forex・配当・データ購読料は対象外。ONDS は既定で除外（切り替え可）。

**UI（`/log`）**: 「CSVを選ぶ」ボタン → 取り込み件数と照合結果 → カード4枚（勝率・1回平均・合計・$10達成日 x/y）→ 日別の小さなマス目（$10以上を緑）→ 銘柄別 → トレード一覧。下部に「JSONで保存」「JSONから戻す」「全部消す」。

**ファイル**: `src/lib/ibkr/{csv,headers,parse}.ts`、`src/lib/fifo.ts`、`src/lib/kpi.ts`、`src/lib/local-store.ts`、`src/app/log/page.tsx`、`src/components/log/*`。

**テスト**: 架空の fixture（英語版・日本語版、口座番号は `U0000000`）で、引用符内のカンマ・BOM・CRLF・桁区切り・SubTotal/Total 行の除外、日本語見出しの解決、FIFO（3回買い→2回売り、手数料の按分）、再取り込みの重複除去、$10 日の集計（ET 日付）、IBKR 実現損益との照合。加えて **プライバシーテスト**: リポジトリ内に `U\d{7,8}` や fixture 以外の `.csv` が無いこと。`.gitignore` に `*.csv` と `!src/lib/fixtures/**/*.synthetic.csv`。

**規模**: M。約 8 ファイル・800 行。PR 2本。

### 4.3 保有タブと買う前チェック

**データモデル（Postgres）**

```sql
create table holdings (
  ticker text primary key, shares numeric not null, avg_cost numeric not null,
  review_line numeric, opened_at date, note text, updated_at timestamptz default now()
);
create table account (          -- 1行だけ
  id int primary key default 1, usd_settled numeric, jpy_cash numeric,
  defense_line_jpy numeric, updated_at timestamptz default now()
);
create table unsettled (amount_usd numeric, settle_date date);
```

起動時に `create table if not exists`。`pg` だけ追加し ORM は入れない。`DATABASE_URL` が無いときは保有タブに「未設定」を出し、他の画面には影響させない。

**保有ごとの表示**: 終値、評価額、株の中での比率、含み損益（$ と %）、見直しラインまで（% と ATR 何本分 = `(close − review) / atr14`）、1 ATR あたりの $（`shares × atr14`）、entrySignal、決算5営業日以内。見直しラインに近い順（ATR 本数の小さい順）に並べる。

**口座カード**: `円建て口座 = (株評価 + USD 現金) × USDJPY + 円現金`。防衛ラインまでの余裕を円と % で表示し、「全保有が見直しラインまで下がった場合」の残りも出す。

**買う前チェック** `POST /api/precheck`（認証必須・保存しない）

```ts
type PrecheckIn = { ticker: string; shares: number; price?: number };  // price 省略時は確定終値
type PrecheckOut = {
  cost: number; postWeights: Array<{ ticker: string; weight: number }>;
  corr: Array<{ ticker: string; value: number | null; high: boolean }>;  // 60日。> 0.6 で high
  corrBasket: number | null;
  lossToLow20: { usd: number; jpy: number; pctOfAccount: number; cushionAfterJpy: number };
  flags: Array<"earnings5d" | "priceOver450" | "costOver450" | "atrUnder3" | "corrHigh"
             | "belowDefense" | "notInOk" | "usesUnsettled">;
  settlement: { tradeDate: string; settleDate: string; note: string | null };
  // usesUnsettled のとき「未決済資金を使う買い。{settleDate} より前に売ると GFV」
};
```

ウォッチリスト外の銘柄は、チーム注目と同じ仕組みで日足を追加取得する。株数の初期値は `shares10`。

**相関バスケットの置き換え**: `corr_basket.json` をやめ、保有テーブルから重みを作る（ONDS 除外）。公開の `/api/market` の「保有との相関」は残すが、元の株数は返さない。

**UI**: ナビに「保有」。最上部に買う前チェック（ティッカーは watchlist の候補つき入力、株数）→ 結果カード（赤=止める理由、黄=注意）。その下に口座カード、保有カード。編集は下から出るシート。

**ファイル**: `src/lib/db.ts`、`src/lib/auth.ts`、`src/middleware.ts`、`src/lib/holdings/{store,view,precheck}.ts`、`src/lib/settlement.ts`、`src/app/api/holdings/route.ts`、`src/app/api/precheck/route.ts`、`src/app/holdings/page.tsx`、`src/app/login/page.tsx`、`src/components/holdings/*`。render.yaml に `databases:` と `fromDatabase` を追加。

**テスト**: view と precheck は純関数にして、保有・日足・USDJPY を引数で渡す（DB 無しで検査）。比率の合計 100%、ATR 本数の符号、20日安値までの損失、防衛ラインの余裕、相関 0.6 の境界、$450 の境界、決済日（週末・NYSE 休場・コロンブスデー）、GFV の判定、ONDS 除外。Cookie の署名・期限切れ・改ざん。

**規模**: L。約 15 ファイル・1,300 行 + Postgres 作成。PR 3本。

### 4.4 パターンのバックテスト

**結論: オフライン実行**。`npm run backtest` が JSON を作り、PR でコミットする（市場データだけなので公開してよい）。サーバで動かさない理由は、2年分 × 187 銘柄の取得が Yahoo の制限と 512MB に響くこと、結果は日々変える必要がないこと。月1回の再実行は、GitHub Actions が main へ直接 push するのではなく PR を作る形にする（勝手にデプロイが走らないように）。

**ルール**（ライブの計算と同じ関数を使う。`computeQuote(bars.slice(0, i + 1))`）

- シグナル日 i: `reboundDays ≥ 1` かつ `close > line15`。変種 B: さらに `close ≤ line25`（= in_ok）。同じ銘柄の建玉は1つまで。
- 買い: i+1 日の始値（主）。変種: i 日の終値。
- 利確: 買値 + ATR14(i)。始値が上なら始値、日中高値が届けば利確値で約定。
- 損切り: 終値が i 日の 20日安値を下回った日の終値（変種: 翌日始値）。同じ日に利確値に届いていれば利確を優先（指値は場中に約定するため）。
- 期限: 20 営業日で終値決済（別集計）。
- 株数 = `ceil(10 / ATR)`（$10 株数と同じ）、手数料は往復 $0.70（定数）。

**出力** `data/backtest/summary.json`（約 40KB 以下）

```ts
type BacktestSummary = {
  params: {...}; period: { from: string; to: string }; generatedAt: string;
  overall: Stats;
  byTicker: Array<{ ticker: string } & Stats>;
  byAtrBand: Array<{ band: "<2%" | "2-3%" | "3-4%" | "4-6%" | "≥6%" } & Stats>;
  variants: Record<string, Stats>;   // in_ok 帯のみ、終値買い、翌日始値損切り
};
type Stats = { n: number; winRate: number; avgHoldDays: number;
  expectancyUsd: number; expectancyAtr: number; profitFactor: number;
  maxConsecLosses: number; timeouts: number };
```

**既知の偏り**（JSON にも書く）: 今のリストで過去を測る生存・選択バイアス、配当未調整、日中の順序は日足から推定、過去の決算日が無いので決算またぎを除けない。

**UI**: 詳細パネルに「この形の過去成績: n回・勝率・期待値」の1行、`/backtest` に ATR% 帯の表。summary.json を静的 import するので取得処理は増えない。

**ファイル**: `src/lib/backtest.ts`（純関数）、`scripts/backtest.ts`（2 req/s、取得した日足は gitignore 済みの `data/.cache/bt/` に保存）、`data/backtest/summary.json`、`src/app/backtest/page.tsx`。`fetchDailyBars` に `range` 引数を追加（既定 6mo のまま）。

**テスト**: 手作りの日足で、利確・損切り・期限・ギャップ上の利確・同日両方・建玉の重複禁止・ATR 帯の境界・期待値の計算。シグナル判定がライブの `classifyEntrySignal` と一致すること。

**規模**: M。約 5 ファイル・600 行。PR 2本。

## 5. 実装順と PR 分割

どの PR も単独で main に入れてデプロイできる状態を保つ。新しい画面は、必要な環境変数（`DATABASE_URL`、`SEC_USER_AGENT`、`ALERTS_TOKEN`）が無ければ「未設定」を出すだけにして、既存の画面を壊さない。

| 順 | PR | 内容 | 規模 | Render 側の作業 |
|---|---|---|---|---|
| 0 | docs | この ROADMAP | — | — |
| 1 | 安全とCI | GitHub Actions（test・lint・`tsc --noEmit`）、`autoDeployTrigger: checksPass`、プライバシーテスト、`.gitignore` に `*.csv`、`IGNORED_TICKERS`、basket を `CORR_BASKET_JSON` 環境変数へ移し `corr_basket.json` を削除、テストの株数を架空に | S | Secret `CORR_BASKET_JSON` を先に設定 |
| 2 | 価格キャッシュ強化 | market.ts 分割、正常値保持、エラー2分、429 バックオフ、stale-while-revalidate、起動時ウォーム、provisional 判定、`JPY=X`、`settlement.ts`、キャッシュのテスト | M | — |
| 3 | アラート v1 | `/api/alerts` と `/alerts`。(a) のみ、決定的 ID、slot | M | — |
| 4 | EDGAR + Anthropic | EDGAR クライアント、レート制御、`anthropic_s1` | M | Secret `SEC_USER_AGENT` |
| 5 | EDGAR 187銘柄 | `sec_cik.json`、8-K・Form 4・424B のフィルタ | M | — |
| 6 | 認証 + DB | パスコード、middleware、Postgres、保有 API。basket を保有テーブルに切り替え | M | Postgres 作成、`APP_PASSCODE`・`SESSION_SECRET` |
| 7 | 保有タブ | 保有カード、口座カード、編集シート | M | — |
| 8 | 買う前チェック | `/api/precheck` と結果カード | M | — |
| 9 | アラート (b) | `review_break`、`ALERTS_TOKEN` | S | Secret `ALERTS_TOKEN` |
| 10 | 取引ログ（計算） | CSV パーサ、FIFO、KPI、fixture とテスト。画面なし | M | — |
| 11 | 取引ログ（画面） | `/log`、localStorage、JSON の書き出し | S | — |
| 12 | バックテスト（計算） | engine、script、summary.json | M | — |
| 13 | バックテスト（画面） | 詳細パネルの1行、`/backtest` | S | — |

**理由**: 1 は公開リポジトリの露出と「テストを通さずデプロイ」を止めるので最初。2 はアラートが依存するデータの信頼性。3→4→5 は毎日の価値が一番大きく、Anthropic の S-1 検知は時期が決まっているので EDGAR の中でも先に出す。6〜9 は保有を必要とする機能をまとめる。10〜11（ブラウザ完結）と 12〜13（オフライン）は他と依存が無いので、待ち時間に差し込める。バックテストの結果で ATR 3% の閾値が妥当か確かめられるので、アラート (a) の閾値調整の前に 12 を済ませておくとよい。

## 6. 本人に決めてもらうこと

1. 保有の保存先: Postgres（有料 Basic）か、Secret 環境変数（無料・アプリ内編集なし）か。
2. 公開リポジトリの履歴に残った保有株数を、履歴の書き換えで消すか（force push が必要）。
3. 決算日未登録の銘柄をアラート (a) に `info` として出すか、完全に除外するか。
4. Form 4 の売却額の下限（初期値 $250K）と、424B を financials で除外するか。
5. IBKR 日本語 CSV の Header 行を1本（データ行なし）見せてもらい、列名の別名表を確定する。
