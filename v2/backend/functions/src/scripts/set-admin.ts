/**
 * Grants or revokes the `admin` custom claim (D-024), which unlocks
 * Profile › Admin › Billing & usage and the getAdminDashboard callable.
 *
 *   ADMIN_ACCESS_TOKEN=<token> npm run set-admin -- --project expense-tracker-v2-5c9fa --email you@example.com            # preview
 *   ADMIN_ACCESS_TOKEN=<token> npm run set-admin -- --project expense-tracker-v2-5c9fa --email you@example.com --execute
 *   ... --revoke [--execute]
 *
 * The token is a short-lived OAuth access token for an account that can
 * manage Firebase Auth users (the owner); see docs/wiki/operations.md for
 * getting one from the signed-in Firebase CLI. It is never printed and no key
 * file is needed. Other custom claims on the account are kept.
 * The user sees the change after their ID token refreshes (sign out and in,
 * or wait up to an hour).
 */

export interface SetAdminArgs {
  project: string;
  email: string;
  revoke: boolean;
  execute: boolean;
}

const V1_PROJECTS = new Set(["expense-tracker-e7ff7", "public-exp-tracker"]);

export function parseSetAdminArgs(argv: string[]): SetAdminArgs {
  let project = "";
  let email = "";
  let revoke = false;
  let execute = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project") project = argv[++i] ?? "";
    else if (a === "--email") email = argv[++i] ?? "";
    else if (a === "--revoke") revoke = true;
    else if (a === "--execute") execute = true;
    else throw new Error(`Unknown argument ${a}`);
  }
  if (!project || !email) throw new Error("Usage: npm run set-admin -- --project <id> --email <email> [--revoke] [--execute]");
  if (V1_PROJECTS.has(project)) throw new Error("Refusing to touch a v1 project.");
  return { project, email: email.trim(), revoke, execute };
}

/** Existing custom claims with `admin` set or removed. */
export function nextClaims(customAttributes: string | undefined, revoke: boolean): Record<string, unknown> {
  let claims: Record<string, unknown> = {};
  if (customAttributes) {
    const parsed: unknown = JSON.parse(customAttributes);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) claims = { ...(parsed as Record<string, unknown>) };
  }
  if (revoke) delete claims.admin;
  else claims.admin = true;
  return claims;
}

async function identityToolkit(project: string, token: string, method: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Goog-User-Project": project },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = (json.error as { message?: string } | undefined)?.message ?? res.statusText;
    throw new Error(`accounts:${method} failed (${res.status}): ${message}`);
  }
  return json;
}

async function main(): Promise<void> {
  const args = parseSetAdminArgs(process.argv.slice(2));
  const token = process.env.ADMIN_ACCESS_TOKEN ?? "";
  if (!token) throw new Error("Set ADMIN_ACCESS_TOKEN (see docs/wiki/operations.md › Billing dashboard).");

  const lookup = await identityToolkit(args.project, token, "lookup", { email: [args.email] });
  const user = (lookup.users as { localId: string; customAttributes?: string }[] | undefined)?.[0];
  if (!user) throw new Error(`No user with that email in ${args.project}. Sign in to the app once first.`);

  const claims = nextClaims(user.customAttributes, args.revoke);
  const action = args.revoke ? "revoke admin from" : "grant admin to";
  console.log(`Project ${args.project}: ${action} uid ${user.localId}. Claims after: ${JSON.stringify(claims)}`);
  if (!args.execute) {
    console.log("Preview only. Re-run with --execute to apply.");
    return;
  }
  await identityToolkit(args.project, token, "update", { localId: user.localId, customAttributes: JSON.stringify(claims) });
  console.log("Done. The user sees it after their ID token refreshes (sign out and back in).");
}

if (require.main === module) main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
