/**
 * Timeout for tests that spawn real external processes (tar, PowerShell, ffmpeg).
 * These normally finish in a few seconds, but PowerShell in particular slows down by
 * 50-100x when the machine is under heavy CPU load (measured up to ~170 s per test).
 */
export const REAL_PROCESS_TEST_TIMEOUT_MS = 180_000;
