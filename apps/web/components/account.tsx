"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api,
  ClientError,
  type Account,
} from "../../../packages/generated-clients/client";
export function useAccount() {
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const router = useRouter();
  useEffect(() => {
    const controller = new AbortController();
    api("/account", "get", undefined, controller.signal)
      .then(setAccount)
      .catch((e) => {
        if (e.name === "AbortError") return;
        if (e instanceof ClientError && e.status === 401)
          router.replace("/login");
        else setError(e.message);
      });
    return () => controller.abort();
  }, [attempt, router]);
  return {
    account,
    setAccount,
    error,
    retry: () => {
      setError("");
      setAttempt((a) => a + 1);
    },
  };
}
