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
| **Completed** | 19. モデル指定オプション (`--gemini-model`, `--groq-model`) | 機能拡張 | 低 | 将来の新世代モデルや特定モデルへの柔軟な切り替え | **完了** |
| **Completed** | 14. 動画への字幕焼き込み (Hardsub / Burn-in) | 機能拡張 | 中 | 字幕入り mp4 のワンストップ出力 | **完了** |
| **Completed** | 15. ファイル上書き防止 / バックアップセーフティ | CLI UX | 低 | 既存ファイルの誤削除・上書き防止 | **完了** |
| **Completed** | 11. テストカバレッジ計測 & レポート (`vitest --coverage`) | DevOps/品質 | 低 | テスト網羅率の可視化と維持 | **完了** |
| **Completed** | 18. GitHub Actions CI (Node マトリックス + FFmpeg 実機) & Dependabot | DevOps/CI | 低 | 複数 Node.js 互換性保証と依存関係・脆弱性の自動更新 | **完了** |
| **Completed** | 16. npm 公開 & Release Please 全自動リリースパイプライン | DevOps/配布 | 低〜中 | トランク開発を維持した SemVer / CHANGELOG / npm publish 自動化 | **完了** |
| **Completed** | 17. AI モデル新着自動監視 & 重複防止 Issue 通知ワークフロー | DevOps/自動化 | 低 | Groq / Gemini API の新モデル検知と自動 Issue 起票 | **完了** |
| **Completed** | 20. 二言語併記 / バイリンガル字幕モード (`--bilingual` / `-b`) | 機能拡張/UX | 低〜中 | 語学学習や国際配信向け2言語同時字幕・同時焼き込み | **完了** |
| **Completed** | 21. ディレクトリ / バッチ一括処理モード (`vsub batch` / glob) | 機能拡張/UX | 中 | 複数メディアファイルの一括自動文字起こし・翻訳 | **完了** |
| **Medium** | 22. 対話型初期セットアップ & 導通確認ウィザード (`vsub init`) | CLI UX | 低 | API キー・FFmpeg・デフォルト言語の対話的初期導入と導通保証 | 未着手 |
| **Low** | 23. GitHub Releases & スタンドアロンバイナリ配布 | DevOps | 中 | Node.js 未導入ユーザー向け単体バイナリ配布 | 未着手 |

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

### 1.10 モデル指定オプションの柔軟化 (`--gemini-model`, `--groq-model`)
* `--gemini-model <model>`, `--groq-model <model>` CLI オプションの追加。
* `VSUB_GEMINI_MODEL`, `VSUB_GROQ_MODEL` 環境変数のサポート。
* `vsub config set [--gemini-model <model>] [--groq-model <model>]` による永続化と `vsub config show` での表示。
* キャッシュ整合性判定（モデル名変更時の自動無効化）を組み込み、新モデル実験時やモデル切り替え時の安全性を担保。
* **対応ファイル**: `src/config.ts`, `src/config.test.ts`, `src/groq.ts`, `src/groq.test.ts`, `src/gemini.ts`, `src/gemini.test.ts`, `src/cache.ts`, `src/cache.test.ts`, `src/index.ts`

### 1.11 動画への字幕焼き込み (Hardsub / Burn-in)
* FFmpeg の `subtitles` フィルタと `libx264` エンコーダを活用し、字幕が合成された mp4 動画を出力。
* Windows ドライブレター `:` やシングルクォート・特殊文字の安全なフィルタグラフエスケープ関数 (`escapeFfmpegFilterPath`) を実装。
* メインアクションへの `--burn` フラグ追加（文字起こし・翻訳から一気通貫で字幕入り動画を出力）。
* 単体実行用の `vsub burn <video-file> <subtitle-file>` サブコマンドを新設。
* **対応ファイル**: `src/ffmpeg.ts`, `src/ffmpeg.test.ts`, `src/index.ts`

### 1.12 ファイル上書き防止 / バックアップセーフティ
* `src/safety.ts` モジュール（既存ファイル検知、`.bak` / `.bak.N` 自動連番バックアップ生成、対話式確認プロンプト）。
* 重い API 呼び出し（Groq / Gemini）や動画レンダリング（FFmpeg）を開始する**前**に早期衝突検知・確認を実施。
* `-w, --overwrite`: 確認なしでの強制上書きフラグ。
* `--backup`: 既存ファイルを `.bak` として安全に退避保存するフラグ。
* 対話環境（TTY）での確認プロンプト（`y/N`）および非対話環境での安全例外停止。
* メインコマンド (`vsub`)、字幕翻訳 (`vsub translate`)、字幕焼き込み (`vsub burn`) に一貫適用。
* 処理結果サマリー (`formatSummaryBox`) へのバックアップファイル一覧表示。
* **対応ファイル**: `src/safety.ts`, `src/safety.test.ts`, `src/ui.ts`, `src/ui.test.ts`, `src/index.ts`

### 1.13 テストカバレッジ計測 & レポート (`vitest --coverage`)
* `@vitest/coverage-v8` を導入し、`pnpm test:coverage` スクリプトを追加。
* `vitest.config.ts` でカバレッジ対象（`src/**/*.ts`）および除外設定（`src/index.ts`, `**/*.test.ts`）を構成。
* HTML レポート（`coverage/`）、テキストサマリー、JSON サマリーを自動生成。
* 全 11 コアモジュールで 80% 超のラインカバレッジおよび 100% の関数カバレッジ（主要モジュール）を達成。
### 1.14 GitHub Actions CI (Node マトリックス + FFmpeg 実機) & Dependabot 自動化
* **CI ワークフロー (`.github/workflows/ci.yml`)**:
  * `ubuntu-latest`（FFmpeg プリインストール済み環境）で `pnpm check` (Biome), `pnpm test:coverage` (Vitest), `pnpm build` (TypeScript) を自動実行。
  * Node.js 年1回 LTS 化スケジュール（Node 26, Node 27...）に対応するため、`strategy.matrix.node-version: [24, 26]` での複数バージョン動作保証。
  * `ffmpeg -version` 事前検証および単体テスト内の FFmpeg 連携処理（実機テスト）の自動実行。
* **Dependabot & Auto-Merge (`.github/dependabot.yml`, `.github/workflows/dependabot-auto-merge.yml`)**:
  * npm 依存ライブラリ（`npm`）および GitHub Actions（`github-actions`）の更新を毎週月曜に監視。
  * **Patch / Minor**: `dependabot/fetch-metadata` による判定と CI 通過を条件に自動承認・Auto-merge（`--auto --squash`）を適用。
  * **Major (破壊的変更)**: 自動マージせず PR 作成にとどめ、CHANGELOG 手動確認後にマージ。
* **対応ファイル**: `.github/workflows/ci.yml`, `.github/dependabot.yml`, `.github/workflows/dependabot-auto-merge.yml`, `docs/backlog.md`

### 1.15 OSS 運用テンプレート & ガイドライン整備 & リポジトリメタデータ
* **Issue / PR テンプレート (`.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md`)**:
  * `bug_report.yml`: OS、Node.js バージョン、FFmpeg バージョン、実行コマンド、エラーログ入力を構造化。
  * `feature_request.yml`: 課題と提案内容の明記を促す構造化フォーム。
  * `config.yml`: GitHub Discussions への誘導リンク。
  * `PULL_REQUEST_TEMPLATE.md`: 変更概要および検証チェックリスト（`pnpm check`, `pnpm test`, `pnpm build`）。
* **コントリビューション規約 (`CONTRIBUTING.md`)**:
  * トランクベース開発（`main` 直接マージ運用）の推奨。
  * The Unlicense に基づく無償・無保証・ベストエフォート運用方針の明文化。
* **パッケージメタデータ整備 (`package.json`)**:
  * `repository`, `homepage`, `bugs`, `files` を設定し、OSS リポジトリとしての完全性を担保。
### 1.16 npm 公開 & Release Please 全自動リリースパイプライン
* **Release Please ワークフロー (`.github/workflows/release.yml`)**:
  * Google 製 `google-github-actions/release-please-action` を導入。
  * Conventional Commits (`feat:`, `fix:`, `refactor:`, `chore:` 等) に連動して `chore: release vX.Y.Z` リリース準備 PR を自動生成・更新。
  * リリース PR マージ時に GitHub Tag (`vX.Y.Z`)、GitHub Releases、および `CHANGELOG.md` を自動更新。
* **npm Publish 自動化 (Provenance 付き)**:
  * リリース PR マージを契機に `pnpm build` を実行し、`pnpm publish --provenance --access public` で npm レジストリへ自動公開。
  * `package.json` の `prepublishOnly`（`pnpm check && pnpm test && pnpm build`）により、不完全な状態での公開を防止。
  * `publishConfig` (`access: "public"`, `provenance: true`) を構成。
### 1.17 AI モデル新着自動監視 & 重複防止 Issue 通知ワークフロー
* **定期監視ワークフロー (`.github/workflows/model-watch.yml`)**:
  * 毎週月曜日 0:00 UTC に定期実行（`cron`）および手動実行（`workflow_dispatch`）。
  * Google Gemini API (`@google/genai`) および Groq API (`groq-sdk`) のモデル一覧エンドポイントを取得。
  * `gemini-*-flash` や `whisper-*` 等の字幕生成・翻訳に関連する新着モデルを自動検知。
* **重複防止 Issue 起票 & メタデータ連携 (`scripts/watch-models.ts`)**:
  * 既に Open または過去に Closed 済みの Issue を `gh issue list --state all` で検索し、同一モデルに対するゾンビ・重複起票を防止。
  * 新モデル検知時に表示名、最大トークン数、説明文、Artificial Analysis / 公式ドキュメントへのベンチマーク比較リンク、および `vsub` CLI での即時検証コマンド（`--gemini-model`, `--groq-model`）を整形した Issue を自動起票。
  * GitHub Step Summary に検知結果サマリーを出力。
* **対応ファイル**: `.github/workflows/model-watch.yml`, `scripts/watch-models.ts`, `scripts/watch-models.test.ts`, `package.json`, `docs/backlog.md`

### 1.18 二言語併記 / バイリンガル字幕モード (`--bilingual` / `-b`)
* **バイリンガル字幕マージ (`mergeBilingualEntries`)**:
  * 原語（文字起こし結果）と翻訳先言語（Gemini 結果）の SrtEntry をタイムコードベースで自動マージ。
  * 同一文字列時の重複排除や、欠落・空行時の安全なフォールバック処理を実装。
* **柔軟な並び順指定 (`--bilingual-order original-first|target-first`)**:
  * 上段に原語・下段に訳語（`original-first`、デフォルト）または上段に訳語・下段に原語（`target-first`）を選択可能。
* **フルパイプライン対応**:
  * 全出力フォーマット（`.srt`, `.vtt`, `.txt`, `.json`）および動画焼き込み（`--burn`）に対応。
  * `vsub <media>` メインコマンドおよび `vsub translate <sub.srt>` サブコマンドの双方で利用可能。
* **サマリー表示 & 安全性連携**:
  * 処理結果サマリー (`formatSummaryBox`) へのバイリンガルモードおよび並び順表示。
  * 出力先衝突防止・バックアップセーフティ（`ensureWritableTargets`）に `.bilingual.` ファイルパスを事前登録。
* **対応ファイル**: `src/srt.ts`, `src/srt.test.ts`, `src/ui.ts`, `src/ui.test.ts`, `src/index.ts`, `README.md`, `README.ja.md`, `docs/prd.md`, `docs/backlog.md`

### 1.19 ディレクトリ / バッチ一括処理モード (`vsub batch` / glob)
* **ファイル検出エンジン (`findMediaFiles`)**:
  * 指定された複数メディアパス、ディレクトリ、および glob パターン（`*.mp4` 等）を自動走査・正規化。
  * `-r, --recursive`（デフォルト: `true`）による階層的な動画・音声検出と、`.git`, `node_modules`, `.cache`, `.bak` 等の不要ディレクトリ・ファイルの自動除外。
  * 重複排除と自然順ソートによる決定論的な処理順序の保証。
* **パイプライン共通化 & バッチランナー (`src/pipeline.ts`, `src/batch.ts`)**:
  * 単一ファイル処理とバッチ処理で同一のコアパイプラインを共有し、機能の完全な等価性を維持。
  * 事前 API キー / FFmpeg 導通検証。
  * ファイルごとの逐次キュー実行とエラー耐性（1ファイルの失敗で全体を止めずに後続を処理。`--fail-fast` による即時中断も選択可能）。
  * `-o, --output-dir <dir>` によるバッチ生成先の一括集約対応。
* **総合サマリー表示 (`formatBatchSummaryBox`)**:
  * 全ファイル完了時に処理総数、成功数、失敗数、スキップ数、合計所要時間、ファイル別の生成物・エラー詳細を構造化表示。
* **対応ファイル**: `src/pipeline.ts`, `src/pipeline.test.ts`, `src/batch.ts`, `src/batch.test.ts`, `src/ui.ts`, `src/ui.test.ts`, `src/index.ts`, `README.md`, `README.ja.md`, `docs/prd.md`, `docs/backlog.md`

---

## 2. 今後の改善バックログ (Backlog & Future Work)

### 2.1 対話型初期セットアップ & 導通確認ウィザード (`vsub init`) 【優先度: Medium】
* **背景/課題**: 初回利用時に Groq API キー、Gemini API キー、FFmpeg のパス確認、デフォルト翻訳言語などの設定手順が分散しており、初心者ユーザーのセットアップ摩擦が生じやすい。
* **提案内容**:
  * `vsub init` コマンドで対話型ウィザードを起動（API キー入力・接続テスト・`~/.vsubrc` への保存）。
  * システム内の FFmpeg / FFprobe の自動検知と未導入時のインストール案内。
  * デフォルト翻訳先言語（例: `ja`）やモデルの初期登録。
* **対応スコープ**: `src/index.ts`, `src/config.ts`, `src/init.ts` (新設)

### 2.2 GitHub Releases & スタンドアロンバイナリ配布 【優先度: Low】
* **背景/課題**: Node.js や pnpm をインストールしていない一般ユーザー向けに単体実行バイナリを提供したい。
* **提案内容**:
  * Node.js SEA (Single Executable Applications) 等を用いて、Windows (`.exe`), macOS, Linux 向けの単体実行バイナリをビルド。
  * GitHub Releases に各 OS 向けバイナリを自動アップロードする Release ワークフローの構築。
* **対応スコープ**: `.github/workflows/release.yml`, ビルドスクリプト

