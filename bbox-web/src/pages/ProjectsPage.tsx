import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as api from "../api/client";
import type { Project } from "../api/types";
import { useAuth } from "../contexts/AuthContext";

export function ProjectsPage() {
  const { displayName, logout } = useAuth();
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
        <div className="header-actions">
          <span className="muted">{displayName}</span>
          <button className="btn-secondary" onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      <button className="btn-primary" onClick={() => setShowCreate((v) => !v)}>
        {showCreate ? "Cancel" : "+ New project"}
      </button>

      {showCreate && (
        <form className="card" onSubmit={onCreate}>
          <label>
            Project name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
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
            Create
          </button>
        </form>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : projects.length === 0 ? (
        <p className="muted">No projects yet.</p>
      ) : (
        <div className="card-grid">
          {projects.map((p) => (
            <Link className="card project-card" to={`/projects/${p.id}`} key={p.id}>
              <div className="header-actions">
                <h3>{p.name}</h3>
                <button
                  className="btn-secondary"
                  onClick={(e) => onDelete(e, p.id, p.name)}
                  title="Delete project"
                >
                  Delete
                </button>
              </div>
              <p className="muted">{p.classes.length} class(es)</p>
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
