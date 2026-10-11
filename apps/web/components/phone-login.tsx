"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../packages/generated-clients/client";
export function PhoneLogin({ local }: { local: boolean }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<{
    challengeId: string;
    localCode?: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const router = useRouter();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    controller.current = new AbortController();
    try {
      if (!challenge) {
        const result = await api(
          "/auth/otp/request",
          "post",
          { phone: "+91" + phone },
          controller.current.signal,
        );
        setChallenge(result);
      } else {
        const verified = await api(
          "/auth/otp/verify",
          "post",
          { challengeId: challenge.challengeId, code },
          controller.current.signal,
        );
        router.replace(
          verified.onboarding === "appeal" ? "/safety" : "/onboarding",
        );
        router.refresh();
      }
    } catch (e) {
      if (e instanceof Error && e.name !== "AbortError") setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function cancel() {
    controller.current?.abort();
    setBusy(false);
    setChallenge(null);
    setCode("");
    setError("");
  }
  return (
    <form onSubmit={submit} className="form-stack">
      <label htmlFor="phone">Indian mobile number</label>
      <div className="phone-input">
        <span>+91</span>
        <input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel-national"
          inputMode="numeric"
          pattern="[6-9][0-9]{9}"
          maxLength={10}
          required
          value={phone}
          disabled={!!challenge || busy}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
          placeholder="Your 10-digit number"
        />
      </div>
      {challenge && (
        <>
          <label htmlFor="code">Six-digit code</label>
          <input
            autoFocus
            id="code"
            name="code"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
          <p className="muted">
            Expires in 5 minutes. Up to 5 attempts. You can request a new code
            after 60 seconds.
          </p>
          {challenge.localCode && (
            <aside className="local-notice">
              Local test delivery — no SMS was sent.
              <br />
              Test code:{" "}
              <strong data-testid="local-code">{challenge.localCode}</strong>
            </aside>
          )}
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button disabled={busy} type="submit">
        {busy
          ? "Please wait…"
          : challenge
            ? "Verify & continue"
            : local
              ? "Send local test code"
              : "Send verification code"}{" "}
        <span aria-hidden="true">→</span>
      </button>
      {(challenge || busy) && (
        <button className="secondary" type="button" onClick={cancel}>
          {busy ? "Cancel request" : "Change number / request new code"}
        </button>
      )}
    </form>
  );
}
