import { api } from "./api";

/**
 * Phone / desktop alerts via the browser's free Web Push service.
 * State is per browser (the service worker and push subscription belong to the browser, not the tab).
 */
export type PushState =
  | "unsupported" // this browser cannot receive push
  | "needs-install" // iPhone/iPad: only works after "Add to Home Screen"
  | "disabled" // the server has no VAPID keys configured
  | "denied" // the user blocked notifications for this site
  | "off"
  | "on";

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
const browserSupportsPush = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

let keyRequest: Promise<{ enabled: boolean; publicKey: string | null }> | null = null;
const serverKey = () => (keyRequest ??= api.get<{ enabled: boolean; publicKey: string | null }>("/push/key").then((r) => r.data).catch(() => ({ enabled: false, publicKey: null })));

function keyBytes(b64url: string): Uint8Array {
  const b = b64url.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b + "===".slice((b.length + 3) % 4)), (c) => c.charCodeAt(0));
}
function sameKey(a: ArrayBuffer | null | undefined, b64url: string): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  const y = keyBytes(b64url);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}
async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function getPushState(): Promise<PushState> {
  if (!browserSupportsPush()) return isIos() && !isStandalone() ? "needs-install" : "unsupported";
  const key = await serverKey();
  if (!key.enabled) return "disabled";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  const sub = await currentSubscription();
  if (!sub) return "off";
  // The browser may hold a subscription for a different account (sessions are per tab): ask the server whose it is.
  const res = await api.post<{ subscribed: boolean }>("/push/status", { endpoint: sub.endpoint }).catch(() => null);
  return res?.data.subscribed ? "on" : "off";
}

export async function enablePush(): Promise<PushState> {
  const key = await serverKey();
  if (!key.enabled || !key.publicKey) return "disabled";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, key.publicKey)) {
    await sub.unsubscribe(); // made with an older server key: replace it
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key.publicKey) as BufferSource });
  const json = sub.toJSON();
  await api.post("/push/subscribe", { endpoint: json.endpoint, keys: json.keys });
  return "on";
}

/** Turns alerts off for this browser (for whichever account had them). */
export async function disablePush(): Promise<PushState> {
  const sub = await currentSubscription();
  if (sub) {
    await api.post("/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe();
  }
  return "off";
}

export const sendTestPush = () => api.post<{ sent: number }>("/push/test");
