import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { getBytes, ref, uploadBytes } from "firebase/storage";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";

/** Storage rules (D-032), run against the Storage emulator. */
let env: RulesTestEnvironment;
const storage = (uid?: string) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).storage();
const bytes = new TextEncoder().encode("model bytes");

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-track-expense",
    storage: { rules: readFileSync(resolve(__dirname, "../../../storage.rules"), "utf8") },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), "models/gemma3-1b-it-int4.json"), bytes);
    await uploadBytes(ref(ctx.storage(), "other/secret.txt"), bytes);
  });
});
afterAll(async () => {
  await env?.cleanup();
});

describe("storage rules", () => {
  it("signed-in users may read models/, signed-out users may not", async () => {
    await assertSucceeds(getBytes(ref(storage("alice"), "models/gemma3-1b-it-int4.json")));
    await assertFails(getBytes(ref(storage(), "models/gemma3-1b-it-int4.json")));
  });

  it("no client writes anywhere, and nothing outside models/ is readable", async () => {
    await assertFails(uploadBytes(ref(storage("alice"), "models/gemma3-1b-it-int4.litertlm"), bytes));
    await assertFails(uploadBytes(ref(storage("alice"), "models/gemma3-1b-it-int4.json"), bytes));
    await assertFails(uploadBytes(ref(storage("alice"), "users/alice/x.txt"), bytes));
    await assertFails(uploadBytes(ref(storage(), "models/x"), bytes));
    await assertFails(getBytes(ref(storage("alice"), "other/secret.txt")));
  });
});
