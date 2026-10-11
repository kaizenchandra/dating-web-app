"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  api,
  messageImageUrl,
} from "../../../packages/generated-clients/client";
export function ChatImage({ id }: { id: string }) {
  const [failed, setFailed] = useState(false),
    [attempt, setAttempt] = useState(0);
  return (
    <div className="chat-image">
      {failed ? (
        <>
          <p>Image unavailable.</p>
          <button
            className="secondary"
            onClick={() => {
              setFailed(false);
              setAttempt((x) => x + 1);
            }}
          >
            Retry image
          </button>
        </>
      ) : (
        <Image
          unoptimized
          width={1600}
          height={1600}
          src={messageImageUrl(id) + "&retry=" + attempt}
          alt="Shared image"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
export function ImageComposer({
  conversationId,
  disabled,
  onSend,
}: {
  conversationId: string;
  disabled: boolean;
  onSend: (imageId: string, caption: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(""),
    [caption, setCaption] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const imageId = useRef(""),
    controller = useRef<AbortController | null>(null),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || disabled || busy) return;
    setBusy(true);
    setError("");
    const c = new AbortController();
    controller.current = c;
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () =>
          reject(Error("Could not read this image. Choose it again."));
        reader.readAsDataURL(file);
      });
      if (c.signal.aborted) return;
      const uploaded = await api(
        "/messages/image",
        "post",
        { conversationId, clientImageId: imageId.current, data },
        c.signal,
      );
      if (c.signal.aborted) return;
      onSend(uploaded.id, caption.trim());
      setFile(null);
      setPreview("");
      setCaption("");
      if (input.current) input.current.value = "";
    } catch (e) {
      setError(
        (e as Error).name === "AbortError"
          ? "Upload cancelled. You can retry or remove the image."
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="image-composer">
      <summary>Send an image</summary>
      <form onSubmit={submit} className="form-stack">
        <p className="fine-print">
          JPEG, PNG or WebP · up to 5 MB. Review before sending. Unsent uploads
          expire after 24 hours. Image retries are saved only after upload when
          browser retries are enabled.
        </p>
        <label htmlFor="chat-image-file">Choose image</label>
        <input
          ref={input}
          id="chat-image-file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled || busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            setError("");
            setFile(null);
            setPreview("");
            if (!f) return;
            if (
              f.size > 5 * 1024 * 1024 ||
              !["image/jpeg", "image/png", "image/webp"].includes(f.type)
            ) {
              setError("Choose a JPEG, PNG or WebP smaller than 5 MB.");
              return;
            }
            imageId.current = crypto.randomUUID();
            setPreview(URL.createObjectURL(f));
            setFile(f);
          }}
        />
        {file && (
          <>
            <Image
              unoptimized
              src={
                preview ||
                "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="
              }
              width={240}
              height={240}
              alt="Image ready to send"
              className="image-draft"
            />
            <label htmlFor="image-caption">Image caption (optional)</label>
            <textarea
              id="image-caption"
              maxLength={2000}
              value={caption}
              disabled={busy || disabled}
              onChange={(e) => setCaption(e.target.value)}
            />
            <div className="camera-actions">
              <button disabled={busy || disabled}>
                {busy ? "Uploading image…" : "Send image"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  if (busy) {
                    controller.current?.abort();
                    return;
                  }
                  setFile(null);
                  setPreview("");
                  if (input.current) input.current.value = "";
                }}
              >
                {busy ? "Cancel upload" : "Remove image"}
              </button>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </form>
    </details>
  );
}
