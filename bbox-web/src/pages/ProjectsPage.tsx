import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { ChevronRight, Folder, FolderOpen, Loader2, Plus, Trash2, X } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import * as api from "../api/client";
import type { Project } from "../api/types";

const IS_REMOTE = import.meta.env.VITE_REMOTE === "true";

// iOS Settings/Reminders-style per-row icon tinting — each project gets a
// distinct color from the system palette (hashed off its id) instead of
// every row reusing the same flat accent blue.
const TILE_GRADIENTS = [
  "linear-gradient(135deg, #ff453a, #ff2d55)",
  "linear-gradient(135deg, #ff9f0a, #ff6300)",
  "linear-gradient(135deg, #ffd60a, #ff9f0a)",
  "linear-gradient(135deg, #30d158, #00c7be)",
  "linear-gradient(135deg, #bf5af2, #ff375f)",
  "linear-gradient(135deg, #af52de, #ff2d55)",
  "linear-gradient(135deg, #ff375f, #ff9f0a)",
  "linear-gradient(135deg, #d158e0, #af52de)",
  "linear-gradient(135deg, #ff6300, #ffd60a)",
];

function tileGradient(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return TILE_GRADIENTS[hash % TILE_GRADIENTS.length];
}

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
        <div className="page-spinner">
          <Loader2 className="spin" />
          <span>Loading projects…</span>
        </div>
      ) : projects.length === 0 ? (
        <div className="empty-state card">
          <FolderOpen />
          <h3>No projects yet</h3>
          <p className="muted">Create your first project to start annotating images.</p>
        </div>
      ) : IS_REMOTE ? (
        <div className="ios-list">
          {projects.map((p) => (
            <Link className="ios-list-row" to={`/projects/${p.id}`} key={p.id}>
              <span className="ios-list-row-icon" style={{ background: tileGradient(p.id) }}>
                <Folder size={16} strokeWidth={2.25} />
              </span>
              <span className="ios-list-row-body">
                <span className="ios-list-row-title">{p.name}</span>
                <span className="ios-list-row-subtitle">
                  {p.classes.length} class{p.classes.length === 1 ? "" : "es"}
                  {p.classes.length > 0 && " · " + p.classes.slice(0, 4).map((c) => c.name).join(", ")}
                </span>
              </span>
              <button
                className="ios-list-row-delete"
                onClick={(e) => onDelete(e, p.id, p.name)}
                title="Delete project"
                aria-label={`Delete project ${p.name}`}
              >
                <Trash2 size={15} />
              </button>
              <ChevronRight size={16} className="ios-list-row-chevron" />
            </Link>
          ))}
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
