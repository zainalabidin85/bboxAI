import { useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronLeft, Film, Loader2, Trash2, Zap } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as api from "../api/client";
import type { PendingBatch, Project, Stats } from "../api/types";

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);

  const [project, setProject] = useState<Project | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [batches, setBatches] = useState<PendingBatch[]>([]);
  const [targetFps, setTargetFps] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!id) return;
    const [p, s, b] = await Promise.all([
      api.getProject(id),
      api.getStats(id),
      api.getPendingBatches(id),
    ]);
    setProject(p);
    setStats(s);
    setBatches(b);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onVideoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    setUploading(true);
    setError(null);
    try {
      const result = await api.uploadVideo(id, file, targetFps);
      navigate(`/projects/${id}/annotate`, { state: { batchId: result.batch_id, frames: result.frames } });
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Video upload failed.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function onResume(batch: PendingBatch) {
    if (!id) return;
    navigate(`/projects/${id}/annotate`, {
      state: { batchId: batch.batch_id, frames: batch.frames },
    });
  }

  async function onDiscardBatch(batchId: string) {
    if (!id) return;
    if (!window.confirm("Discard these unannotated frames? This can't be undone.")) return;
    await api.deleteBatch(id, batchId);
    setBatches((prev) => prev.filter((b) => b.batch_id !== batchId));
  }

  async function onDelete() {
    if (!id || !project) return;
    if (!window.confirm(`Delete project "${project.name}"? This permanently removes all its images, labels, and trained models.`)) {
      return;
    }
    await api.deleteProject(id);
    navigate("/projects");
  }

  if (!project || !stats) return <p className="muted">Loading…</p>;

  const canTrain = stats.total_boxes >= 10;

  return (
    <div className="page">
      <Link to="/projects" className="back-link">
        <ChevronLeft size={16} />
        Projects
      </Link>

      <header className="page-header">
        <h2>{project.name}</h2>
        <button className="btn-danger" onClick={onDelete}>
          <Trash2 size={16} />
          Delete project
        </button>
      </header>

      <div className="chip-row">
        {project.classes.map((c) => (
          <span className="chip" key={c.id}>
            {c.name}
          </span>
        ))}
      </div>

      <div className="stat-row" style={{ marginTop: "var(--space-4)" }}>
        <div className="stat">
          <strong>{stats.total}</strong>
          <span>Images</span>
        </div>
        <div className="stat">
          <strong>{stats.labeled}</strong>
          <span>Labeled</span>
        </div>
        <div className="stat">
          <strong>{stats.total_boxes}</strong>
          <span>Boxes</span>
        </div>
      </div>

      {batches.length > 0 && (
        <div className="card">
          <h3>Resume annotating</h3>
          <p className="muted">
            Unfinished video batches — pick up where you (or another session) left off.
          </p>
          {batches.map((b) => (
            <div className="header-actions" key={b.batch_id}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                <Film size={16} />
                <span className="mono">{b.batch_id}</span>
                <span className="muted">
                  — {b.frame_count} frame{b.frame_count === 1 ? "" : "s"} left
                </span>
              </span>
              <button className="btn-secondary" onClick={() => onResume(b)}>
                Continue
              </button>
              <button
                className="btn-ghost"
                onClick={() => onDiscardBatch(b.batch_id)}
                title="Discard batch"
                aria-label={`Discard batch ${b.batch_id}`}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h3>Upload video</h3>
        <p className="muted">The video is split into frames for you to annotate.</p>
        <label>
          Frames per second to extract
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={targetFps}
            onChange={(e) => setTargetFps(Number(e.target.value))}
          />
        </label>
        <input
          ref={fileInput}
          type="file"
          accept="video/*"
          onChange={onVideoSelected}
          disabled={uploading}
        />
        {uploading && (
          <p className="muted" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Loader2 size={14} className="spin" />
            Extracting frames…
          </p>
        )}
        {error && (
          <p className="error">
            <AlertCircle />
            {error}
          </p>
        )}
      </div>

      <button
        className="btn-primary"
        onClick={() => navigate(`/projects/${id}/train`)}
        disabled={!canTrain}
      >
        <Zap size={16} />
        Train model
      </button>
      {!canTrain && (
        <p className="muted">Need at least 10 labeled boxes to train (have {stats.total_boxes}).</p>
      )}
    </div>
  );
}
