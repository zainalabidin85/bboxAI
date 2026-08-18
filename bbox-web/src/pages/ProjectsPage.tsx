import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { FolderOpen, Plus, Trash2, X } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import * as api from "../api/client";
import type { Project } from "../api/types";

export function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [classesText, setClassesText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setProjects(await api.getProjects());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onDelete(e: MouseEvent, id: string, name: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Delete project "${name}"? This permanently removes all its images, labels, and trained models.`)) {
      return;
    }
    await api.deleteProject(id);
    await load();
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const classes = classesText
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    if (!name.trim() || classes.length === 0) {
      setError("Name and at least one class are required.");
      return;
    }
    try {
      const project = await api.createProject(name.trim(), classes);
      setShowCreate(false);
      setName("");
      setClassesText("");
      navigate(`/projects/${project.id}`);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Failed to create project.");
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h2>Projects</h2>
        <button className="btn-primary" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? <X size={16} /> : <Plus size={16} />}
          {showCreate ? "Cancel" : "New project"}
        </button>
      </header>

      {showCreate && (
        <form className="card" onSubmit={onCreate}>
          <label>
            Project name
            <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </label>
          <label>
            Classes (comma-separated)
            <input
              value={classesText}
              onChange={(e) => setClassesText(e.target.value)}
              placeholder="cat, dog, bicycle"
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn-primary" type="submit">
            Create project
          </button>
        </form>
      )}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : projects.length === 0 ? (
        <div className="empty-state card">
          <FolderOpen />
          <h3>No projects yet</h3>
          <p className="muted">Create your first project to start annotating images.</p>
        </div>
      ) : (
        <div className="card-grid">
          {projects.map((p) => (
            <Link className="card project-card" to={`/projects/${p.id}`} key={p.id}>
              <div className="header-actions">
                <h3>{p.name}</h3>
                <button
                  className="btn-ghost"
                  onClick={(e) => onDelete(e, p.id, p.name)}
                  title="Delete project"
                  aria-label={`Delete project ${p.name}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <p className="muted">{p.classes.length} class{p.classes.length === 1 ? "" : "es"}</p>
              <div className="chip-row">
                {p.classes.slice(0, 5).map((c) => (
                  <span className="chip" key={c.id}>
                    {c.name}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
