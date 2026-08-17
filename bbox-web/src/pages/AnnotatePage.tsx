import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import * as api from "../api/client";
import type { Annotation, PendingFrame, Project } from "../api/types";
import { BBoxCanvas } from "../components/BBoxCanvas";

interface LocationState {
  batchId: string;
  frames: PendingFrame[];
}

export function AnnotatePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | undefined;

  const [project, setProject] = useState<Project | null>(null);
  const [frames, setFrames] = useState<PendingFrame[]>(state?.frames ?? []);
  const [index, setIndex] = useState(0);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<Annotation[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const batchId = state?.batchId;
  const currentFrame = frames[index];

  useEffect(() => {
    if (id) api.getProject(id).then(setProject);
  }, [id]);

  useEffect(() => {
    if (!id || !batchId || !currentFrame) {
      setObjectUrl(null);
      return;
    }
    let revoked = "";
    api.fetchPendingFrameBlob(id, batchId, currentFrame.frame_id).then((blob) => {
      const url = URL.createObjectURL(blob);
      revoked = url;
      setObjectUrl(url);
    });
    setBoxes([]);
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [id, batchId, currentFrame]);

  if (!id || !batchId || frames.length === 0) {
    return (
      <div className="page">
        <p>No pending frames. Upload a video from the project page first.</p>
        <Link to={`/projects/${id}`}>← Back to project</Link>
      </div>
    );
  }

  async function advance() {
    if (index + 1 < frames.length) {
      setIndex(index + 1);
    } else {
      navigate(`/projects/${id}`);
    }
  }

  async function onCommit() {
    if (!currentFrame || boxes.length === 0 || !id || !batchId) return;
    setBusy(true);
    setError(null);
    try {
      await api.commitFrame(id, batchId, currentFrame.frame_id, boxes);
      await advance();
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Failed to save annotations.");
    } finally {
      setBusy(false);
    }
  }

  async function onSkip() {
    if (!currentFrame || !id || !batchId) return;
    setBusy(true);
    setError(null);
    try {
      await api.skipFrame(id, batchId, currentFrame.frame_id);
      await advance();
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Failed to skip frame.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <Link to={`/projects/${id}`} className="muted">
          ← Project
        </Link>
        <h2>
          Annotate frame {index + 1} / {frames.length}
        </h2>
      </header>

      {project && objectUrl ? (
        <BBoxCanvas
          imageUrl={objectUrl}
          classes={project.classes}
          boxes={boxes}
          onBoxesChange={setBoxes}
        />
      ) : (
        <p>Loading frame…</p>
      )}

      {error && <p className="error">{error}</p>}

      <div className="annotate-actions">
        <button className="btn-secondary" onClick={onSkip} disabled={busy}>
          Skip frame
        </button>
        <button className="btn-primary" onClick={onCommit} disabled={busy || boxes.length === 0}>
          {index + 1 < frames.length ? "Save & next" : "Save & finish"}
        </button>
      </div>
    </div>
  );
}
