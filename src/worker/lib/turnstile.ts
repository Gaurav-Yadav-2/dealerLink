import { AppError, type Ctx } from "./http";

/**
 * Bot check for public forms using Cloudflare Turnstile (free).
 * Switched off unless TURNSTILE_SECRET_KEY is set. The browser sends the widget's one-time token in the
 * X-Turnstile-Token header; the token is verified with Cloudflare before the form is processed.
 */
export const turnstileEnabled = (c: Ctx) => !!c.env.TURNSTILE_SECRET_KEY;

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function requireHuman(c: Ctx): Promise<void> {
  if (!turnstileEnabled(c)) return;
  const token = c.req.header("x-turnstile-token");
  if (!token || token.length > 2048) throw new AppError(403, "CAPTCHA_REQUIRED", "Please complete the security check and try again.");
  const form = new FormData();
  form.append("secret", c.env.TURNSTILE_SECRET_KEY!);
  form.append("response", token);
  const ip = c.req.header("cf-connecting-ip");
  if (ip) form.append("remoteip", ip);
  let result: { success?: boolean } | null = null;
  try {
    const res = await fetch(VERIFY_URL, { method: "POST", body: form });
    result = await res.json();
  } catch {
    // Fail closed: if the check cannot be verified, the form is not processed.
    throw new AppError(403, "CAPTCHA_UNAVAILABLE", "The security check could not be verified. Please try again in a moment.");
  }
  if (!result?.success) throw new AppError(403, "CAPTCHA_FAILED", "The security check failed. Please try again.");
}
