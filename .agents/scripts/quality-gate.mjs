import { exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// .agents/scripts/ -> project root is two levels up
const projectRoot = path.resolve(__dirname, "../..");

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
      name: "Biome Format (Auto-fix)",
      cmd: "pnpm run format",
    },
    {
      name: "TypeScript Compilation (Type Check)",
      cmd: "pnpm run build",
    },
    {
      name: "Biome Check (Lint & Verify)",
      cmd: "pnpm run check",
    },
    {
      name: "Vitest (All Unit Tests)",
      cmd: "pnpm run test",
    },
  ];

  const failures = [];

  for (const step of steps) {
    const result = await runStep(step.cmd);
    if (!result.success) {
      failures.push(`[${step.name} 失敗]\n${result.output}`);
      // If earlier step like build or check fails, we can either break or continue collecting
      // Breaking early saves time
      break;
    }
  }

  if (failures.length > 0) {
    const reason = `【品質ゲートエラー】作業完了前の自動検証に失敗しました。以下のエラーを修正して再度完了してください:\n\n${failures.join(
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
