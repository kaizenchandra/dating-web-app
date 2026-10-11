"use client";
import { clearBrowserOutbox } from "../lib/message-outbox";
import { useState } from "react";
import { api } from "../../../packages/generated-clients/client";

export function LogoutButton({ label = "Log out" }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="logout-control">
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await api("/auth/logout", "post");
            let cleared = true;
            try {
              await clearBrowserOutbox();
            } catch {
              cleared = false;
            }
            // A document navigation also discards cached private React pages.
            window.location.replace(
              cleared ? "/login" : "/login?error=BROWSER_STORAGE_UNCLEARED",
            );
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy ? "Logging out…" : label}
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error} Try logging out again.
        </p>
      )}
    </div>
  );
}
