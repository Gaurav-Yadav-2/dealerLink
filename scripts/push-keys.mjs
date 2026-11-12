// Creates the VAPID key pair that phone alerts (Web Push) need. Free: no account or service required.
//
//   npm run push:keys                    -> writes the keys to .dev.vars (local development)
//   npm run push:keys -- --remote        -> stores them as secrets on the deployed Cloudflare Worker
//
// Keep the same keys once alerts are in use: new keys mean every device must turn alerts on again.
// Add --force to replace existing keys anyway.
import { execFileSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const remote = process.argv.includes("--remote");
const force = process.argv.includes("--force");

const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const privateKey = (await webcrypto.subtle.exportKey("jwk", pair.privateKey)).d;
const publicKey = Buffer.from(await webcrypto.subtle.exportKey("raw", pair.publicKey)).toString("base64url");

if (remote) {
  let existing = "";
  try {
    existing = execFileSync("npx", ["wrangler", "secret", "list"], { encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    console.error("Could not read the Worker's secrets. Run `npx wrangler login` and deploy once (`npm run deploy`) first.");
    process.exit(1);
  }
  if (existing.includes("VAPID_PRIVATE_KEY") && !force) {
    console.log("Phone alert keys are already set on the deployed Worker. Nothing changed.");
    console.log("(Use --force to replace them; every device would then need to turn alerts on again.)");
    process.exit(0);
  }
  for (const [name, value] of [["VAPID_PUBLIC_KEY", publicKey], ["VAPID_PRIVATE_KEY", privateKey]]) {
    execFileSync("npx", ["wrangler", "secret", "put", name], { input: value, stdio: ["pipe", "inherit", "inherit"], shell: true });
  }
  console.log("\nPhone alert keys stored as Cloudflare secrets. Alerts are now available on the live site.");
} else {
  const file = ".dev.vars";
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (/^VAPID_PRIVATE_KEY=/m.test(current) && !force) {
    console.log("Phone alert keys are already in .dev.vars. Nothing changed (use --force to replace them).");
    process.exit(0);
  }
  const kept = current.split(/\r?\n/).filter((l) => !/^VAPID_(PUBLIC|PRIVATE)_KEY=/.test(l)).join("\n").trimEnd();
  writeFileSync(file, `${kept}\n# Phone alerts (Web Push) — local keys, created by npm run push:keys\nVAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}\n`);
  console.log("Phone alert keys written to .dev.vars. Restart `npm run dev` to use them.");
}
