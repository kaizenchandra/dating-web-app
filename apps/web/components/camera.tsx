"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  api,
  submitPhoto,
  type ProfileResult,
} from "../../../packages/generated-clients/client";
export function Camera({
  onSaved,
}: {
  onSaved: (result: ProfileResult) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [capture, setCapture] = useState<{
    captureId: string;
    token: string;
  } | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(
    () => () => {
      generation.current++;
      stream.current?.getTracks().forEach((t) => t.stop());
      request.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    Promise.resolve().then(() => setPreview(url));
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  function stop() {
    generation.current++;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    request.current?.abort();
    setActive(false);
    setBusy(false);
    setBlob(null);
    setCapture(null);
    setPreview("");
  }
  async function start() {
    stop();
    const current = ++generation.current;
    setError("");
    setBusy(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Camera access needs HTTPS or localhost in a supported browser.",
        );
      request.current = new AbortController();
      const session = await api(
        "/profile/capture",
        "post",
        {},
        request.current.signal,
      );
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 1280 },
        },
        audio: false,
      });
      if (generation.current !== current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      setCapture(session);
      setActive(true);
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play();
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        setError(
          (e as Error).name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access in your browser, then retry."
            : (e as Error).message,
        );
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }
  function take() {
    const v = video.current;
    if (!v || !v.videoWidth) {
      setError("The camera is still warming up. Try again.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")!.drawImage(v, 0, 0);
    canvas.toBlob(
      (result) => {
        if (result) {
          setBlob(result);
          stream.current?.getTracks().forEach((t) => t.stop());
          setActive(false);
        } else setError("Could not capture the photo. Please retry.");
      },
      "image/jpeg",
      0.9,
    );
  }
  async function save() {
    if (!blob || !capture) return;
    setBusy(true);
    setError("");
    request.current = new AbortController();
    try {
      const result = await submitPhoto(blob, capture, request.current.signal);
      stop();
      onSaved(result);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="camera-panel">
      <h2>A photo from right now.</h2>
      <p className="muted">
        Use your camera in good light. Review before sending. Camera capture
        does not establish liveness or identity.
      </p>
      <video
        ref={video}
        autoPlay
        playsInline
        muted
        className={active ? "camera-video" : "camera-video hidden"}
        aria-label="Live camera preview"
      />
      {preview && (
        <Image
          unoptimized
          src={preview}
          alt="Your captured photo, ready for review"
          width={480}
          height={480}
          className="camera-video"
        />
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="camera-actions">
        {!active && !blob && (
          <button type="button" disabled={busy} onClick={start}>
            {busy ? "Opening camera…" : "Open camera"}
          </button>
        )}
        {active && (
          <button type="button" disabled={busy} onClick={take}>
            Capture photo
          </button>
        )}
        {blob && (
          <>
            <button type="button" disabled={busy} onClick={save}>
              {busy ? "Saving photo…" : "Use this photo"}
            </button>
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={start}
            >
              Retake
            </button>
          </>
        )}
        {(active || blob || busy) && (
          <button className="secondary" type="button" onClick={stop}>
            Cancel capture
          </button>
        )}
      </div>
      <p className="fine-print">
        A capture session lasts 2 minutes and can be used once. There is no
        gallery upload or social-photo import.
      </p>
    </section>
  );
}
