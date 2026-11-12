import { CheckCircle2, Download, Share } from "lucide-react";
import { toast } from "sonner";
import { useInstall } from "@/lib/install";
import { Button, Card, CardHeader, cn } from "./ui";

export type InstallText = { title: string; desc: string; button: string; ios: string; installed: string; done: string };

export const INSTALL_TEXT_EN: InstallText = {
  title: "Install the DealerLink app",
  desc: "Add DealerLink to your home screen. It opens full-screen with its own icon, like any other app — no web address to type.",
  button: "Install app",
  ios: "On iPhone or iPad: tap the Share button, then 'Add to Home Screen'.",
  installed: "DealerLink is installed on this device.",
  done: "DealerLink is now on your home screen.",
};

/** Compact header button, shown only when the browser can install in one tap. */
export function InstallAppButton({ label, className, light }: { label: string; className?: string; light?: boolean }) {
  const { mode, install } = useInstall();
  if (mode !== "prompt") return null;
  return (
    <button
      type="button"
      onClick={() => install()}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium",
        light ? "bg-white/10 text-white hover:bg-white/20" : "border border-line bg-white text-slate-700 shadow-sm hover:bg-slate-50",
        className,
      )}
    >
      <Download className="h-4 w-4" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only sm:hidden">{label}</span>
    </button>
  );
}

/** Full explanation card for Settings / Profile. Hidden where installation isn't possible. */
export function InstallAppCard({ text }: { text: InstallText }) {
  const { mode, install } = useInstall();
  if (mode === "unavailable") return null;
  return (
    <Card>
      <CardHeader title={text.title} description={mode === "installed" ? undefined : text.desc} />
      <div className="flex items-center gap-4 p-4 sm:p-5">
        <img src="/icon-192.png" alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-xl" />
        {mode === "installed" ? (
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" aria-hidden /> {text.installed}</p>
        ) : mode === "prompt" ? (
          <Button onClick={async () => { if (await install()) toast.success(text.done); }}>
            <Download className="h-4 w-4" aria-hidden /> {text.button}
          </Button>
        ) : (
          <p className="flex items-start gap-2 text-sm text-slate-600"><Share className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden /> {text.ios}</p>
        )}
      </div>
    </Card>
  );
}
