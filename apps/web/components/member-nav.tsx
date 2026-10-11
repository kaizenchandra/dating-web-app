"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../packages/generated-clients/client";
export function MemberNav() {
  const [locale, setLocale] = useState<"en" | "hi">("en");
  useEffect(() => {
    const c = new AbortController();
    api("/account/wellbeing", "get", undefined, c.signal)
      .then((p) => setLocale(p.locale))
      .catch(() => {});
    return () => c.abort();
  }, []);
  const labels =
    locale === "hi"
      ? ["खोजें", "कनेक्शन", "संदेश", "प्रोफ़ाइल", "सेटिंग्स"]
      : ["Discover", "Connections", "Messages", "Profile", "Settings"];
  return (
    <nav className="member-nav" aria-label="Member navigation" lang={locale}>
      {["/discover", "/interests", "/inbox", "/profile", "/settings"].map(
        (href, i) => (
          <Link key={href} href={href}>
            {labels[i]}
          </Link>
        ),
      )}
    </nav>
  );
}
