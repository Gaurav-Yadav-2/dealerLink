import { Hono } from "hono";
import { RESET_TTL_MINUTES } from "../../shared/constants";
import { acceptInviteSchema, changePasswordSchema, forgotSchema, loginSchema, registerSchema, resetSchema } from "../../shared/schemas";
import { authForUser, createSession, destroySession, publicAuth, requireAuth, type AuthUser } from "../lib/auth";
import { hashPassword, randomToken, sha256Hex, verifyPassword } from "../lib/crypto";
import { AppError, body, conflict, now, ok, uuid, type AppEnv, type Ctx } from "../lib/http";
import { auditStmt, businessUserIds, isConstraintError, notifyStmt, rateLimit, uniqueSlug } from "../lib/util";

export const authRoutes = new Hono<AppEnv>();

// A real hash to compare against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH = "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

async function sessionResponse(c: Ctx, userId: string, status: 200 | 201 = 200) {
  const session = await createSession(c, userId);
  await c.env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(now(), userId).run();
  const user = await c.env.DB.prepare("SELECT id, email, name, phone, role, is_demo FROM users WHERE id = ?").bind(userId).first<AuthUser>();
  if (!user) throw new AppError(500, "INTERNAL_ERROR", "Could not create session");
  return ok(c, publicAuth(await authForUser(c.env.DB, user, session.id, session.csrf)), undefined, status);
}

authRoutes.get("/me", (c) => {
  const auth = c.get("auth");
  return ok(c, auth ? publicAuth(auth) : null);
});

authRoutes.get("/check-business-name", async (c) => {
  await rateLimit(c, "check-name", "-", 60, 60);
  const name = (c.req.query("name") ?? "").trim();
  if (name.length < 3) return ok(c, { available: false, slug: null });
  const existing = await c.env.DB.prepare("SELECT 1 FROM businesses WHERE name = ?").bind(name).first();
  return ok(c, { available: !existing, slug: existing ? null : await uniqueSlug(c.env.DB, name) });
});

authRoutes.post("/register", async (c) => {
  await rateLimit(c, "register", "-", 10, 3600);
  const input = await body(c, registerSchema);
  const db = c.env.DB;
  if (await db.prepare("SELECT 1 FROM users WHERE email = ?").bind(input.email).first()) {
    throw conflict("An account with this email already exists. Try signing in instead.");
  }
  if (await db.prepare("SELECT 1 FROM businesses WHERE name = ?").bind(input.businessName).first()) {
    throw conflict("A business with this name is already registered. Please choose a different name.");
  }
  const userId = uuid();
  const businessId = uuid();
  const ts = now();
  const slug = await uniqueSlug(db, input.businessName);
  try {
    await db.batch([
      db.prepare("INSERT INTO users (id, email, password_hash, name, phone, role, created_at, updated_at) VALUES (?,?,?,?,?,'owner',?,?)")
        .bind(userId, input.email, await hashPassword(input.password, Number(c.env.PASSWORD_HASH_ITERATIONS)), input.name, input.phone, ts, ts),
      db.prepare("INSERT INTO businesses (id, name, slug, owner_user_id, phone, email, city, state, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(businessId, input.businessName, slug, userId, input.phone, input.email, input.city ?? null, input.state ?? null, ts, ts),
      db.prepare("INSERT INTO business_members (id, business_id, user_id, role, created_at) VALUES (?,?,?,'owner',?)").bind(uuid(), businessId, userId, ts),
      auditStmt(db, { businessId, actorId: userId, action: "business.registered", entityType: "business", entityId: businessId }),
    ]);
  } catch (e) {
    if (isConstraintError(e, "UNIQUE")) throw conflict("That email or business name was just taken. Please try again.");
    throw e;
  }
  return sessionResponse(c, userId, 201);
});

authRoutes.post("/login", async (c) => {
  const input = await body(c, loginSchema);
  await rateLimit(c, "login", input.email, 8, 600);
  await rateLimit(c, "login-ip", "-", 40, 600);
  const user = await c.env.DB.prepare("SELECT id, password_hash, status, is_demo FROM users WHERE email = ?")
    .bind(input.email)
    .first<{ id: string; password_hash: string; status: string; is_demo: number }>();
  const valid = await verifyPassword(input.password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !valid) throw new AppError(401, "INVALID_CREDENTIALS", "Incorrect email or password");
  if (user.is_demo && c.env.ALLOW_DEMO_ACCOUNTS !== "true") {
    throw new AppError(403, "DEMO_DISABLED", "Demo accounts are disabled in this environment");
  }
  if (user.status !== "active") throw new AppError(403, "ACCOUNT_SUSPENDED", "This account has been suspended. Contact support.");
  await destroySession(c, false); // drop any previous session row; the new cookie replaces the old one
  return sessionResponse(c, user.id);
});

authRoutes.post("/logout", async (c) => {
  await destroySession(c);
  return ok(c, { loggedOut: true });
});

authRoutes.post("/change-password", async (c) => {
  const auth = requireAuth(c);
  const input = await body(c, changePasswordSchema);
  await rateLimit(c, "change-password", auth.user.id, 5, 600);
  const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(auth.user.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(input.currentPassword, row.password_hash))) {
    throw new AppError(422, "VALIDATION_ERROR", "Your current password is incorrect");
  }
  const db = c.env.DB;
  await db.batch([
    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").bind(await hashPassword(input.newPassword, Number(c.env.PASSWORD_HASH_ITERATIONS)), now(), auth.user.id),
    // sign out every other device
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").bind(auth.user.id, auth.sessionId),
    auditStmt(db, { businessId: auth.business?.id ?? null, actorId: auth.user.id, action: "user.password_changed", entityType: "user", entityId: auth.user.id }),
  ]);
  return ok(c, { changed: true });
});

// ── Retailer invitations ──────────────────────────────────────────────

async function findInvitation(c: Ctx, token: string) {
  const inv = await c.env.DB.prepare(
    `SELECT i.id, i.business_id, i.retailer_id, i.expires_at, i.accepted_at, i.revoked_at,
            r.business_name AS retailer_name, r.contact_person, r.email, r.phone, r.user_id, r.status AS retailer_status,
            b.name AS business_name, b.status AS business_status
     FROM retailer_invitations i
     JOIN retailer_profiles r ON r.id = i.retailer_id
     JOIN businesses b ON b.id = i.business_id
     WHERE i.token_hash = ?`,
  )
    .bind(await sha256Hex(token))
    .first<any>();
  const bad = new AppError(404, "INVITATION_INVALID", "This invitation link is invalid or has expired. Ask your wholesaler for a new one.");
  if (!inv || inv.revoked_at || inv.accepted_at || inv.user_id || inv.expires_at < now()) throw bad;
  if (inv.business_status !== "active" || inv.retailer_status !== "active") throw bad;
  return inv;
}

authRoutes.get("/invitations/:token", async (c) => {
  await rateLimit(c, "invite-view", "-", 30, 600);
  const inv = await findInvitation(c, c.req.param("token"));
  return ok(c, {
    wholesalerName: inv.business_name,
    retailerName: inv.retailer_name,
    contactPerson: inv.contact_person,
    email: inv.email,
    expiresAt: inv.expires_at,
  });
});

authRoutes.post("/invitations/:token/accept", async (c) => {
  await rateLimit(c, "invite-accept", "-", 10, 600);
  const inv = await findInvitation(c, c.req.param("token"));
  const input = await body(c, acceptInviteSchema);
  const db = c.env.DB;
  if (await db.prepare("SELECT 1 FROM users WHERE email = ?").bind(input.email).first()) {
    throw conflict("An account with this email already exists. Use a different email or sign in.");
  }
  const userId = uuid();
  const ts = now();
  const owners = await businessUserIds(db, inv.business_id);
  try {
    const res = await db.batch([
      db.prepare("INSERT INTO users (id, email, password_hash, name, phone, role, created_at, updated_at) VALUES (?,?,?,?,?,'retailer',?,?)")
        .bind(userId, input.email, await hashPassword(input.password, Number(c.env.PASSWORD_HASH_ITERATIONS)), input.name, inv.phone, ts, ts),
      // Guarded so two simultaneous accepts cannot both claim the profile (user_id is also UNIQUE).
      db.prepare("UPDATE retailer_profiles SET user_id = ?, registered_at = ?, email = COALESCE(email, ?), updated_at = ? WHERE id = ? AND user_id IS NULL")
        .bind(userId, ts, input.email, ts, inv.retailer_id),
      db.prepare("UPDATE retailer_invitations SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL").bind(ts, inv.id),
      auditStmt(db, { businessId: inv.business_id, actorId: userId, action: "retailer.registered", entityType: "retailer", entityId: inv.retailer_id }),
      ...owners.map((uid) =>
        notifyStmt(db, { userId: uid, businessId: inv.business_id, type: "retailer_registered", title: `${inv.retailer_name} joined your store`, body: `${input.name} accepted the invitation and can now place orders.`, link: `/dashboard/retailers/${inv.retailer_id}` }),
      ),
    ]);
    if (res[1].meta.changes !== 1) {
      await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
      throw conflict("This invitation has already been used.");
    }
  } catch (e) {
    if (isConstraintError(e, "UNIQUE")) throw conflict("This invitation has already been used or the email is taken.");
    throw e;
  }
  return sessionResponse(c, userId, 201);
});

// ── Password reset ────────────────────────────────────────────────────
// No email provider is configured (by design: no paid services). A reset link is issued by someone
// who can reach the user: the wholesaler for their retailers, the platform admin for wholesalers.

export async function issueResetToken(db: D1Database, userId: string, createdBy: string | null): Promise<string> {
  const token = randomToken();
  await db.batch([
    db.prepare("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL").bind(now(), userId),
    db.prepare("INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_by, created_at) VALUES (?,?,?,?,?,?)")
      .bind(uuid(), userId, await sha256Hex(token), new Date(Date.now() + RESET_TTL_MINUTES * 60000).toISOString(), createdBy, now()),
  ]);
  return token;
}

authRoutes.post("/forgot-password", async (c) => {
  const input = await body(c, forgotSchema);
  await rateLimit(c, "forgot", input.email, 3, 3600);
  await rateLimit(c, "forgot-ip", "-", 15, 3600);
  const db = c.env.DB;
  const user = await db.prepare("SELECT id, name, role, status, is_demo FROM users WHERE email = ?").bind(input.email).first<any>();
  let devToken: string | undefined;
  if (user && user.status === "active") {
    if (user.role === "retailer") {
      const r = await db.prepare("SELECT id, business_id, business_name FROM retailer_profiles WHERE user_id = ?").bind(user.id).first<any>();
      if (r) {
        const owners = await businessUserIds(db, r.business_id);
        if (owners.length) {
          await db.batch(owners.map((uid) =>
            notifyStmt(db, { userId: uid, businessId: r.business_id, type: "password_reset_request", title: `${r.business_name} needs a password reset`, body: "Open the retailer and use “Create password reset link”, then share it with them.", link: `/dashboard/retailers/${r.id}` }),
          ));
        }
      }
    } else if (user.role === "owner") {
      const { results: admins } = await db.prepare("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").all<{ id: string }>();
      if (admins.length) {
        await db.batch(admins.map((a) =>
          notifyStmt(db, { userId: a.id, businessId: null, type: "password_reset_request", title: `${user.name} requested a password reset`, body: input.email, link: `/admin/users?q=${encodeURIComponent(input.email)}` }),
        ));
      }
    }
    if (c.env.DEV_SHOW_RESET_LINKS === "true") devToken = await issueResetToken(db, user.id, null);
  }
  // Identical response whether or not the email exists.
  return ok(c, { requested: true, ...(devToken ? { devResetToken: devToken } : {}) });
});

authRoutes.post("/reset-password", async (c) => {
  await rateLimit(c, "reset", "-", 10, 600);
  const input = await body(c, resetSchema);
  const db = c.env.DB;
  const row = await db.prepare("SELECT id, user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?")
    .bind(await sha256Hex(input.token), now())
    .first<{ id: string; user_id: string }>();
  if (!row) throw new AppError(422, "RESET_INVALID", "This reset link is invalid or has expired. Request a new one.");
  await db.batch([
    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").bind(await hashPassword(input.password, Number(c.env.PASSWORD_HASH_ITERATIONS)), now(), row.user_id),
    db.prepare("UPDATE password_resets SET used_at = ? WHERE id = ?").bind(now(), row.id),
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.user_id),
    auditStmt(db, { businessId: null, actorId: row.user_id, action: "user.password_reset", entityType: "user", entityId: row.user_id }),
  ]);
  return ok(c, { reset: true });
});
