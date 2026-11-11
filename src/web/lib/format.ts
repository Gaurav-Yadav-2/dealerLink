export { formatINR, rupeesToPaise, paiseToRupeesString, formatGstRate } from "@shared/money";

const IST = "Asia/Kolkata";
const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: IST });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST });
const shortFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: IST });
const monthFmt = new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });

const toDate = (v: string) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00+05:30` : v);

export const formatDate = (v?: string | null) => (v ? dateFmt.format(toDate(v)) : "—");
export const formatDateTime = (v?: string | null) => (v ? dateTimeFmt.format(toDate(v)) : "—");
export const formatDayShort = (v: string) => shortFmt.format(toDate(v));
/** "2026-11" -> "Nov 26" */
export const formatMonth = (ym: string) => monthFmt.format(new Date(`${ym}-01T00:00:00Z`));

export function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return formatDate(iso);
}

/** Today's calendar date in India as YYYY-MM-DD. */
export const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
export const daysAgoIST = (n: number) => new Date(Date.now() + 330 * 60000 - n * 86400000).toISOString().slice(0, 10);

export const compactINR = (paise: number) => {
  const r = paise / 100;
  if (r >= 1e7) return `₹${(r / 1e7).toFixed(r >= 1e8 ? 0 : 1)}Cr`;
  if (r >= 1e5) return `₹${(r / 1e5).toFixed(r >= 1e6 ? 0 : 1)}L`;
  if (r >= 1e3) return `₹${(r / 1e3).toFixed(r >= 1e4 ? 0 : 1)}k`;
  return `₹${Math.round(r)}`;
};

export const titleCase = (s: string) => s.replace(/[._]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
