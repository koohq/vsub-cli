import pc from "picocolors";
import { getI18n, type SupportedLanguage } from "./i18n/index.js";
import {
  EMBEDDED_LICENSES,
  type EmbeddedLicense,
  THIRD_PARTY_LICENSES_TEXT,
} from "./licenses.data.js";

export interface PrintLicensesOptions {
  output?: { write: (text: string) => void } | undefined;
  full?: boolean | undefined;
  lang?: SupportedLanguage | string | undefined;
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

  const m = getI18n(options.lang).licenses;

  out("");
  out(pc.bold(pc.cyan("================================================================")));
  out(pc.bold(pc.cyan(m.bannerTitle)));
  out(pc.bold(pc.cyan("================================================================")));
  out("");
  out(m.intro1);
  out(m.intro2);
  out("");

  for (const item of EMBEDDED_LICENSES) {
    out(
      `${pc.bold(pc.green(item.name))} ${pc.dim(`v${item.version}`)}  [${pc.yellow(item.license)}]`,
    );
    if (item.repository) {
      out(`  ${pc.dim(m.repository)} ${pc.cyan(item.repository)}`);
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

  out(pc.dim(m.footerHint));
  out("");
}
