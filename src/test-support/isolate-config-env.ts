import fs from "node:fs";
import path from "node:path";

/**
 * Config-related environment variables read by src that tests must not inherit from a
 * developer's shell or .env file. The few variables deliberately left out (with reasons) are
 * listed in isolate-config-env.test.ts, whose coverage test fails when a variable is missing
 * from both places.
 */
export const ENV_VARS_TO_CLEAR = [
  "GROQ_API_KEY",
  "GEMINI_API_KEY",
  "VSUB_OPENROUTER_API_KEY",
  "OPENROUTER_API_KEY",
  "VSUB_STT_PROVIDER",
  "VSUB_OPENROUTER_STT_MODEL",
  "VSUB_LLM_PROVIDER",
  "VSUB_OPENROUTER_LLM_MODEL",
  "VSUB_FFMPEG_PATH",
  "FFMPEG_PATH",
  "VSUB_WHISPER_PROMPT",
  "WHISPER_PROMPT",
  "VSUB_PROMPT",
  "VSUB_GEMINI_PROMPT",
  "GEMINI_PROMPT",
  "VSUB_GLOSSARY",
  "GLOSSARY",
  "VSUB_CONCURRENCY",
  "VSUB_REFINE",
  "VSUB_GEMINI_MODEL",
  "GEMINI_MODEL",
  "VSUB_GROQ_MODEL",
  "GROQ_MODEL",
  "VSUB_TARGET_LANG",
  "TARGET_LANG",
  "VSUB_LANG",
  "VSUB_NO_UPDATE_CHECK",
  "VSUB_DISABLE_UPDATE_CHECK",
  "VSUB_MAX_LENGTH",
  "VSUB_BURN_POSITION",
  "VSUB_BURN_FONT_SIZE",
];

/**
 * Points the global config and cache directories into baseTempDir and clears config-related
 * environment variables. Mutates the current process.env, so callers must replace
 * process.env with a copy beforehand and restore it afterwards.
 */
export function isolateConfigAndEnv(
  baseTempDir: string,
  suffix = "config-home",
): { configHome: string } {
  const configHome = path.join(baseTempDir, suffix);
  fs.mkdirSync(configHome, { recursive: true });
  process.env["APPDATA"] = configHome;
  process.env["XDG_CONFIG_HOME"] = configHome;
  process.env["VSUB_CACHE_DIR"] = path.join(configHome, "cache");
  for (const envVar of ENV_VARS_TO_CLEAR) {
    delete process.env[envVar];
  }
  return { configHome };
}
