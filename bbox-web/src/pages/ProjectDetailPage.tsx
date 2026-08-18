import { useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronLeft, Loader2, Trash2, Zap } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as api from "../api/client";
import type { Project, Stats } from "../api/types";

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);

  const [project, setProject] = useState<Project | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [targetFps, setTargetFps] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!id) return;
    const [p, s] = await Promise.all([api.getProject(id), api.getStats(id)]);
    setProject(p);
    setStats(s);
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
