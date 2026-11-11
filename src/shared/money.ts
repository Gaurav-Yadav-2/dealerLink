/** Money helpers. All amounts are integer paise. */

const whole = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const withPaise = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatINR(paise: number | null | undefined): string {
  if (paise == null) return "—";
  // whole rupees show no decimals; anything else always shows both paise digits (₹57,550.80, never ₹57,550.8)
  return (paise % 100 === 0 ? whole : withPaise).format(paise / 100);
}

/** Parses user input like "1,250.50" into paise. Returns null when not a valid non-negative amount. */
export function rupeesToPaise(input: string | number): number | null {
  const s = String(input).replace(/[,\s₹]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(paise) ? paise : null;
}

export function paiseToRupeesString(paise: number | null | undefined): string {
  if (paise == null) return "";
  const whole = Math.trunc(paise / 100);
  const frac = Math.abs(paise % 100);
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0")}`;
}

/** GST on a line, rounded half-up to the nearest paisa using integer maths only. */
export function gstAmount(lineSubtotalPaise: number, rateBp: number): number {
  return Math.floor((lineSubtotalPaise * rateBp + 5000) / 10000);
}

export function formatGstRate(rateBp: number): string {
  return `${rateBp / 100}%`;
}
