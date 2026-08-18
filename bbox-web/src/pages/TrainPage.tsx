import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as api from "../api/client";
import type { EpochMetric, Stats, TrainingStatus } from "../api/types";
import { MetricsChart } from "../components/MetricsChart";

const IMGSZ_OPTIONS = [320, 640, 1280];
const POLL_INTERVAL_MS = 8000;

export function TrainPage() {
  const { id } = useParams<{ id: string }>();
  const [weights, setWeights] = useState<string[]>([]);
  const [baseModel, setBaseModel] = useState<string>("");
  const [epochs, setEpochs] = useState(100);
  const [imgsz, setImgsz] = useState(640);
  const [stats, setStats] = useState<Stats | null>(null);
  const [status, setStatus] = useState<TrainingStatus | null>(null);
  const [metrics, setMetrics] = useState<EpochMetric[]>([]);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadStatic() {
    if (!id) return;
    const [w, s, st] = await Promise.all([
      api.getWeights(),
      api.getStats(id),
      api.getTrainingStatus(id),
    ]);
    const names = w.map((x) => x.filename);
    setWeights(names);
    setBaseModel((prev) => prev || names[0] || "");
    setStats(s);
    setStatus(st);
  }

  async function poll() {
    if (!id) return;
    const [st, m] = await Promise.all([api.getTrainingStatus(id), api.getTrainingMetrics(id)]);
    setStatus(st);
    setMetrics(m);
    manageTimer(st.state);
  }

  function manageTimer(state: string) {
    if (state === "running") {
      if (!timerRef.current) {
        timerRef.current = setInterval(poll, POLL_INTERVAL_MS);
      }
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  useEffect(() => {
    loadStatic().then(() => poll());
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onStart() {
    if (!id) return;
    setError(null);
    try {
      await api.startTraining(id, baseModel, epochs, imgsz);
      await poll();
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Failed to start training.");
    }
  }

  async function onCancel() {
    if (!id) return;
    if (!window.confirm("Stop training? Progress so far will be discarded — no model will be deployed.")) return;
    setError(null);
    try {
      await api.cancelTraining(id);
      await poll();
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Failed to cancel training.");
    }
  }

  const canTrain = (stats?.total_boxes ?? 0) >= 10 && status?.state !== "running";

  return (
    <div className="page">
      <header className="page-header">
        <Link to={`/projects/${id}`} className="muted">
          ← Project
        </Link>
        <h2>Train</h2>
      </header>

      {status?.state !== "running" && (
        <div className="card">
          <h3>Configuration</h3>
          <label>
            Base model
            <select value={baseModel} onChange={(e) => setBaseModel(e.target.value)}>
              {weights.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
          <label>
            Epochs: {epochs}
            <input
              type="range"
              min={50}
              max={300}
              step={10}
              value={epochs}
              onChange={(e) => setEpochs(Number(e.target.value))}
            />
          </label>
          <label>Image size</label>
          <div className="chip-row">
            {IMGSZ_OPTIONS.map((sz) => (
              <button
                key={sz}
                className={`chip chip-choice ${imgsz === sz ? "chip-selected" : ""}`}
                onClick={() => setImgsz(sz)}
                type="button"
              >
                {sz}
              </button>
            ))}
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn-primary" onClick={onStart} disabled={!canTrain || !baseModel}>
            Start training
          </button>
          {!canTrain && (
            <p className="muted">Need at least 10 labeled boxes (have {stats?.total_boxes ?? 0}).</p>
          )}
        </div>
      )}

      {status && status.state === "running" && (
        <div className="card">
          <h3>Training in progress…</h3>
          <progress value={status.epochs_done} max={status.total_epochs || 1} />
          <p>
            Epoch {status.epochs_done} / {status.total_epochs} — base model: {status.base_model}
          </p>
          {error && <p className="error">{error}</p>}
          <button className="btn-secondary" onClick={onCancel}>
            Stop training
          </button>
        </div>
      )}

      {status && (status.state === "done" || status.state === "failed" || status.state === "cancelled") && (
        <div className="card">
          <h3>
            {status.state === "done"
              ? "Training complete — model deployed!"
              : status.state === "cancelled"
              ? "Training cancelled"
              : "Training failed"}
          </h3>
          {status.error && <p className="error">{status.error}</p>}
          {status.state === "done" && status.map50 != null && (
            <div className="metric-chip-row">
              <MetricChip label="mAP50" value={status.map50} />
              <MetricChip label="mAP50-95" value={status.map50_95} />
              <MetricChip label="Precision" value={status.precision} />
              <MetricChip label="Recall" value={status.recall} />
            </div>
          )}
          {status.state === "done" && (
            <div className="header-actions">
              <button className="btn-secondary" onClick={() => id && api.downloadReport(id)}>
                Download report
              </button>
              <button className="btn-secondary" onClick={() => id && api.downloadModel(id)}>
                Download model
              </button>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h3>Live metrics</h3>
        <MetricsChart data={metrics} />
      </div>
    </div>
  );
}

function MetricChip({ label, value }: { label: string; value?: number }) {
  if (value == null) return null;
  return (
    <div className="metric-chip">
      <strong>{(value * 100).toFixed(1)}%</strong>
      <span>{label}</span>
    </div>
  );
}
