# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [1.11.0](https://github.com/koohq/vsub-cli/compare/vsub-cli-v1.10.0...vsub-cli-v1.11.0) (2026-11-13)


### Features

* set reasoning effort for OpenRouter and Gemini text generation ([9b5b6df](https://github.com/koohq/vsub-cli/commit/9b5b6df92449301d5b4549fd2cc1f9f583454380))


### Bug Fixes

* keep ages and instructions out of auto scene notes ([1cfa3bf](https://github.com/koohq/vsub-cli/commit/1cfa3bf5281baf52d385c17542529d7cb4d6a2a0))

## [1.10.0](https://github.com/koohq/vsub-cli/compare/vsub-cli-v1.9.1...vsub-cli-v1.10.0) (2026-11-13)


### Features

* pass background notes about speakers and the setting with --context ([87909f7](https://github.com/koohq/vsub-cli/commit/87909f79e6d9e07f1b1acddb8cd581713caf5844))
* pass speaker labels from transcription to translation with --diarize ([0f65f1b](https://github.com/koohq/vsub-cli/commit/0f65f1b30502951a093c311b9cf5e4fad57a482c))
* write scene notes for translation with --auto-context ([c0772f3](https://github.com/koohq/vsub-cli/commit/c0772f3b5ef85d5f753f5c1668346a4cabdfb17e))


### Bug Fixes

* show the --no-translate step line in the display language ([735dfa3](https://github.com/koohq/vsub-cli/commit/735dfa3c7724448ed3bc6bd8cd94006ad9c9c5cb))

## [1.9.1](https://github.com/koohq/vsub-cli/compare/vsub-cli-v1.9.0...vsub-cli-v1.9.1) (2026-11-12)


### Bug Fixes

* localize FFmpeg errors for the Japanese display language ([66cd4e7](https://github.com/koohq/vsub-cli/commit/66cd4e735941bed598fbdbdc484af6247ab4281e))
* localize missing-key errors when creating text and transcription models ([f40e4a6](https://github.com/koohq/vsub-cli/commit/f40e4a6bcf78b7541299628f80977a99af373991))
* localize self-update errors for the Japanese display language ([2dd996d](https://github.com/koohq/vsub-cli/commit/2dd996dea0a3a8a6c243676648df75fb278e7f7c))
* remove extracted audio when transcription fails ([a9dfd3a](https://github.com/koohq/vsub-cli/commit/a9dfd3a971f4dfc02daa62b3807c8a8cc79a19ba))

## [1.9.0](https://github.com/koohq/vsub-cli/compare/vsub-cli-v1.8.1...vsub-cli-v1.9.0) (2026-11-12)


### Features

* add an openai-compatible provider for transcription and text generation ([abdd068](https://github.com/koohq/vsub-cli/commit/abdd06848899aabf8c5eebb018d6b175335b9804))
* let openai-compatible text generation send a reasoning effort ([7a2b924](https://github.com/koohq/vsub-cli/commit/7a2b9242442e3c660222046d25c752a6086f9b36))


### Bug Fixes

* report missing openai-compatible settings where missing keys are reported ([f11a423](https://github.com/koohq/vsub-cli/commit/f11a4237bdf602ff0ac65fc68c8e819a77f516be))

## [1.8.1](https://github.com/koohq/vsub-cli/compare/vsub-cli-v1.8.0...vsub-cli-v1.8.1) (2026-11-11)


### Bug Fixes

* localize the glossary file read error ([a8dda4e](https://github.com/koohq/vsub-cli/commit/a8dda4ed940cb7b7519c92b494f5ac90f33d2762))
* print update success lines with --verbose ([7fc4f4f](https://github.com/koohq/vsub-cli/commit/7fc4f4f9a5df20e58b5635ba4cb7c8961e1ba1c3))
* show --lang in vsub init help ([c26e837](https://github.com/koohq/vsub-cli/commit/c26e8371ac1438aced22544d22eaaa2ca4e11d6d))
* size config show labels by the rows actually printed ([319fb31](https://github.com/koohq/vsub-cli/commit/319fb3180207266636996d84a41a9ab857853b69))

## [1.8.0](https://github.com/koohq/vsub-cli/compare/vsub-cli-v1.7.2...vsub-cli-v1.8.0) (2026-11-11)


### Features

* add --glossary to chapters and summarize ([7b76d3d](https://github.com/koohq/vsub-cli/commit/7b76d3d6c51b786f81bafd60f76ceb5c28bfe0b9))
* let config and VSUB_REFINE turn --refine on by default ([ddd6210](https://github.com/koohq/vsub-cli/commit/ddd6210ee911d85fe679fd14aa53d49f377daf1a))

## [1.7.2](https://github.com/koohq/vsub-cli/compare/vsub-cli-v1.7.1...vsub-cli-v1.7.2) (2026-11-11)


### Bug Fixes

* ask batch for the transcription key only when a file needs transcribing ([e884f4f](https://github.com/koohq/vsub-cli/commit/e884f4f8bb34feffe85a88970f13a6cc4be88b6b))
* keep notices and failure lines visible with --verbose ([364fd56](https://github.com/koohq/vsub-cli/commit/364fd56b29300bdf86006662ad8bde4ba336ae3a))
* keep the resume and refine fallback notices visible with --verbose ([1abf412](https://github.com/koohq/vsub-cli/commit/1abf4120712d24bc5d7270ec0eab8a26037ef539))
* localize the missing API key error ([f65402b](https://github.com/koohq/vsub-cli/commit/f65402b2d5c71517429f87aa15b127d08408a967))
* show concurrency in config show and accept -l after config subcommands ([a5e9410](https://github.com/koohq/vsub-cli/commit/a5e94102974ba4011e8dfb1378da43555abf60fe))
* show the saving line when summarize uses its cache ([a6821f7](https://github.com/koohq/vsub-cli/commit/a6821f7309ed3ab9262f494b3e557572caf5a2d3))
* stop vsub init with a hint when stdin is not a terminal ([117123b](https://github.com/koohq/vsub-cli/commit/117123bac38be06da8df03294ac794a01d9115d3))
* write --verbose logs to stderr so --stdout output stays clean ([197b914](https://github.com/koohq/vsub-cli/commit/197b914a8bc889dceb8d8201098a91fab7e04c13))

## [1.7.1](https://github.com/koohq/vsub-cli/compare/vsub-cli-v1.7.0...vsub-cli-v1.7.1) (2026-11-11)


### Bug Fixes

* key the media cache by file size and sampled content ([4512bdb](https://github.com/koohq/vsub-cli/commit/4512bdba1b32440a4f6d1abf0d8145b54cfcf377))
* match translated and refined lines by id instead of position ([5dc3f76](https://github.com/koohq/vsub-cli/commit/5dc3f7660829356d8f0e5e5786a8a96619b424b2))
* resume interrupted translations and stop sending chunks after a failure ([5af300f](https://github.com/koohq/vsub-cli/commit/5af300fdf4565bfe10b1efaa96d4d449b23cb552))
* split long audio at silences before the chunk limit ([ffc23a4](https://github.com/koohq/vsub-cli/commit/ffc23a492a9b22fdadf5e6bd6c85ff26d4fa5e04))
* use only the first target language for chapters and summaries ([c0a2434](https://github.com/koohq/vsub-cli/commit/c0a2434b8dc67a1f58dd907404baeedda241005e))

## [1.7.0](https://github.com/koohq/vsub-cli/compare/vsub-cli-v1.6.1...vsub-cli-v1.7.0) (2026-11-11)


### Features

* add a default target language to config set and config show ([f443f4e](https://github.com/koohq/vsub-cli/commit/f443f4ee7076263d062ddb972b90dedcabcba971))


### Bug Fixes

* correct progress markers and terminal display alignment ([be24cd1](https://github.com/koohq/vsub-cli/commit/be24cd1e4159dae45c5071fa6846e16175df975f))
* localize config, cache and setup output and stop reading parent .env ([2dbcda8](https://github.com/koohq/vsub-cli/commit/2dbcda8a1dbaadc28e06d990c768f8db66d3535a))
* merge short chapters so YouTube accepts chapter lists ([dbf8b57](https://github.com/koohq/vsub-cli/commit/dbf8b57b40f9162dd6631512892b44f2ddb5829b))

## [1.6.1](https://github.com/koohq/vsub-cli/compare/vsub-cli-v1.6.0...vsub-cli-v1.6.1) (2026-11-11)


### Bug Fixes

* keep PowerShell 7 module paths out of the Expand-Archive fallback ([bdeddfa](https://github.com/koohq/vsub-cli/commit/bdeddfa17b2e216cee6dbbbd91d0fc4820f7ab48))
* reject transcripts without subtitle timestamps ([1c58e40](https://github.com/koohq/vsub-cli/commit/1c58e40d2036853fd5ce8237c5fa94cc930749d3))

## [1.6.0](https://github.com/koohq/vsub-cli/compare/vsub-cli-v1.5.1...vsub-cli-v1.6.0) (2026-11-11)


### Features

* add --refine to correct transcript recognition errors with the text model ([4938c83](https://github.com/koohq/vsub-cli/commit/4938c833e51ab85e94465c9a98933414b7cbeba4))
* choose the text generation provider in init and config ([544838f](https://github.com/koohq/vsub-cli/commit/544838f93947a2f521eeb744f4c5024c02052f90))
* choose the transcription provider in init and config ([012bba2](https://github.com/koohq/vsub-cli/commit/012bba2a518cc58061b223a1c14e442cb6eaac0e))
* let translation, chapters and summaries run on OpenRouter ([c758348](https://github.com/koohq/vsub-cli/commit/c758348e6f5a0eb1cd71e87539bbfeecdb4fc558))
* let users choose the transcription provider (OpenRouter or Groq) ([c3b3cff](https://github.com/koohq/vsub-cli/commit/c3b3cff1f557952edab93d15688afffa37dda1b6))


### Performance Improvements

* use low thinking level for Gemini translation, chapters and summary ([e43a027](https://github.com/koohq/vsub-cli/commit/e43a0275988de063c95197ed7aab0620a9dd77db))

## [1.5.1](https://github.com/koohq/vsub-cli/compare/vsub-cli-v1.5.0...vsub-cli-v1.5.1) (2026-11-09)


### Bug Fixes

* accept --cache-dir on the translate subcommand ([d6697dd](https://github.com/koohq/vsub-cli/commit/d6697dd8b204e055cadbd99383950bf6d4610eb9))
* always pre-check the Groq API key in batch with --no-translate ([f1e164c](https://github.com/koohq/vsub-cli/commit/f1e164c69a8bb001e89e9ead3f42721c49879a24))
* bind the translation cache to its source subtitles and settings ([26c565a](https://github.com/koohq/vsub-cli/commit/26c565acdc1593656fb368c78fb0915a695b7b27))
* bind transcription, chapters and summary caches to their inputs ([85e1911](https://github.com/koohq/vsub-cli/commit/85e19110054205770f6b84696cb23603ad19fbcd))
* burn top and center subtitles at the requested position ([e6d95c2](https://github.com/koohq/vsub-cli/commit/e6d95c27c710f8aac5970f0bdbf6044cdd8a68cb))
* escape subtitle paths for the ffmpeg filtergraph so quotes work ([1daeff0](https://github.com/koohq/vsub-cli/commit/1daeff0f944ffadac366101bcc437c8cf5bc101b))
* harden self-update verification, replacement and binary detection ([020f2db](https://github.com/koohq/vsub-cli/commit/020f2dbe568464fc242f8014c13676e8e2269ea9))
* keep subtitle and video outputs apart when -o names a video ([ccd5653](https://github.com/koohq/vsub-cli/commit/ccd5653a90cbc6618f1fff8e4badda4dbe2fb824))
* keep tests out of the npm package and refresh bundled license data at build ([1cdb64c](https://github.com/koohq/vsub-cli/commit/1cdb64c10dcd1ec69378a9cd79f62b2b8d8666f8))
* keep the init wizard in the --lang language through the preferences step ([36e4ab9](https://github.com/koohq/vsub-cli/commit/36e4ab95be1101784694f490d1c39dd9a4283713))
* make --no-translate, --no-cache, --no-reflow and --no-update-check take effect ([926ae5a](https://github.com/koohq/vsub-cli/commit/926ae5a659e71f5e219ccf30ee6b9792bda0017e))
* make the self-update fallback and old-binary cleanup safe for renamed binaries ([4750d2f](https://github.com/koohq/vsub-cli/commit/4750d2fab3af6bc969bb68b09846ac036b321a08))
* pass --lang to the init setup wizard ([72a9718](https://github.com/koohq/vsub-cli/commit/72a97186d912141ad734013f2bb508438b672e4f))
* reject unsupported --embed containers before calling any API ([aa9c8e7](https://github.com/koohq/vsub-cli/commit/aa9c8e79b6ba9b893e72598f14f32fcb00ca75d5))
* respect declined overwrite prompt for --save-original ([48b56d9](https://github.com/koohq/vsub-cli/commit/48b56d9b6f0ab2128b7c7e52d5185e351fedd906))
* silence the Expand-Archive progress bar so the update fallback is fast ([eed3fca](https://github.com/koohq/vsub-cli/commit/eed3fca36cb5d30bff1d408395d7641fa88a7a1f))
* stop printing the dotenv log line on every command ([bb3ae8e](https://github.com/koohq/vsub-cli/commit/bb3ae8e378239fa32d94b98237a9692df2c8be2a))
* stop root options from overriding subcommand options ([502452f](https://github.com/koohq/vsub-cli/commit/502452f3b1a5efcd662082c0b5c12094cc91ed1f))
* use the configured default target language when -t is omitted ([84f274d](https://github.com/koohq/vsub-cli/commit/84f274d10c394f098e10727710ed4d657b05be6e))
* write the global config with private permissions and never clobber a broken one ([8df9ce1](https://github.com/koohq/vsub-cli/commit/8df9ce18222944d19f2b0759bfc001066810c3a8))

## [1.5.0](https://github.com/koohq/vsub-cli/compare/vsub-cli-v1.4.0...vsub-cli-v1.5.0) (2026-10-30)


### Features

* add chapters and summarize subcommands ([957fba3](https://github.com/koohq/vsub-cli/commit/957fba35dc4456ad63dfdf189b9e1891ab8571d2))
* add soft subtitle embedding (--embed and vsub embed subcommand) ([32d41df](https://github.com/koohq/vsub-cli/commit/32d41dfbacd524cf2c1f069dbd5897e9a7ee8c71))
* add subtitle burn styling options (--burn-position and --burn-font-size) ([7165cd6](https://github.com/koohq/vsub-cli/commit/7165cd6a159eae51c047f2f4a2a2478d83df18ae))
* **cli:** support standard output mode (--stdout) for streaming and piping ([865e4be](https://github.com/koohq/vsub-cli/commit/865e4becaf25b380395d6f33a876563ef8eb4c39))
* **gemini:** implement sliding window context and structured outputs for chunk translation ([598ce65](https://github.com/koohq/vsub-cli/commit/598ce651426a0328bd2c88295f8f24f0ca5e7919))
* **srt:** implement smart subtitle reflow and segment splitting ([ff7abc2](https://github.com/koohq/vsub-cli/commit/ff7abc2585879045eea4fe0922dc8a8f08b54c2e))


### Bug Fixes

* **i18n:** localize license summary and option validation errors to English default ([9400d60](https://github.com/koohq/vsub-cli/commit/9400d6094496b2ffdc292e4f7ed1f9b1d3fef9a5))

## [1.4.0](https://github.com/koohq/vsub-cli/compare/vsub-cli-v1.3.0...vsub-cli-v1.4.0) (2026-10-15)


### Features

* add self-update subcommand (vsub update) ([84a1f96](https://github.com/koohq/vsub-cli/commit/84a1f96e180f3996047b16ce746c8f3895511746))
* add version update check and notification mechanism ([1ed9b2d](https://github.com/koohq/vsub-cli/commit/1ed9b2dde3b8181163dc60d91eb4e92e054847b6))


### Bug Fixes

* **updater:** support cross-platform path separators in isStandaloneBinary ([2c1b71e](https://github.com/koohq/vsub-cli/commit/2c1b71ece5664eef60133343f28bd1706d7e81c8))

## [1.3.0](https://github.com/koohq/vsub-cli/compare/vsub-cli-v1.2.0...vsub-cli-v1.3.0) (2026-09-05)


### Features

* add i18n support with english default and japanese option ([1f72470](https://github.com/koohq/vsub-cli/commit/1f72470e561e06ca92ef1c298e9f10fc38f8dd9c))
* add model not found fail-fast error handling and display active models in cli ([dec7453](https://github.com/koohq/vsub-cli/commit/dec74533377ab4e66ec120cdbf50f0d86a181785))

## [1.2.0](https://github.com/koohq/vsub-cli/compare/vsub-cli-v1.1.2...vsub-cli-v1.2.0) (2026-09-03)


### Features

* update default Gemini model to gemini-3.8-flash ([74033cc](https://github.com/koohq/vsub-cli/commit/74033ccc11c807fdd304d3dd5de01f27311e59d7))

## [1.1.2](https://github.com/koohq/vsub-cli/compare/vsub-cli-v1.1.1...vsub-cli-v1.1.2) (2026-08-22)


### Bug Fixes

* **build:** apply macOS ad-hoc code signature to final destination binary after copy and add CI binary verification matrix ([0a73315](https://github.com/koohq/vsub-cli/commit/0a7331586c14721cf2012d1e787cac0b29745699))
* **ci:** restore setup-env step in Typecheck & Build job ([50c0cf3](https://github.com/koohq/vsub-cli/commit/50c0cf3193ae2c5dc1b35aa582a86a45b0f13f33))
* **ci:** scope macOS binary builds to Apple Silicon arm64 ([5258656](https://github.com/koohq/vsub-cli/commit/5258656be0c117771922e44ca70def26ecd6818e))

## [1.1.1](https://github.com/koohq/vsub-cli/compare/vsub-cli-v1.1.0...vsub-cli-v1.1.1) (2026-08-22)


### Bug Fixes

* **ci:** use verified commit SHAs for upload and download artifact actions ([5f689a1](https://github.com/koohq/vsub-cli/commit/5f689a154a168a75f1ae7de163b61143b9956d65))

## [1.1.0](https://github.com/koohq/vsub-cli/compare/vsub-cli-v1.0.0...vsub-cli-v1.1.0) (2026-08-22)


### Features

* add custom Gemini and Groq model options ([fe48f1f](https://github.com/koohq/vsub-cli/commit/fe48f1f947b4d6bc73eaad921e7fbe70b54651ae))
* add directory and batch bulk processing mode (vsub batch) ([174d6f3](https://github.com/koohq/vsub-cli/commit/174d6f394bf38032faf4b99f2c0677d99bbac3f5))
* add file overwrite prevention and backup safety mechanisms ([8ba5d7f](https://github.com/koohq/vsub-cli/commit/8ba5d7f456cb53eb9a97d2332da2981b8c5d1197))
* add Gemini API concurrency control for fast subtitle translation ([25d33b8](https://github.com/koohq/vsub-cli/commit/25d33b8d38eca960c48f2ec8028f46454f6a5b15))
* add GitHub Actions CI matrix and Dependabot auto-merge pipeline ([ce7e7d2](https://github.com/koohq/vsub-cli/commit/ce7e7d20463b042296f2fa19d2a03ee818b46d6c))
* add glossary and custom prompt specification support ([8c3867c](https://github.com/koohq/vsub-cli/commit/8c3867cbd93def7168241ace2c830e22fe494a4d))
* add interactive CLI configuration, translation control options, and Gemini/Groq integration modules ([68b0a80](https://github.com/koohq/vsub-cli/commit/68b0a80af724b52e0cfbde650a458052032f973a))
* add interactive setup and verification wizard (vsub init) ([3c943c0](https://github.com/koohq/vsub-cli/commit/3c943c05435bc32bb8e01e3f998c3bac56ce88e2))
* add local automated E2E smoke test and update Gemini default model ([25b88c4](https://github.com/koohq/vsub-cli/commit/25b88c4fdf5d5d57d1fc0bcb183ef9d4cb140fee))
* add multi-format output support (.vtt, .txt, .json) ([d578a7f](https://github.com/koohq/vsub-cli/commit/d578a7f6783b24354702b76064922b75c41a1d4b))
* add real-time progress spinners and execution summary box ([8272260](https://github.com/koohq/vsub-cli/commit/827226080f95db36dc9bd33e276039ee04d17e1e))
* add standalone binary distribution (Node.js SEA) and third-party license management ([32dc686](https://github.com/koohq/vsub-cli/commit/32dc686503b417ccb18256b1584296580cba4211))
* add test coverage measurement and reporting with vitest --coverage ([f3ca049](https://github.com/koohq/vsub-cli/commit/f3ca0494f34c01212f70d8d506ba3cb3b08f6c8d))
* add video subtitle burn-in support via FFmpeg subtitles filter ([48317a8](https://github.com/koohq/vsub-cli/commit/48317a81e056b3a9f4b3d2035004a28b0f9084bb))
* add vsub translate subcommand for direct subtitle translation ([4c2a1a5](https://github.com/koohq/vsub-cli/commit/4c2a1a595bbf66b8b905994a89f2e6bd7ff2b641))
* **ci:** add automated AI model watcher with deduplicated issue alerts ([ac67302](https://github.com/koohq/vsub-cli/commit/ac6730241fe4385f006b8655681288aebe1b120b))
* **ci:** enable workflow_dispatch trigger for manual execution ([d90e651](https://github.com/koohq/vsub-cli/commit/d90e6510981524feb4ef64fa2e6cd535e9edc2f5))
* implement automated quality gate hook for pre-termination verification ([1204f18](https://github.com/koohq/vsub-cli/commit/1204f185b440f0dd53b0a7dce8369fcac0fc8a74))
* implement CLI entry point and subtitle generation workflow using Commander, Groq, and Gemini ([1c7b09e](https://github.com/koohq/vsub-cli/commit/1c7b09ed9d1479944baa85805c62ca78915d528e))
* implement global configuration management and interactive API key setup ([50e0572](https://github.com/koohq/vsub-cli/commit/50e0572dbf2184e40c42af239d4d5c1f5ac30637))
* implement intermediate caching and resume mechanism for Groq and Gemini ([82f4778](https://github.com/koohq/vsub-cli/commit/82f47789afbc4c23d3725c222aa2836a698596dd))
* implement video-to-srt CLI with Groq transcription and Gemini translation support ([c7772a8](https://github.com/koohq/vsub-cli/commit/c7772a857c85f12055055debeb82ea4891453fdf))
* initialize project with README, PRD, and ignore configuration ([8a35349](https://github.com/koohq/vsub-cli/commit/8a353494c265e2b0baac19be345fb02141601ff1))
* initialize vsub-cli project with Groq transcription and Gemini translation capabilities ([98c9eed](https://github.com/koohq/vsub-cli/commit/98c9eed8ea40fc9b601b7ce9b00a6ad3b5c107e0))
* **release:** setup Release Please and npm publish pipeline ([5f62261](https://github.com/koohq/vsub-cli/commit/5f622611697e98d14cd17e8d469773a654461a18))
* setup token-saving final quality gate with stop hook and testing rules ([034eba6](https://github.com/koohq/vsub-cli/commit/034eba657bb7084f5a91bc594790aeac353697c1))
* **subtitles:** add bilingual dual-language subtitles mode (--bilingual, -b) ([99a971b](https://github.com/koohq/vsub-cli/commit/99a971b6290f3700bbbc4a15c13fb51444d04387))
* support direct audio file inputs (.mp3, .wav, etc.) ([571e303](https://github.com/koohq/vsub-cli/commit/571e3031a488e669974fdd1c62bebdfd0e4e2bac))
* support multi-language simultaneous subtitle translation (-t ja,en,zh) ([53ee2f5](https://github.com/koohq/vsub-cli/commit/53ee2f5014c3182342d7a02992b6af05776d837f))
* **transcription:** improve timecode accuracy for split audio using measured playback duration ([586cdfd](https://github.com/koohq/vsub-cli/commit/586cdfd09c2cc7a021a871e47aba514af3277a59))


### Bug Fixes

* **ci:** install ffmpeg in setup-env composite action for test jobs ([1bf84f6](https://github.com/koohq/vsub-cli/commit/1bf84f643afa36f7bcdc642c4e81266ade50bf93))
* **ci:** pin googleapis/release-please-action to full-length commit SHA ([afbae2f](https://github.com/koohq/vsub-cli/commit/afbae2f424bfff26f36ae57e53627f42b224bc81))
* **ci:** specify packageManager in package.json for pnpm action setup ([6b56482](https://github.com/koohq/vsub-cli/commit/6b56482c98148dda9cf85b6251fd5637b10db89d))
* **ci:** sync known AI models strictly with current live API endpoints ([4b24edd](https://github.com/koohq/vsub-cli/commit/4b24eddc37611d4ea99fa9a3d48fa3b87032e4ff))
* **ci:** update macOS Intel runner to macos-15-intel and upgrade artifact actions to v7.0.0 ([dd69160](https://github.com/koohq/vsub-cli/commit/dd69160e4bffc466d4a6cc677c571276e429bce2))
* **ci:** use googleapis/release-please-action@v4 and align package metadata ([ded5386](https://github.com/koohq/vsub-cli/commit/ded5386bef20f097e7c4783362288ec49454b2bb))
* **init:** resolve biome noNonNullAssertion warning in init wizard ([9439715](https://github.com/koohq/vsub-cli/commit/9439715b655b2f25ede7a2af9804e681b3edd681))
* make resolveFfprobePath platform-agnostic across POSIX and Windows paths ([490ac93](https://github.com/koohq/vsub-cli/commit/490ac93627271863048dd49d07eaa70cb5cc56ab))

## 1.0.0 (Initial Release)

🎉 **First official release of vsub-cli!**

A fast and powerful CLI tool to extract audio, transcribe speech with Groq Whisper, and translate subtitles using Google Gemini API.

### Key Features

* **Audio Extraction & Optimization**: Extract and normalize audio streams from video (`.mp4`, `.mkv`, `.webm`, `.mov`, etc.) and audio files (`.mp3`, `.wav`, `.m4a`, `.flac`, etc.) using FFmpeg.
* **Fast Speech-to-Text**: High-speed transcription powered by Groq Whisper API, supporting automatic audio splitting with millisecond-accurate timestamp sync for long media.
* **AI-Powered Subtitle Translation**: High-accuracy contextual subtitle translation using Google Gemini API (`gemini-3.7-flash` default) with multi-worker concurrent chunk processing.
* **Multi-Language Batch Translation**: Translate subtitles into multiple target languages simultaneously with a single command (e.g. `-t ja,en,zh`).
* **Multi-Format Output**: Output subtitles in `.srt`, `.vtt` (WebVTT), `.txt` (plain transcript), and `.json` (structured entries).
* **Glossary & Custom Prompts**: Enforce consistent terminology and style through inline glossaries, JSON glossary files, Whisper hints, and custom Gemini translation prompts.
* **Direct SRT Translation**: Dedicated `vsub translate` subcommand to translate existing SRT files directly without re-processing media.
* **Video Hardsub / Burn-in**: Dedicated `vsub burn` subcommand and `--burn` flag to render subtitles directly into MP4 videos via FFmpeg.
* **Intelligent Caching**: Automatic caching and resume capability (`vsub cache`) to eliminate redundant Whisper and Gemini API calls.
* **Safety & Overwrite Protection**: Pre-execution collision check, interactive confirmation, and automatic `.bak` backups (`--backup`, `-w`).
* **Persistent Configuration**: Global CLI settings (`vsub config set/show/get/delete`) for API keys, models, and default concurrency.
* **Rich CLI UX**: Real-time spinner indicators, detailed error handling, and end-of-run execution summary tables.
