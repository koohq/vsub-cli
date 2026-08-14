import { exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

/**
 * Runs a command and returns { success, output }
 */
function runStep(commandStr) {
  return new Promise((resolve) => {
    exec(
      commandStr,
      {
        cwd: projectRoot,
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        resolve({
          success: !error,
          output: `${stdout}\n${stderr}`.trim(),
        });
      },
    );
  });
}

async function main() {
  const steps = [
    {
      name: "Biome Check (Lint & Format)",
      cmd: "pnpm run check",
    },
    {
      name: "TypeScript Compilation (Type Check)",
      cmd: "pnpm run build",
    },
    {
      name: "Vitest (Unit Tests)",
      cmd: "pnpm run test",
    },
  ];

  const failures = [];

  for (const step of steps) {
    const result = await runStep(step.cmd);
    if (!result.success) {
      failures.push(`[${step.name} 失敗]\n${result.output}`);
    }
  }

  if (failures.length > 0) {
    const reason = `【品質ゲートエラー】エージェント終了前の検証に失敗しました。以下のエラーを修正して完了してください:\n\n${failures.join(
      "\n\n----------------------------------------\n\n",
    )}`;

    console.log(
      JSON.stringify({
        decision: "continue",
        reason,
      }),
    );
  } else {
    console.log(
      JSON.stringify({
        decision: "allow",
      }),
    );
  }
}

main().catch((err) => {
  console.log(
    JSON.stringify({
      decision: "continue",
      reason: `品質ゲート実行中に予期しないエラーが発生しました: ${err.message}`,
    }),
  );
});
