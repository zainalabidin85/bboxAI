import { useEffect, useRef, useState } from "react";
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

  if (!project || !stats) return <p>Loading…</p>;

  return (
    <div className="page">
      <header className="page-header">
        <Link to="/projects" className="muted">
          ← Projects
        </Link>
        <h2>{project.name}</h2>
        <button className="btn-secondary" onClick={onDelete}>
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

      <div className="stat-row">
        <div className="stat">
          <strong>{stats.total}</strong>
          <span>images</span>
        </div>
        <div className="stat">
          <strong>{stats.labeled}</strong>
          <span>labeled</span>
        </div>
        <div className="stat">
          <strong>{stats.total_boxes}</strong>
          <span>boxes</span>
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
        {uploading && <p>Extracting frames…</p>}
        {error && <p className="error">{error}</p>}
      </div>

      <button
        className="btn-primary"
        onClick={() => navigate(`/projects/${id}/train`)}
        disabled={stats.total_boxes < 10}
        title={stats.total_boxes < 10 ? "Need at least 10 labeled boxes." : ""}
      >
        Train model
      </button>
    </div>
  );
}
