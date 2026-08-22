import { describe, expect, it } from "vitest";
import { getEmbeddedLicenses, getThirdPartyLicensesText, printLicenses } from "./licenses.js";

describe("licenses", () => {
  it("should return valid embedded licenses", () => {
    const licenses = getEmbeddedLicenses();
    expect(licenses.length).toBeGreaterThan(0);

    const pkgNames = licenses.map((l) => l.name);
    expect(pkgNames).toContain("commander");
    expect(pkgNames).toContain("dotenv");
    expect(pkgNames).toContain("execa");
    expect(pkgNames).toContain("groq-sdk");
    expect(pkgNames).toContain("@google/genai");

    for (const lic of licenses) {
      expect(lic.name).toBeTypeOf("string");
      expect(lic.version).toBeTypeOf("string");
      expect(lic.license).toBeTypeOf("string");
      expect(lic.licenseText).toBeTypeOf("string");
      expect(lic.licenseText.length).toBeGreaterThan(0);
    }
  });

  it("should return valid full third party licenses text", () => {
    const text = getThirdPartyLicensesText();
    expect(text).toContain("THIRD-PARTY SOFTWARE NOTICES");
    expect(text).toContain("commander@");
    expect(text).toContain("Apache License");
  });

  it("should print licenses summary with custom output stream", () => {
    const chunks: string[] = [];
    const customOutput = {
      write: (text: string) => {
        chunks.push(text);
      },
    };

    printLicenses({ output: customOutput });
    const output = chunks.join("");
    expect(output).toContain("vsub-cli サードパーティライセンス一覧");
    expect(output).toContain("commander");
    expect(output).toContain("MIT");
  });

  it("should print full license text when full option is true", () => {
    const chunks: string[] = [];
    const customOutput = {
      write: (text: string) => {
        chunks.push(text);
      },
    };

    printLicenses({ output: customOutput, full: true });
    const output = chunks.join("");
    expect(output).toContain("THIRD-PARTY SOFTWARE NOTICES");
  });
});
