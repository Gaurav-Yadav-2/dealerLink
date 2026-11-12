import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useApi } from "@/lib/hooks";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("Could not load the security check"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export type HumanCheckHandle = { reset: () => void };

/**
 * Cloudflare Turnstile bot check. Renders nothing (and reports `ready`) when the site has no Turnstile key configured.
 * `onToken(null)` means "no valid token yet"; tokens are single-use, so call `reset()` after every submit.
 */
export const HumanCheck = forwardRef<HumanCheckHandle, { onToken: (token: string | null) => void; onStatus?: (s: "off" | "loading" | "ready" | "error") => void }>(
  function HumanCheck({ onToken, onStatus }, ref) {
    const config = useApi<{ turnstileSiteKey: string | null }>("/auth/config");
    const siteKey = config.data?.data.turnstileSiteKey ?? null;
    const box = useRef<HTMLDivElement>(null);
    const widgetId = useRef<string | null>(null);
    const [failed, setFailed] = useState(false);

    const status = useCallback((s: "off" | "loading" | "ready" | "error") => onStatus?.(s), [onStatus]);

    useEffect(() => {
      if (config.isLoading) return status("loading");
      if (!siteKey) {
        onToken(null);
        return status("off");
      }
      let cancelled = false;
      status("loading");
      loadScript()
        .then(() => {
          if (cancelled || !box.current || !window.turnstile) return;
          widgetId.current = window.turnstile.render(box.current, {
            sitekey: siteKey,
            theme: "light",
            size: "flexible",
            callback: (t: string) => {
              onToken(t);
              status("ready");
            },
            "expired-callback": () => onToken(null),
            "error-callback": () => {
              onToken(null);
              status("error");
            },
          });
        })
        .catch(() => {
          setFailed(true);
          status("error");
        });
      return () => {
        cancelled = true;
        if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      };
    }, [siteKey, config.isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

    useImperativeHandle(ref, () => ({
      reset: () => {
        onToken(null);
        if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
      },
    }));

    if (!siteKey) return null;
    return (
      <div>
        <div ref={box} className="min-h-[65px]" />
        {failed && <p role="alert" className="mt-1 text-xs text-red-600">The security check could not load. Check your connection and reload the page.</p>}
      </div>
    );
  },
);

/** State + helpers for a form protected by HumanCheck. */
export function useHumanCheck() {
  const ref = useRef<HumanCheckHandle>(null);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"off" | "loading" | "ready" | "error">("loading");
  const required = status !== "off";
  return {
    ref,
    token,
    setToken,
    setStatus,
    /** True when the form may be submitted (check passed, or the site has no check). */
    canSubmit: !required || !!token,
    headers: (): Record<string, string> => (token ? { "X-Turnstile-Token": token } : {}),
    /** Tokens are single-use: get a fresh one after each attempt. */
    reset: () => ref.current?.reset(),
  };
}
