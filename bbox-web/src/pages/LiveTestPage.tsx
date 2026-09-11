import { useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import * as api from "../api/client";
import { classColor } from "../components/BBoxCanvas";
import { detectFrame, loadSession } from "../utils/liveInference";
import type { Detection } from "../utils/liveInference";

// Full-screen camera view — the model, camera feed, and every detection
// this page draws stay entirely on the phone; no per-frame network call.
// See docs/superpowers/specs/2026-09-11-live-camera-test-design.md.
export function LiveTestPage() {
  const { id } = useParams<{ id: string }>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef<Awaited<ReturnType<typeof loadSession>>["session"] | null>(null);
  const classNamesRef = useRef<string[]>([]);
  const rafRef = useRef<number | null>(null);
  const [statusText, setStatusText] = useState("Requesting camera…");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let stream: MediaStream | null = null;
    let cancelled = false;

    function drawDetections(dets: Detection[]) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 3;
      ctx.font = "16px sans-serif";
      for (const d of dets) {
        const color = classColor(d.classId);
        const [x1, y1, x2, y2] = d.box;
        ctx.strokeStyle = color;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        const label = `${classNamesRef.current[d.classId] ?? d.classId} ${(d.score * 100).toFixed(0)}%`;
        const textWidth = ctx.measureText(label).width;
        ctx.fillStyle = color;
        ctx.fillRect(x1, Math.max(0, y1 - 20), textWidth + 8, 20);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, x1 + 4, Math.max(14, y1 - 5));
      }
    }

    async function loop() {
      const session = sessionRef.current;
      const video = videoRef.current;
      const offCanvas = offCanvasRef.current;
      if (cancelled || !session || !video || !offCanvas) return;
      const dets = await detectFrame(session, video, offCanvas);
      if (cancelled) return;
      drawDetections(dets);
      rafRef.current = requestAnimationFrame(loop);
    }

    async function start() {
      try {
        const project = await api.getProject(id!);
        classNamesRef.current = project.classes.map((c) => c.name);

        setStatusText("Requesting camera…");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) return;

        const video = videoRef.current!;
        video.srcObject = stream;
        await new Promise<void>((resolve) => {
          video.onloadedmetadata = () => resolve();
        });
        if (cancelled) return;

        const canvas = canvasRef.current!;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        offCanvasRef.current = document.createElement("canvas");

        setStatusText("Loading model…");
        const modelBytes = await api.fetchLiveTestModel(id!);
        if (cancelled) return;

        const { session } = await loadSession(modelBytes);
        if (cancelled) return;
        sessionRef.current = session;
        setStatusText("");

        loop();
      } catch (err: any) {
        if (!cancelled) {
          setError(
            err?.name === "NotAllowedError"
              ? "Camera permission was denied. Allow camera access and reload this page."
              : err?.message ?? "Failed to start the live test."
          );
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [id]);

  return (
    <div className="live-test-page">
      <Link to={`/projects/${id}/train`} className="live-test-back">
        <ChevronLeft size={16} />
        Back
      </Link>
      <video ref={videoRef} autoPlay playsInline muted className="live-test-video" />
      <canvas ref={canvasRef} className="live-test-canvas" />
      {statusText && <p className="live-test-status">{statusText}</p>}
      {error && (
        <p className="error live-test-error">
          <AlertCircle />
          {error}
        </p>
      )}
    </div>
  );
}
