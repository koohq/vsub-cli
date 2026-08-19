# vsub-cli 改善バックログ & ロードマップ

本ドキュメントは、`vsub-cli` のコア機能（動画抽出 → Groq Whisper 文字起こし → Gemini チャンク翻訳 → SRT 生成）完了後における、機能拡張・UX 改善・信頼性強化・開発運用のバックログを整理したものです。

別スレッドや今後のイテレーションで各タスクに着手する際の設計・実装指針として活用します。

---

## 優先度サマリー

| 優先度 | 項目 | カテゴリ | 難易度 | 期待効果 |
| :--- | :--- | :--- | :--- | :--- |
| **Completed** | 1. リアルタイム進行表示 (スピナー / プログレスバー) | CLI UX | 低〜中 | 待機中の不安解消、体感品質の大幅向上 |
| **Completed** | 2. 処理結果サマリー表示 | CLI UX | 低 | 処理時間・字幕行数・ファイル一覧の可視化 |
| **Completed** | 3. 出力フォーマット拡充 (`.vtt`, `.txt`, `.json`) | 機能拡張 | 低 | Web・議事録・他ツール連携への用途拡大 |
| **Completed** | 4. ローカル E2E / 一気通貫スモークテスト機構 (`pnpm test:e2e`) | DevOps/品質 | 低 | 実ファイル・実APIによる全パイプライン自動保証 |
| **Completed** | 5. Gemini デフォルトモデル更新 (`gemini-3.7-flash`) | 信頼性 | 低 | 最新モデルへの追従と 404/エラー解消 |
| **Completed** | 6. 音声ファイル直接入力 (`.mp3`, `.wav`, `.m4a` 等) | 機能拡張 | 低 | ポッドキャストやボイスメモ対応 |
| **Completed** | 7. 既存 SRT ファイル直接翻訳 (`vsub translate`) | 機能拡張 | 中 | 動画再処理なしでの再翻訳・修正後翻訳 |
| **Completed** | 8. 複数言語一括同時翻訳 (`-t ja,en,zh`) | 機能拡張 | 中 | 多言語展開時の API 呼び出し・時間の大幅節約 |
| **Completed** | 10. 中間キャッシュ & 再開 (Resume) 機構 | 信頼性 | 中 | API エラー時・追加入力時の文字起こしやり直しコスト削減 |
| **Completed** | 12. プロンプト / 用語集 (Glossary) 指定機能 | 機能拡張 | 低〜中 | 専門用語の誤認識防止・口調や訳語の統一 |
| **Completed** | 9. 長尺音声分割時のタイムコード精度改善 | 信頼性 | 中 | 長時間動画でのミリ秒単位の字幕ズレ防止 |
| **Medium** | 11. テストカバレッジ計測 & レポート (`vitest --coverage`) | DevOps | 低 | テスト網羅率の可視化と維持 |
| **Low** | 13. Gemini API 並列リクエストによる高速化 | 信頼性 | 中 | 長尺動画における翻訳待機時間の短縮 |
| **Low** | 14. 動画への字幕焼き込み (Hardsub / Burn-in) | 機能拡張 | 中 | 字幕入り mp4 のワンストップ出力 |
| **Low** | 15. ファイル上書き防止 / バックアップセーフティ | CLI UX | 低 | 既存ファイルの誤削除・上書き防止 |
| **Low** | 16. npm パッケージ / `npx` 公開の最適化 | DevOps | 低 | インストール不要での即時実行 (`npx`) 対応・設定整備 |
| **Low** | 17. GitHub Releases & スタンドアロンバイナリ配布 | DevOps | 中 | Node.js 未導入ユーザー向け単体バイナリ配布 |
| **Low** | 18. GitHub Actions (CI) 自動テストの構築 | DevOps | 低 | チーム開発移行時の自動化（現状は手元検証を優先） |

---

## 1. CLI UX・使い勝手の向上 (User Experience)

### 1.1 リアルタイム進行表示 (スピナー / プログレスバー) 【完了】
* **対応内容**:
  * `ora` によるステップごとのスピナー表示（「🔊 [1/4] 音声を抽出中...」「🎙️ [2/4] Groq Whisper API で文字起こし中...」「🌐 [3/4] Gemini API で翻訳中 [1/3 チャンク]...」「💾 [4/4] 字幕ファイルを保存中...」）。
  * Gemini チャンク翻訳および Groq セグメント文字起こし時の進捗コールバック連動。
* **対応ファイル**: `src/ui.ts`, `src/index.ts`, `src/gemini.ts`, `src/groq.ts`

### 1.2 処理結果サマリー表示 【完了】
* **対応内容**:
  * 処理完了時に所要時間、対象動画、検出言語、翻訳言語、生成字幕行数、出力ファイル一覧をUnicode罫線とカラーで美しく表示。
* **対応ファイル**: `src/ui.ts`, `src/index.ts`

### 1.3 ファイル上書き防止 / バックアップセーフティ
* **背景/課題**: 出力先に同名の字幕ファイルが既に存在する場合、確認なしで上書きされてしまう。
* **提案内容**:
  * `--overwrite` / `-f` フラグがない場合、対話環境では上書き確認プロンプトを表示、または `.bak.srt` などのバックアップを作成。
* **対応スコープ**: `src/index.ts`

---

## 2. 実用性・機能拡張 (Features)

### 2.1 出力フォーマットの拡充 (`.vtt`, `.txt`, `.json`) 【完了】
* **対応内容**:
  * `-f, --format <formats>` オプション（例: `-f srt,vtt,txt,json`）を新設。
  * **WebVTT (`.vtt`)**: Web ブラウザや HTML5 `<video>`、YouTube 等に対応（ミリ秒ピリオド変換、ヘッダー追加）。
  * **プレーンテキスト (`.txt`)**: タイムコードなしの文字起こし全文（要約・議事録・記事化用途）。
  * **JSON (`.json`)**: 構造化データ（外部スクリプトやアプリ連携用）。
  * カンマ区切りによる複数フォーマット同時一括出力、フォーマットバリデーション、`--save-original` 連動対応。
* **対応ファイル**: `src/formatter.ts`, `src/formatter.test.ts`, `src/index.ts`

### 2.2 既存 SRT ファイル直接翻訳サブコマンド (`vsub translate`) 【完了】
* **対応内容**:
  * `vsub translate <file.srt> -t <targetLang> [-f formats] [-o output]` サブコマンドを新設。
  * 音声抽出・Whisper 処理（Groq）をスキップし、Gemini API のみで SRT のパース → チャンク翻訳 → マルチフォーマット（`.srt`, `.vtt`, `.txt`, `.json`）保存を実行。
  * `sample.en.srt` 等の既存言語サフィックスをスマートに置換する出力ファイル命名処理を実装。
* **対応ファイル**: `src/index.ts`, `src/config.ts`, `src/ui.ts`, `src/ui.test.ts`, `src/config.test.ts`, `scripts/test-e2e.ts`

### 2.3 音声ファイル直接入力対応 【完了】
* **対応内容**:
  * 引数として音声ファイル（`.mp3`, `.wav`, `.m4a`, `.aac`, `.flac`, `.ogg`, `.opus`, `.wma` 等）が渡された場合、動画・音声の種別を自動判定。
  * 音声ファイルの場合は「音声最適化」、動画の場合は「音声抽出」として進捗スピナーおよびサマリー表示を動的最適化。
  * `isAudioFile`, `isVideoFile`, `isSupportedMediaFile` ヘルパー関数の追加および `prepareAudio` エイリアス提供。
* **対応ファイル**: `src/ffmpeg.ts`, `src/ffmpeg.test.ts`, `src/ui.ts`, `src/ui.test.ts`, `src/index.ts`, `scripts/test-e2e.ts`

### 2.4 複数言語への一括同時翻訳 【完了】
* **対応内容**:
  * `-t ja,en,zh` のようにカンマ区切りで複数ターゲット言語を指定可能にするパーサー `parseTargetLanguages` を実装。
  * Groq 文字起こしは 1 回のみ実行し、Gemini 翻訳を各言語ごとに実行して `sample.ja.srt`, `sample.en.srt`, `sample.zh.srt` を一括出力。
  * 検出言語と一致する言語は自動で Whisper 原文を採用し、無駄な API 呼び出しを抑制。
  * `vsub translate` サブコマンドでも複数言語同時出力をサポート。
* **対応ファイル**: `src/languages.ts`, `src/languages.test.ts`, `src/index.ts`, `src/ui.ts`, `src/ui.test.ts`, `scripts/test-e2e.ts`

### 2.5 プロンプト / 用語集 (Glossary) 指定 【完了】
* **対応内容**:
  * `src/glossary.ts` モジュールを新設（JSON 用語集ファイルのフラット形式・言語別形式・用語別言語形式のパース、インライン文字列パース、Gemini 向け対訳ルール生成、Whisper 向けヒント語句自動抽出、決定論的キャッシュハッシュ計算）。
  * `--whisper-prompt <text>`: Groq Whisper API の `prompt` パラメータにヒントテキストを渡し、専門用語・固有名詞の認識率を向上。
  * `--glossary <path-or-terms>`: 用語集（JSON または `Key=Val,Key=Val`）を指定し、Gemini プロンプトへ対訳ルールを注入。未指定時は用語集キーを Whisper へ自動供給。
  * `--prompt <instruction>`: Gemini 翻訳プロンプトに追加のスタイル・口調・文字数制限などのカスタム指示文を注入。
  * グローバル設定 (`vsub config set --whisper-prompt ... --prompt ... --glossary ...`) によるデフォルト設定と `config show` での表示。
  * プロンプト/用語集の変更を検出して古いキャッシュを誤適用しないプロンプト認識キャッシュ整合性。
  * `vsub translate` サブコマンドへの `--prompt` / `--glossary` 連動。
* **対応ファイル**: `src/glossary.ts`, `src/glossary.test.ts`, `src/groq.ts`, `src/groq.test.ts`, `src/gemini.ts`, `src/gemini.test.ts`, `src/config.ts`, `src/config.test.ts`, `src/cache.ts`, `src/cache.test.ts`, `src/index.ts`, `src/ui.ts`, `src/ui.test.ts`, `README.md`, `README.ja.md`

### 2.6 動画への字幕焼き込み (Hardsub / Burn-in)
* **背景/課題**: 字幕ファイルを別体で扱うのではなく、動画自体に字幕が焼き込まれたファイルが欲しいケースがある。
* **提案内容**:
  * `--burn` オプションまたは `vsub burn <video> <srt>` サブコマンド。
  * FFmpeg の `subtitles` フィルタを利用して、字幕が合成された動画（`sample.subbed.mp4`）を出力。
* **対応スコープ**: `src/ffmpeg.ts`, `src/index.ts`

---

## 3. 信頼性・非機能要件 (Reliability & Architecture)

### 3.1 長尺音声分割時のタイムコード精度改善 【完了】
* **対応内容**:
  * `resolveFfprobePath`, `getMediaDurationInSeconds` を新設し、`ffprobe` の高精度秒数取得および `ffmpeg` stderr パースの自動フォールバックを実装。
  * 24.5MB 超過による音声分割（`extractAudio`）時に各分割セグメントの実再生時間をミリ秒精度で計測し、`ExtractedAudioResult` の `durations` として返却。
  * `transcribeAudioSegments` において、固定 1200 秒加算ではなく実測セグメント長（`durations[i]`）を累積加算する高精度タイムコード補正機構を実装。
  * 未指定時のデフォルト 1200 秒フォールバックによる後方互換性を担保。
* **対応ファイル**: `src/ffmpeg.ts`, `src/ffmpeg.test.ts`, `src/groq.ts`, `src/groq.test.ts`, `src/index.ts`

### 3.2 中間キャッシュ & 再開 (Resume) 機構 【完了】
* **対応内容**:
  * `src/cache.ts` モジュールを新設（OS標準キャッシュディレクトリ、ファイルサイズ+更新日時によるSHA-256キー生成、文字起こし・翻訳キャッシュの読込・保存・統計・クリーンアップ）。
  * Groq 文字起こし完了時に自動キャッシュし、同一ファイルの再実行時や別言語翻訳時に FFmpeg 音声抽出および Groq API 呼び出しを完全スキップ（高速化＆コストゼロ）。
  * Gemini 多言語翻訳の完了言語ごとのキャッシュ保存により、障害中断時も完了済み言語の再翻訳をスキップ。
  * `vsub translate` サブコマンドへのキャッシュ連動。
  * `--no-cache`, `--fresh`, `--cache-dir` オプションおよび `vsub cache (path|stats|clean)` サブコマンドを提供。
* **対応ファイル**: `src/cache.ts`, `src/cache.test.ts`, `src/index.ts`, `src/ui.ts`, `src/ui.test.ts`, `scripts/test-e2e.ts`, `README.md`, `README.ja.md`

### 3.3 Gemini API 並列リクエスト制御
* **背景/課題**: チャンク数が多い（長尺動画）場合、直列実行では翻訳待機時間が長くなる。
* **提案内容**:
  * 並行実行数（例: 同時 3〜5 リクエスト）を制御（`p-limit` 等）しつつ並列翻訳を実行し、スループットを高速化。
  * レートリミット（429 Too Many Requests）発生時は指数バックオフで自動再試行。
* **対応スコープ**: `src/gemini.ts`

### 3.4 Gemini デフォルトモデル更新 (`gemini-3.7-flash`) & モデル設定の柔軟化
* **背景/課題**:
  * 現在のコードのデフォルトは `gemini-2.5-flash` となっているが、現在の最新世代は **`gemini-3.7-flash`**。
  * `media-vault` 等の知見同様、字幕翻訳のような 1:1 構造化マッピングタスクでは Thinking Budget（思考バジェット）の適切な設定（オフまたは low）により、レイテンシ・トークンコスト・翻訳精度のバランスを最適化できる。
  * Groq 側は現時点で `whisper-large-v3-turbo` 固定が最も費用対効果・速度に優れているが、将来の新世代モデル登場や Gemini 側の切り替え需要に備え、CLI / 環境変数 / `config.json` からモデル名を指定できるようにしておくと保守性が高まる。
* **提案内容**:
  * Gemini デフォルトモデルを `gemini-3.7-flash` に更新。
  * 字幕翻訳用プロンプト・設定（Thinking Budget 設定やレスポンスフォーマット）の最適化。
  * `--gemini-model <model>`, `--groq-model <model>` オプションおよび `vsub config set` への設定項目追加。
* **対応スコープ**: `src/gemini.ts`, `src/groq.ts`, `src/config.ts`, `src/index.ts`


---

## 4. 開発運用・CI/CD・配布 (DevOps & Distribution)

### 4.1 GitHub Actions による CI 自動テスト
* **背景/課題**: PR や push 時に自動でリント・型チェック・テストが実行される仕組みが未導入。
* **提案内容**:
  * `.github/workflows/ci.yml` を作成。
  * `pnpm check` (Biome), `pnpm test` (Vitest), `pnpm build` (TypeScript) の自動検証。
* **対応スコープ**: `.github/workflows/ci.yml`

### 4.2 テストカバレッジ計測 (`vitest --coverage`)
* **背景/課題**: テストの網羅率（C0/C1 カバレッジ）が数値化されていない。
* **提案内容**:
  * `@vitest/coverage-v8` を導入し、`pnpm test:coverage` スクリプトを追加。
* **対応スコープ**: `package.json`, `vitest.config.ts`

### 4.3 npm パッケージ / `npx` 公開設定の最適化
* **背景/課題**: リポジトリを clone せずに `npx vsub-cli` や `npm i -g vsub-cli` で利用できるようにするためのパッケージ設定が必要。
* **提案内容**:
  * `package.json` の `files` フィールドに `["dist", "README.md", "README.ja.md", "LICENSE"]` を設定し、ソースコードやテストファイルを除外して軽量化。
  * `prepublishOnly` スクリプトに `pnpm check && pnpm test && pnpm build` を追加し、ビルド漏れやテスト失敗時の publish 事故を防止。
  * npmjs.com 上でのパッケージ名空き状況の確認（重複時はスコープ付き `@<username>/vsub-cli` または別名を検討）。
  * メタデータ（`repository`, `keywords`, `bugs`, `homepage` 等）の拡充。
* **対応スコープ**: `package.json`

### 4.4 GitHub Releases & スタンドアロンバイナリ配布 (Node.js 未導入ユーザー向け)
* **背景/課題**: Node.js や pnpm をインストールしていない一般ユーザーにも CLI を使ってもらいたい。
* **提案内容**:
  * Node.js SEA (Single Executable Applications) 等を用いて、Windows (`.exe`), macOS, Linux 向けの単体実行バイナリをビルド。
  * GitHub Releases に各 OS 向けバイナリを自動アップロードする Release ワークフローの構築。
* **対応スコープ**: `.github/workflows/release.yml`, ビルドスクリプト

