import { useEffect, useState } from "react";
import { AlertCircle, ChevronLeft, Check, Loader2, SkipForward, Sparkles } from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import * as api from "../api/client";
import type { Annotation, PendingFrame, Project } from "../api/types";
import { BBoxCanvas } from "../components/BBoxCanvas";
import { downscaleToBase64Jpeg } from "../utils/image";

const IS_REMOTE = import.meta.env.VITE_REMOTE === "true";
const MAX_AI_ASSIST_EXAMPLES = 5;

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
  const [aiBusy, setAiBusy] = useState(false);
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
        <div className="empty-state card">
          <AlertCircle />
          <p className="muted">No pending frames. Upload a video from the project page first.</p>
          <Link to={`/projects/${id}`} className="back-link">
            <ChevronLeft size={16} />
            Back to project
          </Link>
        </div>
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

  async function onAiAssist() {
    if (!id || !project || !objectUrl) return;
    setAiBusy(true);
    setError(null);
    try {
      const images = await api.listProjectImages(id);
      const withBoxes = images.filter((img) => img.boxes.length > 0).slice(0, MAX_AI_ASSIST_EXAMPLES);
      if (withBoxes.length === 0) {
        setError("Annotate a few images manually first so AI Assist has examples to learn from.");
        return;
      }

      const examples = await Promise.all(
        withBoxes.map(async (img) => {
          const blob = await api.fetchProjectImageBlob(id, img.image_id);
          const image_b64 = await downscaleToBase64Jpeg(blob);
          return { image_b64, boxes: img.boxes };
        })
      );
      const target_image_b64 = await downscaleToBase64Jpeg(objectUrl);
      const classes = project.classes.map((c) => ({ class_id: c.id, name: c.name }));

      const result = await api.requestAiAssist(classes, examples, target_image_b64);
      setBoxes(result.boxes.map(({ x, y, w, h, class_id }) => ({ x, y, w, h, class_id })));
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "AI Assist failed.");
    } finally {
      setAiBusy(false);
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
      <Link to={`/projects/${id}`} className="back-link">
        <ChevronLeft size={16} />
        Project
      </Link>

      <header className="page-header">
        <h2>
          Annotate frame <span className="mono">{index + 1} / {frames.length}</span>
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
        <p className="muted" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Loader2 size={14} className="spin" />
          Loading frame…
        </p>
      )}

      {error && (
        <p className="error">
          <AlertCircle />
          {error}
        </p>
      )}

      <div className="annotate-actions">
        {IS_REMOTE && (
          <button className="btn-secondary" onClick={onAiAssist} disabled={busy || aiBusy || !objectUrl}>
            {aiBusy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
            AI Assist
          </button>
        )}
        <button className="btn-secondary" onClick={onSkip} disabled={busy}>
          <SkipForward size={16} />
          Skip frame
        </button>
        <button className="btn-primary" onClick={onCommit} disabled={busy || boxes.length === 0}>
          <Check size={16} />
          {index + 1 < frames.length ? "Save & next" : "Save & finish"}
        </button>
      </div>
    </div>
  );
}
