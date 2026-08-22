import pc from "picocolors";
import {
  EMBEDDED_LICENSES,
  type EmbeddedLicense,
  THIRD_PARTY_LICENSES_TEXT,
} from "./licenses.data.js";

export interface PrintLicensesOptions {
  output?: { write: (text: string) => void } | undefined;
  full?: boolean | undefined;
}

/**
 * Returns the embedded licenses list.
 */
export function getEmbeddedLicenses(): readonly EmbeddedLicense[] {
  return EMBEDDED_LICENSES;
}

/**
 * Returns the full formatted third-party licenses text.
 */
export function getThirdPartyLicensesText(): string {
  return THIRD_PARTY_LICENSES_TEXT;
}

/**
 * Prints third-party open source licenses and notices to the terminal.
 */
export function printLicenses(options: PrintLicensesOptions = {}): void {
  const out = options.output
    ? (text: string) => options.output?.write(`${text}\n`)
    : (text: string) => console.log(text);

  if (options.full) {
    out(THIRD_PARTY_LICENSES_TEXT);
    return;
  }

  out("");
  out(pc.bold(pc.cyan("================================================================")));
  out(
    pc.bold(pc.cyan("                  vsub-cli サードパーティライセンス一覧                  ")),
  );
  out(pc.bold(pc.cyan("================================================================")));
  out("");
  out("本ツール（単体実行バイナリおよび npm パッケージ）は以下の OSS ライブラリを含みます。");
  out("各ライブラリの権利表示およびライセンス条文は以下の通りです。");
  out("");

  for (const item of EMBEDDED_LICENSES) {
    out(
      `${pc.bold(pc.green(item.name))} ${pc.dim(`v${item.version}`)}  [${pc.yellow(item.license)}]`,
    );
    if (item.repository) {
      out(`  ${pc.dim("リポジトリ:")} ${pc.cyan(item.repository)}`);
    }
    out("");
    // Indent license text
    const indented = item.licenseText
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n");
    out(pc.dim(indented));
    out(`\n${pc.dim("----------------------------------------------------------------")}\n`);
  }

  out(
    pc.dim(
      "※ 全文テキストは `vsub licenses --full` または配布同梱の `THIRD_PARTY_LICENSES.txt` で確認できます。",
    ),
  );
  out("");
}
