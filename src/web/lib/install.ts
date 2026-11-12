import { useEffect, useReducer } from "react";

/**
 * "Install app" support. An installed DealerLink opens from the home screen, full-screen, with its own name and
 * icon and no web address bar. Chrome / Edge / Samsung Internet raise `beforeinstallprompt`, which we keep so a
 * button can offer installation; iPhone/iPad have no such event, so we show the Share → Add to Home Screen steps.
 */
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: InstallPromptEvent | null = null;
let justInstalled = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Call once at start-up: the browser fires the event only once per page load, often before React renders. */
export function initInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own button instead of the browser's mini banner
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    justInstalled = true;
    notify();
  });
}

export const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** installed = running as the app; prompt = one-tap install available; ios = show manual steps; unavailable = this browser can't. */
export type InstallMode = "installed" | "prompt" | "ios" | "unavailable";

export function useInstall() {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    listeners.add(rerender);
    return () => {
      listeners.delete(rerender);
    };
  }, []);
  const mode: InstallMode = isStandalone() || justInstalled ? "installed" : deferred ? "prompt" : isIos() ? "ios" : "unavailable";
  const install = async (): Promise<boolean> => {
    if (!deferred) return false;
    const event = deferred;
    deferred = null; // the event can be used only once
    await event.prompt();
    const choice = await event.userChoice;
    notify();
    return choice.outcome === "accepted";
  };
  return { mode, install };
}
