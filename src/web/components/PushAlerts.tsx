import { BellOff, BellRing, Smartphone, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/api";
import { describePushError, disablePush, enablePush, getPushState, sendTestPush, type PushState } from "@/lib/push";
import { Button, Card, CardHeader, cn } from "./ui";

export type PushText = {
  title: string; desc: string; turnOn: string; turnOff: string; on: string; test: string; testSent: string; denied: string;
  unsupported: string; install: string; notConfigured: string; dismiss: string; failed: string; serviceOff: string;
};

/** Shows why turning alerts on failed, with the browser's own reason when there is no friendlier one. */
function showPushError(e: unknown, text: PushText) {
  const { kind, detail } = describePushError(e);
  const message =
    kind === "service-off" ? text.serviceOff : kind === "denied" ? text.denied : kind === "server" ? detail : `${text.failed} (${detail})`;
  toast.error(message, { duration: 12000 });
  console.warn("Turning on alerts failed:", kind, detail);
}

export const PUSH_TEXT_EN_OWNER: PushText = {
  title: "Order alerts on this device",
  desc: "Get a notification when a retailer places or cancels an order — even when DealerLink is closed.",
  turnOn: "Turn on alerts",
  turnOff: "Turn off",
  on: "Alerts are on for this device",
  test: "Send test alert",
  testSent: "Test alert sent. It should appear in a few seconds.",
  denied: "Alerts are blocked for this site. Allow notifications in your browser's site settings, then reload the page.",
  unsupported: "This browser can't show alerts. Use Chrome, Edge or Firefox.",
  install: "On iPhone or iPad: tap Share, then 'Add to Home Screen', open DealerLink from the home screen, then turn on alerts.",
  notConfigured: "Alerts are not set up on this site yet (see the README: 'Phone alerts').",
  dismiss: "Not now",
  failed: "Couldn't turn on alerts. Please try again.",
  serviceOff:
    "Your browser's push service is switched off, so alerts can't be delivered. In Brave: Settings → Privacy and security → turn on 'Use Google services for push messaging', then try again. Or use Chrome or Edge.",
};

function usePushState() {
  const [state, setState] = useState<PushState | "loading">("loading");
  useEffect(() => {
    let alive = true;
    getPushState().then((s) => alive && setState(s), () => alive && setState("unsupported"));
    return () => {
      alive = false;
    };
  }, []);
  return [state, setState] as const;
}

/** Full control: used on Settings (wholesaler) and Profile (retailer). */
export function PushAlertsCard({ text }: { text: PushText }) {
  const [state, setState] = usePushState();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<PushState>) => {
    setBusy(true);
    try {
      setState(await fn());
    } catch (e) {
      showPushError(e, text);
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true);
    try {
      await sendTestPush();
      toast.success(text.testSent);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (state === "loading") return null;
  return (
    <Card>
      <CardHeader title={text.title} description={text.desc} />
      <div className="p-4 sm:p-5">
        {state === "on" ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700"><BellRing className="h-4 w-4" aria-hidden /> {text.on}</p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" loading={busy} onClick={test}>{text.test}</Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(disablePush)}><BellOff className="h-3.5 w-3.5" aria-hidden /> {text.turnOff}</Button>
            </div>
          </div>
        ) : state === "off" ? (
          <Button loading={busy} onClick={() => run(enablePush)}><BellRing className="h-4 w-4" aria-hidden /> {text.turnOn}</Button>
        ) : (
          <p className="flex items-start gap-2 text-sm text-slate-600">
            <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            {state === "denied" ? text.denied : state === "needs-install" ? text.install : state === "disabled" ? text.notConfigured : text.unsupported}
          </p>
        )}
      </div>
    </Card>
  );
}

const DISMISS_KEY = "dl_push_banner_dismissed";

/** Gentle prompt on the retailer home screen. Shown only while alerts can be turned on and are off. */
export function PushAlertsBanner({ text, className }: { text: PushText; className?: string }) {
  const [state, setState] = usePushState();
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  if (dismissed || !(state === "off" || state === "needs-install")) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };
  const turnOn = async () => {
    setBusy(true);
    try {
      const s = await enablePush();
      setState(s);
      if (s === "denied") toast.error(text.denied);
    } catch (e) {
      showPushError(e, text);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4", className)} role="region" aria-label={text.title}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-brand-700"><BellRing className="h-[18px] w-[18px]" aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{text.title}</p>
        <p className="mt-0.5 text-[13px] text-slate-600">{state === "needs-install" ? text.install : text.desc}</p>
        {state === "off" && (
          <div className="mt-3 flex gap-2">
            <Button size="sm" loading={busy} onClick={turnOn}>{text.turnOn}</Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>{text.dismiss}</Button>
          </div>
        )}
      </div>
      <button type="button" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-white" aria-label={text.dismiss} onClick={dismiss}>
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
