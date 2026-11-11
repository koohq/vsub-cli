/**
 * Vitest setup file: make terminal colors the same on every machine.
 *
 * picocolors decides once, at import time, whether to emit ANSI colors. CI enables them (the `CI`
 * variable), while a developer shell may disable them with `NO_COLOR`. Tests that pass only without
 * colors then fail in CI. Forcing colors on here makes local runs match CI, so assertions on
 * printed output must strip the escape codes (for example with `stripVTControlCharacters`).
 */
delete process.env["NO_COLOR"];
process.env["FORCE_COLOR"] = "1";
