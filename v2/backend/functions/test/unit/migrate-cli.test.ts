import { afterEach, describe, expect, it } from "vitest";
import { accessTokenCredential, parseArgs } from "../../src/scripts/migrate-v1-to-v2";

describe("migration CLI", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("defaults to a dry run with key files", () => {
    delete process.env.MIGRATE_ACCESS_TOKEN;
    const a = parseArgs(["--source-key", "v1.json", "--target-key", "v2.json"]);
    expect(a.execute).toBe(false);
    expect(a.sourceKey).toBe("v1.json");
  });

  it("token mode needs both projects and a token", () => {
    delete process.env.MIGRATE_ACCESS_TOKEN;
    expect(() => parseArgs(["--source-project", "a", "--target-project", "b"])).toThrow(/MIGRATE_ACCESS_TOKEN/);
    process.env.MIGRATE_ACCESS_TOKEN = "t";
    expect(() => parseArgs(["--source-project", "a"])).toThrow(/both/);
    const a = parseArgs(["--source-project", "a", "--target-project", "b", "--execute"]);
    expect(a).toMatchObject({ sourceProject: "a", targetProject: "b", execute: true });
  });

  it("refuses to start with no credentials at all", () => {
    delete process.env.MIGRATE_ACCESS_TOKEN;
    delete process.env.SOURCE_SERVICE_ACCOUNT;
    delete process.env.TARGET_SERVICE_ACCOUNT;
    expect(() => parseArgs([])).toThrow();
  });

  it("the token credential hands back the token without touching disk", async () => {
    const t = await accessTokenCredential("abc").getAccessToken();
    expect(t.access_token).toBe("abc");
    expect(t.expires_in).toBeGreaterThan(0);
  });
});
