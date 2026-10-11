"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../../packages/generated-clients/client";
export default function Wellbeing() {
  const [prefs, setPrefs] = useState<{
    locale: "en" | "hi";
    quietEnabled: boolean;
    quietStart: number;
    quietEnd: number;
    readReceipts: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    api("/account/wellbeing", "get", undefined, c.signal)
      .then(setPrefs)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [attempt]);
  return (
    <main className="account-page">
      <Link href="/settings">Account / खाता</Link>
      <h1>
        Your pace.
        <br />
        <em>अपनी रफ़्तार।</em>
      </h1>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <button
        className="secondary"
        onClick={() => {
          setError("");
          setAttempt((x) => x + 1);
        }}
      >
        Reload preferences
      </button>
      {prefs ? (
        <form
          className="status-card form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              setPrefs(await api("/account/wellbeing", "put", prefs));
              setNotice("Preferences saved. आपकी पसंद सहेज दी गई है।");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="locale">Navigation language / भाषा</label>
          <select
            id="locale"
            value={prefs.locale}
            onChange={(e) =>
              setPrefs({ ...prefs, locale: e.target.value as "en" | "hi" })
            }
          >
            <option value="en">English</option>
            <option value="hi">हिन्दी</option>
          </select>
          <p className="muted">
            Hindi navigation is available. Forms and policy text remain in
            English during development.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={prefs.quietEnabled}
              onChange={(e) =>
                setPrefs({ ...prefs, quietEnabled: e.target.checked })
              }
            />
            Quiet hours / शांत समय
          </label>
          <p>
            New incoming calls are unavailable during these hours in Indian
            Standard Time. Your schedule stays private. Messages remain
            available when you choose to read them.
          </p>
          <label htmlFor="start">Start hour (IST)</label>
          <input
            id="start"
            type="number"
            min={0}
            max={23}
            value={prefs.quietStart}
            onChange={(e) =>
              setPrefs({ ...prefs, quietStart: Number(e.target.value) })
            }
          />
          <label htmlFor="end">End hour (IST)</label>
          <input
            id="end"
            type="number"
            min={0}
            max={23}
            value={prefs.quietEnd}
            onChange={(e) =>
              setPrefs({ ...prefs, quietEnd: Number(e.target.value) })
            }
          />
          <p className="muted">
            The same start and end hour means quiet all day.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={prefs.readReceipts}
              onChange={(e) =>
                setPrefs({ ...prefs, readReceipts: e.target.checked })
              }
            />
            Share read receipts by default
          </label>
          <button disabled={busy}>
            {busy ? "Saving…" : "Save preferences"}
          </button>
        </form>
      ) : (
        <p>Loading preferences…</p>
      )}
      <p>
        You can pause your profile in{" "}
        <Link href="/settings">Account settings</Link> whenever you want a
        break.
      </p>
    </main>
  );
}
