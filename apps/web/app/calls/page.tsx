"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "../../components/account";
import {
  api,
  socketUrl,
  type Call,
} from "../../../../packages/generated-clients/client";
type Signal = {
  type: "call.signal";
  callId: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};
export default function Calls() {
  const { account } = useAccount();
  const [match, setMatch] = useState("");
  const [call, setCall] = useState<Call | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Ready when you both are");
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [camera, setCamera] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [turn, setTurn] = useState(false);
  const [feedback, setFeedback] = useState("");
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const peer = useRef<RTCPeerConnection | null>(null);
  const media = useRef<MediaStream | null>(null);
  const preview = useRef<MediaStream | null>(null);
  const remote = useRef<MediaStream | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const activeCall = useRef<Call | null>(null);
  const actor = useRef("");
  const ice = useRef<RTCIceServer[]>([]);
  const icePolicy = useRef<RTCIceTransportPolicy>("all");
  const configRefreshAt = useRef(0);
  const makingOffer = useRef(false);
  const ignoreOffer = useRef(false);
  const candidates = useRef<RTCIceCandidateInit[]>([]);
  const queued = useRef<Signal[]>([]);
  const chain = useRef(Promise.resolve());
  const alive = useRef(true);
  const stop = useCallback(() => {
    peer.current?.close();
    peer.current = null;
    media.current?.getTracks().forEach((t) => t.stop());
    preview.current?.getTracks().forEach((t) => t.stop());
    media.current = null;
    preview.current = null;
    remote.current = null;
    setCamera(false);
    setPreviewing(false);
    setMuted(false);
  }, []);
  function send(signal: Signal) {
    if (socket.current?.readyState === WebSocket.OPEN)
      socket.current.send(JSON.stringify(signal));
    else
      setError(
        "Signalling is reconnecting. Media may continue; retry if the connection fails.",
      );
  }
  const receive = useCallback(async (signal: Signal) => {
    const pc = peer.current;
    const current = activeCall.current;
    if (!pc || !current || signal.callId !== current.id) {
      queued.current.push(signal);
      return;
    }
    try {
      if (signal.description) {
        const collision =
          signal.description.type === "offer" &&
          (makingOffer.current || pc.signalingState !== "stable");
        const polite = current.calleeId === actor.current;
        ignoreOffer.current = !polite && collision;
        if (ignoreOffer.current) return;
        await pc.setRemoteDescription(signal.description);
        for (const candidate of candidates.current.splice(0))
          await pc.addIceCandidate(candidate);
        if (signal.description.type === "offer") {
          await pc.setLocalDescription();
          send({
            type: "call.signal",
            callId: current.id,
            description: pc.localDescription!,
          });
        }
      } else if (signal.candidate) {
        if (ignoreOffer.current) return;
        if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate);
        else candidates.current.push(signal.candidate);
      }
    } catch (e) {
      setError(
        "Media negotiation failed. End this call and try again. " +
          (e as Error).name,
      );
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stop();
      socket.current?.close();
    };
  }, [stop]);
  useEffect(() => {
    if (!account) return;
    actor.current = account.id;
    const id = new URLSearchParams(window.location.search).get("match") || "";
    Promise.resolve().then(() => setMatch(id));
    if (!id) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const [calls, config] = await Promise.all([
          api("/calls", "get", undefined, undefined, { conversationId: id }),
          Date.now() >= configRefreshAt.current
            ? api("/calls/config", "get", undefined, undefined, {
                conversationId: id,
              })
            : Promise.resolve(null),
        ]);
        if (stopped) return;
        if (config) {
          ice.current = config.iceServers as RTCIceServer[];
          icePolicy.current = config.iceTransportPolicy;
          configRefreshAt.current =
            Date.now() + Math.max(60, config.expiresIn - 120) * 1000;
          setTurn(config.turnConfigured);
          if (peer.current) {
            peer.current.setConfiguration({
              iceServers: ice.current,
              iceTransportPolicy: icePolicy.current,
            });
            peer.current.restartIce();
          }
        }
        setCall((previous) =>
          previous?.id === calls.calls[0]?.id &&
          previous?.status === calls.calls[0]?.status
            ? previous
            : calls.calls[0] || null,
        );
        if (calls.calls[0]?.status === "ended") setStatus("Call ended");
      } catch (e) {
        if (!stopped) {
          setError((e as Error).message);
          stop();
          setStatus("Call unavailable");
        }
      } finally {
        if (!stopped) timer = setTimeout(load, 1500);
      }
    }
    function connect() {
      if (stopped) return;
      ws = new WebSocket(socketUrl());
      socket.current = ws;
      ws.onopen = () => {
        ws!.send(JSON.stringify({ type: "subscribe", conversationId: id }));
        if (peer.current?.connectionState === "failed")
          peer.current.restartIce();
      };
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === "call.signal")
            chain.current = chain.current.then(() => receive(data));
        } catch {}
      };
      ws.onclose = (e) => {
        if (stopped) return;
        if (e.code === 1008) {
          stop();
          setStatus("Call access ended");
          setError("Your session or match access is no longer valid.");
          return;
        }
        retry = setTimeout(connect, 1500);
      };
    }
    void load();
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (retry) clearTimeout(retry);
      ws?.close();
      socket.current = null;
      stop();
    };
  }, [account, receive, stop]);
  useEffect(() => {
    activeCall.current = call;
    if (call?.status !== "accepted") {
      if (peer.current) stop();
      return;
    }
    if (peer.current) return;
    let cancelled = false;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        if (cancelled || !alive.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        media.current = stream;
        const pc = new RTCPeerConnection({
          iceServers: ice.current,
          iceTransportPolicy: icePolicy.current,
        });
        peer.current = pc;
        for (const track of stream.getTracks()) pc.addTrack(track, stream);
        pc.onicecandidate = (e) => {
          if (e.candidate)
            send({
              type: "call.signal",
              callId: call!.id,
              candidate: e.candidate.toJSON(),
            });
        };
        pc.ontrack = (e) => {
          if (!remote.current) remote.current = new MediaStream();
          if (!remote.current.getTracks().some((t) => t.id === e.track.id))
            remote.current.addTrack(e.track);
          if (remoteVideo.current) {
            remoteVideo.current.srcObject = remote.current;
            remoteVideo.current
              .play()
              .catch(() => setError("Tap Enable audio to hear the call."));
          }
        };
        pc.onnegotiationneeded = async () => {
          try {
            makingOffer.current = true;
            await pc.setLocalDescription();
            send({
              type: "call.signal",
              callId: call!.id,
              description: pc.localDescription!,
            });
          } catch {
            setError("Connection negotiation failed. Try reconnecting.");
          } finally {
            makingOffer.current = false;
          }
        };
        pc.onconnectionstatechange = () => {
          setStatus(
            pc.connectionState === "connected"
              ? "Media connected"
              : pc.connectionState === "connecting"
                ? "Connecting media…"
                : pc.connectionState,
          );
          if (pc.connectionState === "failed") pc.restartIce();
        };
        setStatus("Connecting media…");
        for (const signal of queued.current.splice(0)) await receive(signal);
      } catch (e) {
        setError(
          "Microphone access is required for audio-first calling. " +
            (e as Error).name,
        );
        setStatus("Microphone unavailable");
      }
    }
    void start();
    return () => {
      cancelled = true;
    };
  }, [call, receive, stop]);
  async function act(action: "request" | "accept" | "decline" | "end") {
    setBusy(true);
    setError("");
    try {
      if (action === "request") {
        // Permission is requested on a user gesture, before inviting anyone.
        const permission = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        permission.getTracks().forEach((t) => t.stop());
        setCall(await api("/calls", "post", { conversationId: match }));
      } else if (call) {
        if (action === "accept") {
          const permission = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
          permission.getTracks().forEach((t) => t.stop());
        }
        setCall(
          await api("/calls/action", "post", { callId: call.id, action }),
        );
        if (action === "end" || action === "decline") {
          stop();
          setStatus("Call ended");
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function cameraPreview() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      preview.current = stream;
      if (localVideo.current) localVideo.current.srcObject = stream;
      setPreviewing(true);
    } catch (e) {
      setError("Camera unavailable: " + (e as Error).name);
    }
  }
  function enableCamera() {
    if (!peer.current || !media.current || !preview.current) return;
    for (const track of preview.current.getVideoTracks()) {
      media.current.addTrack(track);
      peer.current.addTrack(track, media.current);
    }
    setCamera(true);
    setPreviewing(false);
  }
  function stopCamera() {
    for (const sender of peer.current?.getSenders() || [])
      if (sender.track?.kind === "video") {
        sender.track.stop();
        peer.current?.removeTrack(sender);
      }
    media.current?.getVideoTracks().forEach((t) => {
      t.stop();
      media.current?.removeTrack(t);
    });
    preview.current?.getTracks().forEach((t) => t.stop());
    setCamera(false);
    setPreviewing(false);
  }
  const active = call?.status === "accepted";
  const ringing = call?.status === "ringing";
  return (
    <main className="call-page">
      <header>
        <Link
          href={match ? `/inbox?match=${match}` : "/inbox"}
          className="text-link"
        >
          ← Back to your conversation
        </Link>
        <span className="brand">
          raahi<span>✳</span>
        </span>
      </header>
      <p className="eyebrow section-label">YOUR VOICE. YOUR CHOICE.</p>
      <h1>
        A little closer.
        <br />
        <em>Only when you’re ready.</em>
      </h1>
      <p className="local-notice">
        {turn
          ? "TURN is configured; connectivity still depends on your network."
          : "Local network calling: no TURN server is configured. Cross-network connectivity is not verified."}{" "}
        External recording cannot be prevented.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p>
        Calls begin with audio after both people agree. To use video, select
        Preview camera, then Share camera. Your camera stays private until you
        choose to share it.
      </p>
      <section className="call-stage">
        <video
          className="remote-video"
          ref={remoteVideo}
          autoPlay
          playsInline
          aria-label="Remote call media"
        />
        <video
          className={`local-video ${previewing || camera ? "" : "hidden"}`}
          ref={localVideo}
          autoPlay
          playsInline
          muted
          aria-label="Camera preview"
        />
        <div className="call-state">
          <span aria-hidden="true">✳</span>
          <p role="status">
            {ringing
              ? call.callerId === account?.id
                ? "Waiting for their consent…"
                : "You have an audio call invitation"
              : active
                ? status
                : status}
          </p>
        </div>
      </section>
      <div className="call-controls">
        {!active && !ringing && (
          <button disabled={busy || !match} onClick={() => act("request")}>
            Invite to audio call
          </button>
        )}
        {ringing && call.calleeId === account?.id && (
          <>
            <button disabled={busy} onClick={() => act("accept")}>
              Accept audio call
            </button>
            <button
              disabled={busy}
              className="secondary"
              onClick={() => act("decline")}
            >
              Decline
            </button>
          </>
        )}
        {(active || ringing) && (
          <button disabled={busy} onClick={() => act("end")}>
            End call
          </button>
        )}
        {active && (
          <>
            <button
              className="secondary"
              onClick={() => {
                media.current
                  ?.getAudioTracks()
                  .forEach((t) => (t.enabled = muted));
                setMuted(!muted);
              }}
            >
              {muted ? "Unmute" : "Mute"}
            </button>
            <button
              className="secondary"
              onClick={() =>
                remoteVideo.current
                  ?.play()
                  .then(() => setError(""))
                  .catch(() => setError("Audio playback is unavailable."))
              }
            >
              Enable audio
            </button>
            {!camera && !previewing && (
              <button className="secondary" onClick={cameraPreview}>
                Preview camera
              </button>
            )}
            {previewing && (
              <>
                <button onClick={enableCamera}>Share camera</button>
                <button className="secondary" onClick={stopCamera}>
                  Cancel camera
                </button>
              </>
            )}
            {camera && (
              <button className="secondary" onClick={stopCamera}>
                Camera off
              </button>
            )}
            <button
              className="secondary"
              onClick={() => peer.current?.restartIce()}
            >
              Reconnect media
            </button>
          </>
        )}
      </div>
      {call && (
        <p>
          <Link href={`/safety?kind=call&subject=${call.id}`}>
            Report this call
          </Link>
        </p>
      )}
      {call && ["ended", "declined"].includes(call.status) && (
        <form
          className="status-card form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              await api("/calls/feedback", "post", {
                callId: call.id,
                experience: String(f.get("experience")) as
                  "comfortable" | "technical_issue" | "unsafe",
                note: String(f.get("note")),
              });
              setFeedback("Your private feedback is saved.");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <h2>How did that feel?</h2>
          <label htmlFor="experience">Your experience</label>
          <select id="experience" name="experience">
            <option value="comfortable">Comfortable</option>
            <option value="technical_issue">Technical issue</option>
            <option value="unsafe">I felt unsafe</option>
          </select>
          <label htmlFor="feedback">Optional note</label>
          <textarea id="feedback" name="note" maxLength={1000} />
          <button>Save private feedback</button>
          {feedback && <p role="status">{feedback}</p>}
        </form>
      )}
    </main>
  );
}
