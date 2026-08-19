# vsub-cli 改善バックログ & ロードマップ

本ドキュメントは、`vsub-cli` のコア機能（動画/音声入力 → Groq Whisper 文字起こし → Gemini チャンク並列翻訳 → マルチフォーマット出力・キャッシュ・用語集）完了後における、機能拡張・UX 改善・信頼性強化・開発運用のバックログを整理したものです。

今後のイテレーションで各タスクに着手する際の設計・実装指針として活用します。

---

## 優先度サマリー

| 優先度 | 項目 | カテゴリ | 難易度 | 期待効果 | ステータス |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Completed** | 1. リアルタイム進行表示 (スピナー / プログレスバー) | CLI UX | 低〜中 | 待機中の不安解消、体感品質の大幅向上 | **完了** |
| **Completed** | 2. 処理結果サマリー表示 | CLI UX | 低 | 処理時間・字幕行数・ファイル一覧の可視化 | **完了** |
| **Completed** | 3. 出力フォーマット拡充 (`.vtt`, `.txt`, `.json`) | 機能拡張 | 低 | Web・議事録・他ツール連携への用途拡大 | **完了** |
| **Completed** | 4. ローカル E2E / 一気通貫スモークテスト機構 (`pnpm test:e2e`) | DevOps/品質 | 低 | 実ファイル・実APIによる全パイプライン自動保証 | **完了** |
| **Completed** | 5. Gemini デフォルトモデル更新 (`gemini-3.7-flash`) | 信頼性 | 低 | 最新モデルへの追従と 404/エラー解消 | **完了** |
| **Completed** | 6. 音声ファイル直接入力 (`.mp3`, `.wav`, `.m4a` 等) | 機能拡張 | 低 | ポッドキャストやボイスメモ対応 | **完了** |
| **Completed** | 7. 既存 SRT ファイル直接翻訳 (`vsub translate`) | 機能拡張 | 中 | 動画再処理なしでの再翻訳・修正後翻訳 | **完了** |
| **Completed** | 8. 複数言語一括同時翻訳 (`-t ja,en,zh`) | 機能拡張 | 中 | 多言語展開時の API 呼び出し・時間の大幅節約 | **完了** |
| **Completed** | 9. 長尺音声分割時のタイムコード精度改善 | 信頼性 | 中 | 長時間動画でのミリ秒単位の字幕ズレ防止 | **完了** |
| **Completed** | 10. 中間キャッシュ & 再開 (Resume) 機構 | 信頼性 | 中 | API エラー時・追加入力時の文字起こしやり直しコスト削減 | **完了** |
| **Completed** | 12. プロンプト / 用語集 (Glossary) 指定機能 | 機能拡張 | 低〜中 | 専門用語の誤認識防止・口調や訳語の統一 | **完了** |
| **Completed** | 13. Gemini API 並列リクエストによる高速化 | 信頼性 | 中 | 長尺動画における翻訳待機時間の短縮 | **完了** |
| **Medium** | 11. テストカバレッジ計測 & レポート (`vitest --coverage`) | DevOps | 低 | テスト網羅率の可視化と維持 | 未着手 |
| **Low** | 14. 動画への字幕焼き込み (Hardsub / Burn-in) | 機能拡張 | 中 | 字幕入り mp4 のワンストップ出力 | 未着手 |
| **Low** | 15. ファイル上書き防止 / バックアップセーフティ | CLI UX | 低 | 既存ファイルの誤削除・上書き防止 | 未着手 |
| **Low** | 16. npm パッケージ / `npx` 公開の最適化 | DevOps | 低 | インストール不要での即時実行 (`npx`) 対応・設定整備 | 未着手 |
| **Low** | 17. GitHub Releases & スタンドアロンバイナリ配布 | DevOps | 中 | Node.js 未導入ユーザー向け単体バイナリ配布 | 未着手 |
| **Low** | 18. GitHub Actions (CI) 自動テストの構築 | DevOps | 低 | チーム開発移行時の自動化（現状は手元検証を優先） | 未着手 |
| **Low** | 19. モデル指定オプション (`--gemini-model`, `--groq-model`) | 機能拡張 | 低 | 将来の新世代モデルや特定モデルへの柔軟な切り替え | 未着手 |

---

## 1. 完了済み機能 (Completed Features)

### 1.1 CLI UX & 進行状況表示
* **リアルタイム進行表示 (スピナー)**: `ora` によるステップごとのスピナー表示（音声抽出/最適化 → Groq Whisper → Gemini 並列翻訳 → 字幕保存）。
* **処理結果サマリー表示**: 処理完了時に所要時間、対象メディア、検出言語、翻訳言語、生成行数、出力ファイル一覧を整形表示。
* **対応ファイル**: `src/ui.ts`, `src/index.ts`

### 1.2 出力フォーマット拡充 (`.vtt`, `.txt`, `.json`)
* `-f, --format <formats>` オプション（カンマ区切りで複数指定可能）。
* **WebVTT (`.vtt`)**: Web ブラウザや HTML5 `<video>`、YouTube 等に対応。
* **プレーンテキスト (`.txt`)**: タイムコードなしの文字起こし全文（要約・議事録用途）。
* **JSON (`.json`)**: タイムコードを含む構造化データ配列（外部連携用）。
* **対応ファイル**: `src/formatter.ts`, `src/formatter.test.ts`, `src/index.ts`

### 1.3 既存 SRT ファイル直接翻訳サブコマンド (`vsub translate`)
* `vsub translate <file.srt> -t <targetLang> [-f formats] [-o output]` サブコマンドを新設。
* 音声抽出・Whisper 処理（Groq）をスキップし、Gemini API のみで SRT パース → チャンク翻訳 → マルチフォーマット保存を実行。
* **対応ファイル**: `src/index.ts`, `src/config.ts`, `src/ui.ts`

### 1.4 音声ファイル直接入力対応
* 動画ファイルだけでなく、`.mp3`, `.wav`, `.m4a`, `.aac`, `.flac`, `.ogg`, `.opus`, `.wma` 等の音声ファイルを自動認識。
* 音声ファイルの場合は「音声最適化」、動画の場合は「音声抽出」としてスピナーやサマリー表示を動的切り替え。
* **対応ファイル**: `src/ffmpeg.ts`, `src/ffmpeg.test.ts`, `src/index.ts`

### 1.5 複数言語一括同時翻訳 (`-t ja,en,zh`)
* `-t ja,en,zh` のように複数言語をカンマ区切りで指定可能。
* Groq 文字起こしは 1 回のみ実行し、各ターゲット言語の字幕を一括出力。検出言語と一致する言語は自動で原文を採用。
* **対応ファイル**: `src/languages.ts`, `src/languages.test.ts`, `src/index.ts`

### 1.6 プロンプト / 用語集 (Glossary) 指定機能
* `src/glossary.ts` モジュール（JSON 用語集ファイル、インライン対訳、Gemini 向け対訳ルール生成、Whisper ヒント自動抽出）。
* `--whisper-prompt <text>`: Groq Whisper API のヒントテキスト。
* `--glossary <path-or-terms>`: 用語集（JSON または `Key=Val,Key=Val`）。
* `--prompt <instruction>`: Gemini 翻訳プロンプトへの口調・スタイル指示注入。
* グローバル設定 (`vsub config set`) による永続化と、プロンプト変更を検知するキャッシュ整合性。
* **対応ファイル**: `src/glossary.ts`, `src/groq.ts`, `src/gemini.ts`, `src/config.ts`, `src/cache.ts`, `src/index.ts`

### 1.7 長尺音声分割時のタイムコード精度改善
* `ffprobe` および `ffmpeg` による高精度秒数取得。
* 24.5MB 超過による音声分割時に各分割セグメントの実再生時間をミリ秒精度で計測し、累積加算による字幕ズレを完全解消。
* **対応ファイル**: `src/ffmpeg.ts`, `src/groq.ts`, `src/index.ts`

### 1.8 中間キャッシュ & 再開 (Resume) 機構
* `src/cache.ts` モジュール（OS 標準キャッシュディレクトリ、ファイルサイズ+更新日時の SHA-256 キー生成）。
* Groq 文字起こし結果および Gemini 各言語翻訳結果を中間保存。
* `--no-cache`, `--fresh`, `--cache-dir` オプションおよび `vsub cache (path|stats|clean)` サブコマンドを提供。
* **対応ファイル**: `src/cache.ts`, `src/cache.test.ts`, `src/index.ts`

### 1.9 Gemini API 並列リクエスト制御 & モデル更新
* ゼロ依存の非同期ワーカプール（`asyncPool`）を実装し、指定並行数（デフォルト: 3 並列）でチャンク並行翻訳。
* 429 / レートリミット検知とランダムジッター付き指数バックオフ再試行。
* `--concurrency <num>` CLI オプション、`VSUB_CONCURRENCY` 環境変数、`vsub config set --concurrency` による柔軟な設定。
* Gemini デフォルトモデルを最新の `gemini-3.7-flash` に更新。
* **対応ファイル**: `src/gemini.ts`, `src/gemini.test.ts`, `src/config.ts`, `src/index.ts`

---

## 2. 今後の改善バックログ (Backlog & Future Work)

### 2.1 テストカバレッジ計測 & レポート (`vitest --coverage`) 【優先度: Medium】
* **背景/課題**: 単体テストの網羅率（C0/C1 カバレッジ）が数値化されていない。
* **提案内容**:
  * `@vitest/coverage-v8` を導入し、`package.json` に `"test:coverage": "vitest run --coverage"` スクリプトを追加。
  * `vitest.config.ts` でカバレッジ対象（`src/**/*.ts`）および除外設定（`src/index.ts`, `**/*.test.ts` 等）を構成。
* **対応スコープ**: `package.json`, `vitest.config.ts`

### 2.2 動画への字幕焼き込み (Hardsub / Burn-in) 【優先度: Low】
* **背景/課題**: 字幕ファイルを別体で扱うのではなく、動画自体に字幕が焼き込まれたファイル（SNS 投稿用・プレビュー用）が欲しいケースがある。
* **提案内容**:
  * `--burn` オプションまたは `vsub burn <video> <srt>` サブコマンド。
  * FFmpeg の `subtitles` フィルタを利用して、字幕が合成された動画（`sample.subbed.mp4`）を出力。
* **対応スコープ**: `src/ffmpeg.ts`, `src/index.ts`

### 2.3 ファイル上書き防止 / バックアップセーフティ 【優先度: Low】
* **背景/課題**: 出力先に同名の字幕ファイルが既に存在する場合、確認なしで上書きされてしまう。
* **提案内容**:
  * `--overwrite` / `-f` フラグがない場合、対話環境では上書き確認プロンプトを表示、または `.bak.srt` などのバックアップを作成。
* **対応スコープ**: `src/index.ts`

### 2.4 npm パッケージ / `npx` 公開設定の最適化 【優先度: Low】
* **背景/課題**: リポジトリを clone せずに `npx vsub-cli` や `npm i -g vsub-cli` で利用できるようにするためのパッケージ設定が必要。
* **提案内容**:
  * `package.json` の `files` フィールドに `["dist", "README.md", "README.ja.md", "LICENSE"]` を設定し、ソースコードやテストファイルを除外して軽量化。
  * `prepublishOnly` スクリプトに `pnpm check && pnpm test && pnpm build` を追加し、ビルド漏れやテスト失敗時の publish 事故を防止。
  * メタデータ（`repository`, `keywords`, `bugs`, `homepage` 等）の拡充。
* **対応スコープ**: `package.json`

### 2.5 GitHub Releases & スタンドアロンバイナリ配布 【優先度: Low】
* **背景/課題**: Node.js や pnpm をインストールしていない一般ユーザー向けに単体実行バイナリを提供したい。
* **提案内容**:
  * Node.js SEA (Single Executable Applications) 等を用いて、Windows (`.exe`), macOS, Linux 向けの単体実行バイナリをビルド。
  * GitHub Releases に各 OS 向けバイナリを自動アップロードする Release ワークフローの構築。
* **対応スコープ**: `.github/workflows/release.yml`, ビルドスクリプト

### 2.6 GitHub Actions (CI) 自動テストの構築 【優先度: Low】
* **背景/課題**: PR や push 時に自動でリント・型チェック・テストが実行される仕組み。
* **提案内容**:
  * `.github/workflows/ci.yml` を作成。
  * `pnpm check` (Biome), `pnpm test` (Vitest), `pnpm build` (TypeScript) の自動検証。
* **対応スコープ**: `.github/workflows/ci.yml`

### 2.7 モデル指定オプションの柔軟化 (`--gemini-model`, `--groq-model`) 【優先度: Low】
* **背景/課題**: 将来の新世代モデル登場時や、特定の Groq/Gemini モデルを検証したい場合に備えてモデル名を柔軟に切り替えられるようにする。
* **提案内容**:
  * `--gemini-model <model>`, `--groq-model <model>` CLI オプションの追加。
  * `vsub config set --gemini-model ...` による永続化。
* **対応スコープ**: `src/gemini.ts`, `src/groq.ts`, `src/config.ts`, `src/index.ts`
