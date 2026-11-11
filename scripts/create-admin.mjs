// Creates (or resets the password of) a platform administrator.
// There is deliberately no public sign-up for admins: this script is the only way to create one.
//
//   npm run create-admin -- --email you@example.com --name "Your Name" --password "S0me-long-passphrase"            (local)
//   npm run create-admin -- --email you@example.com --name "Your Name" --password "S0me-long-passphrase" --remote   (production)
import { randomUUID } from "node:crypto";
import { hashPassword, q, runSql } from "./lib.mjs";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const email = arg("email")?.trim().toLowerCase();
const name = arg("name")?.trim() || "Platform Admin";
const password = arg("password");
const remote = process.argv.includes("--remote");

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Usage: npm run create-admin -- --email you@example.com --name "Your Name" --password "<password>" [--remote]');
  process.exit(1);
}
if (!password || password.length < 12 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
  console.error("Choose an admin password of at least 12 characters containing letters and numbers.");
  process.exit(1);
}

const ts = new Date().toISOString();
const hash = await hashPassword(password);
// If the email already belongs to an admin, only the password is reset. It never converts an owner/retailer into an admin.
const sql = `
INSERT INTO users (id, email, password_hash, name, role, status, is_demo, created_at, updated_at)
SELECT ${q(randomUUID())}, ${q(email)}, ${q(hash)}, ${q(name)}, 'admin', 'active', 0, ${q(ts)}, ${q(ts)}
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = ${q(email)});
UPDATE users SET password_hash = ${q(hash)}, name = ${q(name)}, status = 'active', updated_at = ${q(ts)} WHERE email = ${q(email)} AND role = 'admin';
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ${q(email)} AND role = 'admin');
`;
runSql("scripts/.admin.sql", sql, { remote });
console.log(`\nAdmin ${email} is ready on the ${remote ? "REMOTE (production)" : "local"} database. Sign in at /login.`);
console.log("If that email already belonged to a wholesaler or retailer, nothing was changed — use a different email.\n");
