import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, TestTube2, Upload } from "lucide-react";
import * as api from "../api/client";
import type { TestPredictionResult } from "../api/types";
import { classColor } from "./BBoxCanvas";

const MAX_WIDTH = 800;

interface Props {
  projectId: string;
}

// Lets a user sanity-check the deployed model on any image, without leaving
// bboxAI — upload a photo, see the model's own predicted boxes (with
// confidence) drawn read-only on a canvas. Nothing here is saved or added to
// the dataset; it's purely a "does this model actually work" check.
export function TestModelCard({ projectId }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<TestPredictionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewUrl, result]);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas || !previewUrl) return;

    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const width = Math.min(MAX_WIDTH, img.naturalWidth);
      const height = width * (img.naturalHeight / img.naturalWidth);
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      for (const b of result?.boxes ?? []) {
        const color = classColor(b.class_id);
        const x = b.x * width;
        const y = b.y * height;
        const w = b.w * width;
        const h = b.h * height;

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);

        const label = `${b.class_name} ${(b.confidence * 100).toFixed(0)}%`;
        ctx.font = "12px sans-serif";
        const textWidth = ctx.measureText(label).width;
        ctx.fillStyle = color;
        ctx.fillRect(x, Math.max(0, y - 16), textWidth + 8, 16);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, x + 4, Math.max(12, y - 4));
      }
    };
    img.src = previewUrl;
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    setResult(null);
    setError(null);
    setFile(picked);
  }

  async function onRunTest() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.testModel(projectId, file);
      setResult(res);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Failed to test the model.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>
        <TestTube2 size={18} />
        Test the model
      </h3>
      <p className="muted">Try the deployed model on any image — not saved, not added to the dataset.</p>

      <div className="header-actions">
        <label className="btn-secondary" style={{ cursor: "pointer" }}>
          <Upload size={16} />
          Choose image
          <input type="file" accept="image/*" onChange={onFileChange} style={{ display: "none" }} />
        </label>
        <button className="btn-primary" onClick={onRunTest} disabled={!file || busy}>
          {busy ? <Loader2 size={16} className="spin" /> : <TestTube2 size={16} />}
          {busy ? "Running…" : "Run test"}
        </button>
      </div>

      {error && (
        <p className="error">
          <AlertCircle />
          {error}
        </p>
      )}

      {previewUrl && (
        <div style={{ marginTop: 12 }}>
          <canvas ref={canvasRef} style={{ maxWidth: "100%", borderRadius: 8 }} />
          {result && (
            <p className="muted">
              {result.boxes.length === 0
                ? "No objects detected."
                : `Detected ${result.boxes.length} object${result.boxes.length === 1 ? "" : "s"}.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
