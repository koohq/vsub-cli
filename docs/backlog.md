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
| **Completed** | 24. 新バージョン検知・通知 & スタンドアロンバイナリ self-update 機構 (`vsub update`) | CLI UX / 配布 | 中 | 手動更新の手間解消、最新モデルや新機能への迅速な追従、バイナリ版のUX大幅向上 | **完了** |
| **High** | 25. チャンク境界の文脈引き継ぎ翻訳 (Sliding Window Context) & 構造保証 | 翻訳品質/信頼性 | 低〜中 | 並列速度を維持したままチャンク切れ目の口調・文脈ブレを解消、行数不一致防止 | **未着手** |
| **High** | 26. 長文セグメントのスマート自動分割・リフロー (Subtitle Reflow) | 字幕品質/UX | 中 | 早口トーク等で1画面に長文が詰まる問題を解消し、読みやすい字幕長に自動調整 | **未着手** |
| **High** | 27. 標準出力モード (`--stdout`) & AI エージェント / パイプ連携強化 | CLI UX / Agentic DX | 低〜中 | 一時ファイルなしで字幕・文字起こしを直接 `stdout` へ出力しパイプ・AI連携を容易化 | **未着手** |
| **Medium** | 28. AI チャプター生成 & 要約サブコマンド (`vsub chapters` / `vsub summarize`) | 機能拡張 / Agentic DX | 中 | 既存の文字起こし＆キャッシュ資産を活かし、YouTubeチャプターや要約を即時生成 | **未着手** |
| **Medium** | 29. 動画へのソフトサブ（字幕トラック）高速埋め込み (`--embed` / `vsub embed`) | 機能拡張/メディア処理 | 中 | 映像の再エンコードなし（無劣化・数秒）で複数言語のON/OFF可能な字幕トラックを格納 | **未着手** |
| **Low** | 30. 字幕焼き込み (`--burn`) の位置・フォントサイズ調整オプション | CLI UX / メディア処理 | 低 | 既存テロップとの被り回避（上/中央配置）やスマホ視聴向けの文字サイズ変更に対応 | **未着手** |

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

### 1.23 スタンドアロンバイナリ自己更新 (`vsub update` / `vsub upgrade` - Phase 2)
* **実行環境の自動判別 (`isStandaloneBinary`)**:
  * Node.js / npm 環境下で実行された場合は `npm i -g vsub-cli@latest` を案内し、バイナリ破壊を防止。
  * スタンドアロン SEA バイナリ環境でのみ直接自己更新パイプラインを実行。
* **堅牢な更新パイプライン (`performSelfUpdate`)**:
  1. **GitHub Releases API 連携 (`fetchReleaseDetails`)**: 最新リリースおよびプラットフォーム（Windows, macOS, Linux）・アーキテクチャ（x64, arm64）に応じたアセット URL（`.zip` / `.tar.gz`）を取得。
  2. **一時ディレクトリ安全ダウンロード (`downloadFile`)**: `os.tmpdir()` 配下に一時領域を作成し、アーカイブおよび `SHA256SUMS.txt` を取得。
  3. **SHA-256 チェックサム検証 (`computeSha256`, `parseChecksumFile`)**: ダウンロードしたアーカイブの完全性を検証し、破損・改ざんを防止。
  4. **アーカイブ解凍 (`extractArchive`)**: `tar -xf`（Windows では PowerShell `Expand-Archive` へのフォールバック付き）で安全に展開。
  5. **Windows オープンファイル安全置換 & ロールバック (`replaceBinarySafely`)**:
     * Windows における実行中 `.exe` ファイルロックを回避するため、既存バイナリを `.old` にリネーム退避し、新バイナリを配置。
     * コピー失敗時は即時に `.old` から元に戻すロールバック処理を実行。
     * 過去更新の残存 `.old` ファイルは起動時（`cleanOldBinaries`）および更新直前に自動クリーンアップ。
     * Unix / macOS ではアトミック置換（`fs.renameSync`）および実行権限（`chmod 0o755`）付与。
     * 管理者権限不足（`EACCES` / `EPERM`）時の分かりやすいエラーハンドリング。
  6. **キャッシュ更新 & サマリー表示 (`formatSelfUpdateSummary`)**: 更新成功時に `update-cache.json` を同期し、端末上に美しい完了枠を出力。
* **CLI オプション**:
  * `vsub update` / `vsub upgrade`
  * `--check`: 更新を適用せず新バージョンの有無のみ確認
  * `--force`: 最新版適用済みの場合でも強制再取得・上書き
  * `--verbose`: 詳細ログ出力
* **対応ファイル**: `src/updater.ts`, `src/updater.test.ts`, `src/index.ts`, `src/i18n/en.ts`, `src/i18n/ja.ts`, `src/ui.ts`, `README.md`, `README.ja.md`, `docs/backlog.md`

---
## 2. 次期イテレーション・未着手バックログ (Next Candidates)

コードベースの構造分析および AI エージェント連携（Agentic DX）の観点から抽出した、次期アップデート候補（25〜30）の設計・実装指針です。

### 2.1 チャンク境界の文脈引き継ぎ翻訳 (Sliding Window Context) & 構造保証 (#25) 【優先度: High】
* **背景/課題**:
  * 現在の `src/gemini.ts` は字幕配列を 50 行ずつのチャンク（`DEFAULT_CHUNK_SIZE = 50`）に単純分割し、`asyncPool`（デフォルト 3 並列）で並列翻訳している。
  * チャンクの切れ目（例: 50 行目と 51 行目）で 1 つの文が跨っている場合や、前後の会話の流れが次のチャンクに伝わらないため、口調（です・ます調 / タメ口）や主語・代名詞の訳し方がチャンク境界でブレることがある。
  * また、`responseMimeType: "application/json"` のみで要素数一致をプロンプト指示に頼っているため、長文チャンクで稀に行が結合され `incomplete count` によるリトライが発生しうる。
* **提案内容**:
  * **スライディングウィンドウ文脈参照 (`precedingContext`)**:
    * 各チャンク（Index $k$）を翻訳する際、直前チャンク（Index $k-1$）の末尾 3〜5 行の原文を「参照コンテキスト（翻訳出力の対象外・文脈および口調維持用）」としてプロンプトに付与する。
    * 原文配列のスライス時に抽出するだけのため、**既存の `asyncPool` による並列リクエスト速度を一切犠牲にせず**に文脈の一貫性を担保できる。
  * **Structured Outputs (`responseSchema`) の導入**:
    * `@google/genai` の `responseSchema` を指定し、出力 JSON の型・構造を厳格化して行数不一致エラーの発生率を低減する。
* **対応スコープ**: `src/gemini.ts`, `src/gemini.test.ts`

### 2.2 長文セグメントのスマート自動分割・リフロー (Smart Subtitle Reflow) (#26) 【優先度: High】
* **背景/課題**:
  * `src/groq.ts` は Groq Whisper API（`verbose_json`）が返す `segments` をそのまま 1 セグメント = 1 SRT エントリーとして変換している。
  * 早口の英語トークやポッドキャスト等では「1 セグメントが 8〜12 秒・100〜150 文字以上の長文」になるケースがあり、そのまま字幕表示や `--burn` 焼き込みを行うと画面が文字で埋まり視認性が低下する。
* **提案内容**:
  * **スマート字幕リフロー / セグメント分割機構**:
    * 1 セグメントあたりの文字数または表示秒数が閾値を超える場合、句読点（`。`, `、`, `.`, `,`, `?`, `!`）や自然な単語境界で複数の `SrtEntry` に自動分割する。
    * 分割時のタイムコード（`startTime`, `endTime`）は、文字数比率による比例配分、または Groq Whisper の単語タイムスタンプ（`timestamp_granularities: ["word", "segment"]`）を用いてミリ秒精度で算出する。
  * **CLI オプション制御**:
    * `--max-length <chars>`（1 ブロックあたりの目安最大文字数）や `--no-reflow`（分割無効化）等のオプションをサポートし、翻訳前の段階で適切な粒度に整える。
* **対応スコープ**: `src/srt.ts`, `src/srt.test.ts`, `src/groq.ts`, `src/groq.test.ts`, `src/pipeline.ts`, `src/index.ts`

### 2.3 標準出力モード (`--stdout`) & AI エージェント / パイプ連携強化 (#27) 【優先度: High】
* **背景/課題**:
  * 現在 `vsub` は必ずファイルへ書き出し、標準出力（`stdout`）にはスピナーやサマリーボックス等の UI 装飾を表示する。
  * Claude Code や Antigravity 等の AI エージェント、あるいはシェルスクリプトから「動画・音声の内容をテキストとして直接読み取りたい」「パイプ（`| jq`, `| pbcopy`）で別コマンドへ渡したい」という場合に、一時ファイルの生成・検索・削除の手間が発生する。
* **提案内容**:
  * **`--stdout` オプション（または `-o -`）の新設**:
    * 指定時はファイル保存を行わず、生成された字幕・テキストコンテンツ（`-f srt|vtt|txt|json` の単一フォーマット）を直接 `process.stdout` に出力する。
  * **ログと出力ストリームの分離**:
    * `--stdout` 指定時は、スピナー（`ora`）、サマリーボックス、アップデート通知等の UI 出力を自動的に抑制（サイレント化）または `process.stderr` へ逃がし、`stdout` が純粋なデータストリームとして機能することを保証する。
    * `vsub <media>` メインコマンドおよび `vsub translate <srt>` サブコマンドの双方で対応。
* **対応スコープ**: `src/index.ts`, `src/pipeline.ts`, `src/pipeline.test.ts`, `src/ui.ts`

### 2.4 AI チャプター生成 & 要約サブコマンド (`vsub chapters` / `vsub summarize`) (#28) 【優先度: Medium】
* **背景/課題**:
  * `vsub` には既に「FFmpeg 音声圧縮 → Groq 超高速文字起こし → 中間キャッシュ → Gemini API 連携」という強力なパイプラインがあるが、現在の出口は「1 対 1 の字幕翻訳」に限定されている。
  * 動画投稿者・ポッドキャスト配信者・視聴者（およびそれを補助する AI エージェント）にとって、字幕と並んで頻繁に必要となる「YouTube 概要欄用のチャプター（目次タイムスタンプ）」や「タイムコード付き要約・議事録」を、既存の文字起こしキャッシュを活かして 1〜2 秒で生成できるようにしたい。
* **提案内容**:
  * **`vsub chapters <media-or-srt>` サブコマンド**:
    * 文字起こし結果（キャッシュヒット時は FFmpeg / Groq を完全スキップ）を Gemini に渡し、話題の転換点を分析して `00:00 イントロダクション` 形式のチャプター一覧を生成する。
  * **`vsub summarize <media-or-srt>` サブコマンド**:
    * 動画・音声の全体要約、主要トピック、重要発言のタイムコード付きハイライトを Markdown（または TXT / JSON）形式で出力する。
  * **共通オプション対応**:
    * `-t, --target-lang <lang>`（出力言語）、`--prompt <instruction>`（要約・チャプター粒度の指示）、`-o, --output <path>`、および `--stdout` をサポート。
* **対応スコープ**: `src/gemini.ts`, `src/gemini.test.ts`, `src/pipeline.ts`, `src/index.ts`, `src/i18n/en.ts`, `src/i18n/ja.ts`

### 2.5 動画へのソフトサブ（字幕トラック）高速埋め込み (`--embed` / `vsub embed`) (#29) 【優先度: Medium】
* **背景/課題**:
  * 既存の `--burn` / `vsub burn`（ハードサブ）は映像を `libx264` で再エンコードして字幕を焼き込むため、長尺動画では処理時間がかかり、1 動画に 1 言語しか焼き込めず、プレイヤー側で字幕の ON/OFF 切り替えができない。
* **提案内容**:
  * **無劣化・高速ストリームコピーによるソフトサブ格納**:
    * FFmpeg の `-c:v copy -c:a copy` と字幕コーデック（MP4 なら `mov_text`、MKV なら `srt`）を使用し、映像・音声を一切再エンコードせずに字幕トラックをコンテナへ埋め込む（1 時間の動画でも 1 秒未満で完了）。
  * **複数言語トラックの同時格納**:
    * `vsub video.mp4 -t ja,en,zh --embed` のように複数言語を指定した場合、生成された全言語の字幕を 1 つの動画ファイル内にマルチトラック（`-metadata:s:s:0 language=jpn` 等の言語メタデータ付き）として一括格納する。
  * **単体サブコマンド `vsub embed <video-file> <subtitle-files...>`**:
    * 既存の動画と 1 つ以上の `.srt` ファイルを指定して即座にソフトサブ入り動画を出力するサブコマンドも併せて提供する。
* **対応スコープ**: `src/ffmpeg.ts`, `src/ffmpeg.test.ts`, `src/pipeline.ts`, `src/index.ts`, `src/i18n/en.ts`, `src/i18n/ja.ts`

### 2.6 字幕焼き込み (`--burn`) の位置・フォントサイズ調整オプション (#30) 【優先度: Low】
* **背景/課題**:
  * 現在の `--burn` / `vsub burn` は FFmpeg デフォルトの字幕スタイルで画面下部に焼き込まれるため、「元動画の下部に既にテロップがあって被る」「スマホ視聴向けに文字を大きくしたい」といった調整ができない。
  * 一方で、色コードや余白等を細かく指定させるオプション群はプレビューのない CLI では扱いづらいため、実需の高い「配置位置」と「文字サイズ」の 2 点に絞ってシンプルに提供する。
* **提案内容**:
  * `--burn-position <pos>`: `bottom`（デフォルト）、`top`（上部配置：下部テロップ回避用）、`center`（中央配置：ショート動画等）を指定可能にし、FFmpeg `subtitles` フィルタの `force_style='Alignment=...'` へマッピング。
  * `--burn-font-size <size>`: フォントサイズ（数値または `small` / `medium` / `large`）を指定可能にし、`force_style='FontSize=...'` へ安全にエスケープして適用。
  * `vsub <media> --burn` および `vsub burn <video> <srt>` の双方でサポート。
* **対応スコープ**: `src/ffmpeg.ts`, `src/ffmpeg.test.ts`, `src/pipeline.ts`, `src/index.ts`

---

## 3. ロードマップ進捗状況 (Roadmap Status)

* **Phase 1: 初期コア & DevOps / 配布ロードマップ (タスク 1〜24)**:
  * コア機能（音声抽出・分割・Groq 文字起こし・Gemini 並列翻訳・キャッシュ・用語集・バイリンガル・バッチ処理・ハードサブ焼き込み）、CI/CD 自動リリース、Node.js SEA スタンドアロンバイナリ配布、および `vsub update` 自己更新機構まで **全 24 項目完了**。
* **Phase 2: 品質深化 & Agentic DX 拡張ロードマップ (タスク 25〜30)**:
  * 翻訳・字幕品質のさらなる向上（#25 文脈引き継ぎ、#26 スマート分割）、AI エージェント・パイプ連携（#27 `--stdout`、#28 `chapters` / `summarize`）、およびメディア処理補完（#29 `--embed` ソフトサブ、#30 `--burn` 位置・サイズ指定）をバックログとして策定済み（未着手）。

