"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api, ClientError } from "../../../packages/generated-clients/client";
import { LogoutButton } from "./logout-button";

export function AccountControls() {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    const refresh = () => {
      api("/account", "get", undefined, c.signal)
        .then(() => setSignedIn(true))
        .catch((e) => {
          if (e instanceof ClientError && e.status === 401) setSignedIn(false);
          // Restricted members must still be able to end their session.
          if (e instanceof ClientError && e.status === 403) setSignedIn(true);
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      c.abort();
      window.removeEventListener("focus", refresh);
    };
  }, [pathname]);
  if (!signedIn) return null;
  return (
    <aside className="account-controls" aria-label="Account controls">
      <LogoutButton />
    </aside>
  );
}
