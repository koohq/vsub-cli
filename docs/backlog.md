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
| **Completed** | 5. Gemini デフォルトモデル更新 (`gemini-3.8-flash`) | 信頼性 | 低 | 最新モデルへの追従と 404/エラー解消 | **完了** |
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
| **Completed** | 22. 対話型初期セットアップ & 導通確認ウィザード (`vsub init`) | CLI UX | 低 | API キー・FFmpeg・デフォルト言語の対話的初期導入と導通保証 | **完了** |
| **Completed** | 23. GitHub Releases & スタンドアロンバイナリ配布 (SEA) | DevOps/配布 | 中 | Node.js 未導入ユーザー向け単体バイナリ配布 & OSS ライセンス保護 | **完了** |
| **High** | 24. 新バージョン検知・通知 & スタンドアロンバイナリ self-update 機構 (`vsub update`) | CLI UX / 配布 | 中 | 手動更新の手間解消、最新モデルや新機能への迅速な追従、バイナリ版のUX大幅向上 | **Phase 1完了 / Phase 2未着手** |

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
* Gemini デフォルトモデルを最新の `gemini-3.8-flash` に更新。
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
  * MIT License に基づく無償・無保証・ベストエフォート運用方針の明文化。
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

### 1.20 対話型初期セットアップ & 導通確認ウィザード (`vsub init`)
* **対話型セットアップ (`runInitWizard`)**:
  * `vsub init`（および `vsub config init`）で起動する対話型初期導入ウィザード。
  * **Groq API 導通確認**: 入力された API キーを用いて Groq モデル一覧エンドポイントへの疎通を即時テストし成否を判定。
  * **Gemini API 導通確認**: 入力された API キーを用いて Gemini モデル情報取得による疎通を即時テストし成否を判定。
  * **FFmpeg / FFprobe 環境確認**: システム内の FFmpeg 実行可能状態・バージョンを検出し、未検出時は OS 別インストールコマンドを案内。
  * **デフォルト言語・モデル永続化**: デフォルト翻訳先言語（`ja` 等）やモデル設定を含めてグローバル設定ファイル（`config.json`）へ一括保存。
* **対応ファイル**: `src/init.ts`, `src/init.test.ts`, `src/config.ts`, `src/index.ts`, `README.md`, `README.ja.md`, `docs/backlog.md`

### 1.21 GitHub Releases & スタンドアロンバイナリ配布 (SEA) & サードパーティライセンス保護
* **Node.js SEA (Single Executable Applications) バイナリビルド**:
  * Node.js 26 の `node --build-sea` および `esbuild` による自己完結型単一バイナリ生成スクリプト (`scripts/build-binary.ts`)。
  * ターゲット別命名規則（`vsub-windows-x64.exe`, `vsub-windows-arm64.exe`, `vsub-linux-x64`, `vsub-linux-arm64`, `vsub-macos-arm64`, `vsub-macos-x64`）。
  * macOS 向け ad-hoc コード署名 (`codesign --sign -`)、SHA-256 チェックサム算出、バイナリ自己検証テスト機構を内蔵。
* **GitHub Actions 6マトリックス自動ビルド & アセット添付 (`.github/workflows/release.yml`)**:
  * Windows (x64, arm64), Linux (x64, arm64), macOS (arm64, x64) の最新 Standard Runners 6 パターンでネイティブビルド。
  * Release Please と連動し、GitHub Releases に全バイナリ、`SHA256SUMS.txt`、およびライセンスファイルを全自動添付。
* **サードパーティライセンス自動抽出 & CLI 表示 (`vsub licenses`)**:
  * `scripts/generate-licenses.ts` により本番依存パッケージのライセンス条文（MIT, Apache-2.0, BSD 等）を抽出し `dist/THIRD_PARTY_LICENSES.txt` および `src/licenses.data.ts` を自動生成。
  * `vsub licenses`（および `--full`）サブコマンドにより、ターミナル上でいつでも法的告知と全文条文を確認可能。
* **対応ファイル**: `scripts/build-binary.ts`, `scripts/build-binary.test.ts`, `scripts/generate-licenses.ts`, `src/licenses.ts`, `src/licenses.test.ts`, `src/licenses.data.ts`, `src/index.ts`, `.github/workflows/release.yml`, `package.json`, `docs/backlog.md`, `README.md`, `README.ja.md`

### 1.22 新バージョン検知 & 通知 (Update Notifier - Phase 1)
* **レートリミット対策 24 時間キャッシュ (`loadUpdateCache` / `saveUpdateCache`)**:
  * GitHub Releases API (`/repos/koohq/vsub-cli/releases/latest`) の未認証アクセス制限（60 req/h）を保護するため、グローバル設定ディレクトリ（`~/.config/vsub/update-cache.json` または `%APPDATA%/vsub/update-cache.json`）に最終チェック時刻と最新バージョンをキャッシュ。
  * 最低 24 時間は再チェックを行わず、ネットワーク通信・待機時間をゼロ化。
* **非侵入的枠付き通知 (`formatUpdateNotification`)**:
  * コマンド（`vsub <media>`, `vsub translate`, `vsub burn`, `vsub batch`）完了時に、最新版が利用可能な場合のみ端末末尾に通知枠を表示。
  * 実行環境（`isStandaloneBinary`）を自動検出し、npm 環境では `npm i -g vsub-cli`、スタンドアロンバイナリでは `vsub update` を適切に案内。
  * 多言語対応（英語・日本語）を組み込み。
* **オプトアウト設定**:
  * `--no-update-check` CLI オプションの追加。
  * `vsub config set --disable-update-check true` および環境変数 `VSUB_NO_UPDATE_CHECK` / `VSUB_DISABLE_UPDATE_CHECK` による永続的な通知無効化をサポート。
  * `vsub config show` での更新チェック状態（Enabled / Disabled）表示。
* **対応ファイル**: `src/version.ts`, `src/version.test.ts`, `src/updater.ts`, `src/updater.test.ts`, `src/config.ts`, `src/config.test.ts`, `src/index.ts`, `src/i18n/en.ts`, `src/i18n/ja.ts`, `scripts/build-binary.ts`

---

---

## 2. 次期イテレーション・未着手バックログ (Next Candidates)

### 2.1 新バージョン検知・通知 & スタンドアロンバイナリ self-update 機構 (`vsub update`)

#### 概要・背景 (Why)
* **課題**:
  * 現在の `vsub-cli` は、npm インストールおよび GitHub Releases 経由のスタンドアロンバイナリの双方が**完全手動更新**となっている。
  * 新機能の追加、Gemini / Groq のモデル変更、バグ修正が行われた際にユーザーが最新版の存在に気付きにくい。
  * 特にスタンドアロンバイナリ利用者は GitHub Releases ページから OS/Arch 別のアーカイブ（`.zip` / `.tar.gz`）を手動で再ダウンロードして既存ファイルを置き換える必要があり、更新の心理的・運用的ハードルが高い。
* **目的**:
  * コマンド利用時に新バージョンを非侵入的に通知する（Phase 1 で完了）。
  * スタンドアロンバイナリ環境において、ワンコマンド（`vsub update`）で安全・確実に自己更新（self-update）を完結できるようにする（Phase 2）。

#### 機能要件・フェーズ構成 (What)

##### 【Phase 1】新バージョン検知 & 通知 (Update Notifier) 【完了】
* **定期チェック & レートリミット対策**:
  * コマンド実行完了後に GitHub Releases API (`/repos/koohq/vsub-cli/releases/latest`) をチェック。
  * 未認証 GitHub API のレート制限を消費しないよう、最終チェック時刻と最新バージョンをローカル設定ディレクトリ（`~/.vsub/` 内）にキャッシュし、**最低 24 時間は再チェックを行わない**。
* **非侵入的な更新案内**:
  * 処理結果サマリーの直後に枠付きで通知を出力。
    * **npm / pnpm 実行時**: `💡 新しいバージョン vX.Y.Z が利用可能です (現在: vA.B.C) -> 更新コマンド: npm i -g vsub-cli`
    * **スタンドアロンバイナリ実行時**: `💡 新しいバージョン vX.Y.Z が利用可能です (現在: vA.B.C) -> 更新コマンド: vsub update`
* **オプトアウト設定**:
  * `--no-update-check` オプション、または `vsub config set --disable-update-check true` により通知機能を無効化可能。

##### 【Phase 2】自己更新サブコマンド (`vsub update` / `vsub upgrade`)
* **実行環境の自動判別**:
  * `process.execPath` やバイナリ名、パッケージメタデータから「npm/Node.js 実行」か「Node SEA スタンドアロンバイナリ」かを自動判別。
  * npm 環境の場合は、`npm install -g vsub-cli@latest`（または `pnpm add -g vsub-cli`）を実行確認の上で代行するか、案内を表示して終了。
* **スタンドアロンバイナリ更新パイプライン**:
  1. **対象アセットの特定**:
     * GitHub Releases API の最新リリース情報から、現在のプラットフォーム（`process.platform`）およびアーキテクチャ（`process.arch`）に一致するアーカイブ（`vsub-windows-x64.zip`, `vsub-macos-arm64.tar.gz` 等）と `.sha256` ファイルのダウンロード URL を抽出。
  2. **一時ディレクトリへのダウンロード**:
     * `os.tmpdir()` 配下に一時ディレクトリを作成し、アーカイブと `.sha256` をダウンロード。
  3. **SHA-256 チェックサム検証**:
     * ダウンロードしたアーカイブの SHA-256 ハッシュを算出し、`.sha256` ファイルの内容と照合。不一致時は即座に中断して破損・改ざんを防止。
  4. **アーカイブ解凍**:
     * Windows は `.zip`、Linux/macOS は `.tar.gz` を一時領域に安全に展開。
  5. **OS 別安全置換 & フェイルセーフ（最重要）**:
     * **Windows (実行中ファイルロック対策)**:
       * 実行中の `.exe` ファイルは OS のロックにより直接上書き・削除ができない（`EBUSY`）。
       * ただしリネームは許可されているため、既存バイナリ（`vsub.exe`）を一時的に `vsub.exe.old`（または `vsub.exe.deleteme`）へリネーム退避。
       * 新しい `vsub.exe` を元のパスへ配置。
       * 配置途中でエラーが発生した場合は即座に `vsub.exe.old` を元に戻すロールバック処理を実行。
       * 次回起動時（または処理終了直後）に古い `.old` ファイルを自動検出してクリーンアップ。
     * **Linux / macOS**:
       * 新バイナリに実行権限（`chmod 0o755`）を付与し、既存バイナリパスへアトミック置換（`fs.rename`）。
       * macOS の場合は Gatekeeper 隔離属性（`com.apple.quarantine`）の解除、または ad-hoc 署名状態を担保。
     * **パーミッション不足のハンドリング**:
       * バイナリが `/usr/local/bin` 等の管理者権限領域に置かれており書き込み権限がない場合（`EACCES` / `EPERM`）、ユーザーに「管理者権限（例: `sudo vsub update`）で再実行してください」と分かりやすいガイダンスを表示。
  6. **検証と完了報告**:
     * 置換完了後、更新後のバイナリで `--version` を内部検証実行。
     * 正常終了時に更新前後バージョン、更新された実行パス、CHANGELOG へのリンクを表示。

#### アーキテクチャ設計・対応予定ファイル
* `src/updater.ts` (新規): バージョン比較、GitHub Releases API 連携、24時間キャッシュ管理、アセットダウンロード、SHA-256 検証、OS 別バイナリ置換ロジック
* `src/updater.test.ts` (新規): モックを用いた API 取得、レート制限キャッシュ、ハッシュ照合、Windows リネーム退避、ロールバック等の Vitest 単体テスト
* `src/index.ts`: `vsub update` サブコマンド追加、CLI 終了フックへの更新通知組み込み
* `src/config.ts`: アップデート通知の有効/無効設定、最終チェックキャッシュの永続化
* `README.md`, `README.ja.md`, `docs/prd.md`: `vsub update` コマンドおよびアップデート仕様の記載

---

## 3. ロードマップ進捗状況 (Roadmap Status)

* **初期ロードマップ (全 23 タスク)**: コア機能・UX 強化・DevOps/CI/CD・スタンドアロンバイナリ配布を含め、すべて完了。
* **次期イテレーション (v1.4+)**: スタンドアロンバイナリ運用をさらに強固にする「新バージョン検知・通知 & self-update 機構 (`vsub update`)」をバックログとして起票。準備が整い次第、段階的（Phase 1: 通知 → Phase 2: 自動置換）に着手予定。





