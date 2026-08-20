import { useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronLeft, Check, Flame, Loader2, SkipForward, Sparkles } from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import * as api from "../api/client";
import type { AiAssistResult, Annotation, ImageBox, PendingFrame, ProjectImage, Project } from "../api/types";
import { BBoxCanvas, classColor } from "../components/BBoxCanvas";
import { downscaleToBase64Jpeg, type DotOverlay } from "../utils/image";
import { useWallet } from "../contexts/WalletContext";

const IS_REMOTE = import.meta.env.VITE_REMOTE === "true";
const MAX_AI_ASSIST_EXAMPLES = 5;
// AI Assist stays disabled until the project has at least this many manually
// annotated images for it to learn style from.
const MIN_AI_ASSIST_EXAMPLES = 2;

interface LocationState {
  batchId: string;
  frames: PendingFrame[];
}

interface AiExample {
  image_b64: string;
  boxes: ImageBox[];
}

// Client-only tag carried on AI-suggested boxes so we can tell, at commit
// time, which final boxes trace back to a suggestion (see aiSnapshotRef).
type TaggedAnnotation = Annotation & { _aiId?: string };

const AI_MATCH_EPSILON = 0.001; // normalized-coordinate tolerance for "unedited"

// Staged status text shown while an AI-assist call is in flight — the real
// call is a single opaque request/response, so these don't reflect literal
// backend steps, just give the user something concrete to read during the
// few-second wait instead of a bare spinner.
const AI_PROGRESS_STAGES = [
  "Reading target image…",
  "Comparing with your annotated examples…",
  "Asking Claude for suggestions…",
  "Cross-checking against reference points…",
  "Nudging boxes into place…",
];

function summarizeAiResult(before: Annotation[] | undefined, after: Annotation[]): string {
  if (!before) return `Suggested ${after.length} box${after.length === 1 ? "" : "es"}.`;
  if (before.length === after.length) {
    let changed = 0;
    for (let i = 0; i < before.length; i++) {
      const b = before[i], a = after[i];
      const same =
        Math.abs(a.x - b.x) < AI_MATCH_EPSILON &&
        Math.abs(a.y - b.y) < AI_MATCH_EPSILON &&
        Math.abs(a.w - b.w) < AI_MATCH_EPSILON &&
        Math.abs(a.h - b.h) < AI_MATCH_EPSILON &&
        a.class_id === b.class_id;
      if (!same) changed++;
    }
    if (changed === 0) return "No change — suggestion already looked accurate.";
    return `Adjusted ${changed} box${changed === 1 ? "" : "es"}.`;
  }
  const delta = after.length - before.length;
  return delta > 0
    ? `Added ${delta} box${delta === 1 ? "" : "es"}.`
    : `Removed ${-delta} box${-delta === 1 ? "" : "es"}.`;
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
  const [boxes, setBoxes] = useState<TaggedAnnotation[]>([]);
  // AI-suggestion snapshot for the current frame: _aiId -> box as originally
  // suggested. Boxes state only holds what's still present, so deletions
  // (which just remove the box) need this separate record to detect.
  const aiSnapshotRef = useRef<Record<string, Annotation>>({});
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Consecutive frames whose AI suggestion was committed fully unedited.
  // Bumps on a clean accept, resets on any edit/delete; a frame with no AI
  // suggestion at all (fully manual) leaves it untouched either way — see
  // reportAiAssistValidation, which already computes accepted/edited/deleted
  // for the validation loop and just feeds the same numbers here. Not shown
  // as a persistent badge — pops transiently off the AI Assist button itself
  // (comboPop), same pattern as the token coin's floating +N/-N.
  const [aiCombo, setAiCombo] = useState(0);
  const [comboPop, setComboPop] = useState<{ value: number; key: number } | null>(null);
  const { setBalance } = useWallet();

  // Pre-existing annotated images in the project, fetched once — used both to
  // gate the AI Assist button (enough examples to learn from?) and as the
  // few-shot source when AI Assist runs.
  const [projectImages, setProjectImages] = useState<ProjectImage[] | null>(null);

  // Batch mode: once AI Assist is pressed, every subsequent frame in this
  // queue gets AI-suggested boxes automatically (still paused for review —
  // see aiAssistedFrameRef) until the batch ends or something goes wrong.
  const [aiBatchActive, setAiBatchActive] = useState(false);
  const [aiBatchExamples, setAiBatchExamples] = useState<AiExample[] | null>(null);
  const aiAssistedFrameRef = useRef<string | null>(null);
  // Which frame objectUrl actually belongs to. Needed because the frame-load
  // effect below and the batch-assist effect run in the same React commit —
  // a setObjectUrl(null) in one doesn't become visible to the other until the
  // *next* render, so without this a frame change lets the batch effect fire
  // against the previous (already-revoked) blob URL for one tick. Set only
  // once the real fetch for a frame resolves, so it's always in sync with
  // objectUrl by the time a re-render makes the pairing visible.
  const objectUrlFrameIdRef = useRef<string | null>(null);

  const batchId = state?.batchId;
  const currentFrame = frames[index];

  useEffect(() => {
    if (id) api.getProject(id).then(setProject);
  }, [id]);

  useEffect(() => {
    if (IS_REMOTE && id) api.listProjectImages(id).then(setProjectImages);
  }, [id]);

  useEffect(() => {
    if (!id || !batchId || !currentFrame) {
      setObjectUrl(null);
      objectUrlFrameIdRef.current = null;
      return;
    }
    let revoked = "";
    let cancelled = false;
    setObjectUrl(null);
    objectUrlFrameIdRef.current = null;
    api.fetchPendingFrameBlob(id, batchId, currentFrame.frame_id).then((blob) => {
      if (cancelled) return;
      const url = URL.createObjectURL(blob);
      revoked = url;
      objectUrlFrameIdRef.current = currentFrame.frame_id;
      setObjectUrl(url);
    });
    setBoxes([]);
    aiSnapshotRef.current = {};
    setAiStatus(null);
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [id, batchId, currentFrame]);

  // Cycle a status line through while an AI-assist call is in flight, so the
  // wait shows visible progress instead of a bare spinner (see AI_PROGRESS_STAGES).
  useEffect(() => {
    if (!aiBusy) return;
    let i = 0;
    setAiStatus(AI_PROGRESS_STAGES[0]);
    const timer = setInterval(() => {
      i = (i + 1) % AI_PROGRESS_STAGES.length;
      setAiStatus(AI_PROGRESS_STAGES[i]);
    }, 1400);
    return () => clearInterval(timer);
  }, [aiBusy]);

  // Batch-mode auto-assist: whenever a new frame's image becomes available
  // while a batch is active, AI-assist it automatically (once per frame).
  useEffect(() => {
    if (!aiBatchActive || !objectUrl || !aiBatchExamples || !project || !currentFrame) return;
    if (objectUrlFrameIdRef.current !== currentFrame.frame_id) return; // objectUrl is stale, real one still loading
    if (aiAssistedFrameRef.current === currentFrame.frame_id) return;
    aiAssistedFrameRef.current = currentFrame.frame_id;
    runAiAssist(aiBatchExamples);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiBatchActive, objectUrl, aiBatchExamples, currentFrame]);

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
      setAiBatchActive(false);
      navigate(`/projects/${id}`);
    }
  }

  function reportAiAssistValidation(finalBoxes: TaggedAnnotation[]) {
    const snapshot = aiSnapshotRef.current;
    const suggestedIds = Object.keys(snapshot);
    if (!IS_REMOTE || !id || suggestedIds.length === 0) return;

    const stillPresent = new Map(finalBoxes.filter((b) => b._aiId).map((b) => [b._aiId as string, b]));
    let accepted = 0;
    let edited = 0;
    let deleted = 0;
    for (const aiId of suggestedIds) {
      const original = snapshot[aiId];
      const current = stillPresent.get(aiId);
      if (!current) {
        deleted++;
        continue;
      }
      const unchanged =
        Math.abs(current.x - original.x) < AI_MATCH_EPSILON &&
        Math.abs(current.y - original.y) < AI_MATCH_EPSILON &&
        Math.abs(current.w - original.w) < AI_MATCH_EPSILON &&
        Math.abs(current.h - original.h) < AI_MATCH_EPSILON &&
        current.class_id === original.class_id;
      if (unchanged) accepted++;
      else edited++;
    }

    const nextCombo = edited === 0 && deleted === 0 ? aiCombo + 1 : 0;
    setAiCombo(nextCombo);
    if (nextCombo >= 2) {
      setComboPop({ value: nextCombo, key: Date.now() });
    }

    // Best-effort — a failed feedback post shouldn't affect the actual commit.
    api
      .submitAiAssistFeedback(id, { suggested: suggestedIds.length, accepted, edited, deleted })
      .catch(() => {});
  }

  async function onCommit() {
    if (!currentFrame || boxes.length === 0 || !id || !batchId) return;
    setBusy(true);
    setError(null);
    try {
      const payload = boxes.map(({ x, y, w, h, class_id }) => ({ x, y, w, h, class_id }));
      await api.commitFrame(id, batchId, currentFrame.frame_id, payload);
      reportAiAssistValidation(boxes);
      if (IS_REMOTE) api.listProjectImages(id).then(setProjectImages); // keep the AI Assist gate/examples fresh
      await advance();
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Failed to save annotations.");
    } finally {
      setBusy(false);
    }
  }

  // Builds numbered reference dots at each box's center, for the refine
  // ("Improve suggestion" or auto-correction) call — see drawDotsOverlay in
  // utils/image.ts and refine_with_dots in ai_assist.py. Dot N corresponds
  // to boxes[N-1], matching the 1-based "dot" index the relay expects back.
  function dotsForBoxes(boxes: Annotation[]): DotOverlay[] {
    return boxes.map((b, i) => ({
      x: b.x + b.w / 2,
      y: b.y + b.h / 2,
      label: String(i + 1),
      color: classColor(b.class_id),
    }));
  }

  async function requestBoxes(examples: AiExample[], classes: { class_id: number; name: string }[], currentBoxes?: Annotation[]) {
    const target_image_b64 = currentBoxes
      ? await downscaleToBase64Jpeg(objectUrl!, undefined, undefined, false, dotsForBoxes(currentBoxes))
      : await downscaleToBase64Jpeg(objectUrl!, undefined, undefined, true);
    return api.requestAiAssist(classes, examples, target_image_b64, currentBoxes);
  }

  // currentBoxes, when passed, means this is a refine call (the "Improve
  // suggestion" re-click path): a single call, nudging those boxes toward
  // the real objects via numbered dots rather than a grid (see
  // refine_with_dots in ai_assist.py — three earlier attempts at improving
  // absolute-coordinate reading all failed the same way on a dense tray of
  // near-identical wells, so refine no longer asks for absolute coordinates
  // at all).
  //
  // With no currentBoxes, this is a from-scratch suggestion: after it comes
  // back, we immediately (no extra click) send it through one more refine
  // call automatically, so what the user actually sees is already
  // corrected — costing 2x AI_ASSIST_COST_TOKENS for the one click. If that
  // second call fails for any reason, we fall back to the uncorrected
  // first-pass boxes rather than losing the whole suggestion.
  async function runAiAssist(examples: AiExample[], currentBoxes?: Annotation[]) {
    if (!id || !project || !objectUrl) return;
    setAiBusy(true);
    setError(null);
    try {
      const classes = project.classes.map((c) => ({ class_id: c.id, name: c.name }));

      if (currentBoxes) {
        const result = await requestBoxes(examples, classes, currentBoxes);
        applyAiResult(result, currentBoxes);
        return;
      }

      const initial = await requestBoxes(examples, classes);
      let final = initial;
      if (initial.boxes.length > 0) {
        setAiStatus("Cross-checking against reference points…");
        try {
          final = await requestBoxes(examples, classes, initial.boxes);
        } catch {
          // Correction pass failed (balance, transient API error, etc.) —
          // keep the uncorrected first-pass suggestion rather than losing it.
        }
      }
      applyAiResult(final, undefined);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "AI Assist failed.");
      setAiStatus(null);
      setAiBatchActive(false); // e.g. out of tokens — fall back to manual for the rest of the batch
    } finally {
      setAiBusy(false);
    }
  }

  function applyAiResult(result: AiAssistResult, before: Annotation[] | undefined) {
    const snapshot: Record<string, Annotation> = {};
    const tagged: TaggedAnnotation[] = result.boxes.map(({ x, y, w, h, class_id }) => {
      const _aiId = crypto.randomUUID();
      snapshot[_aiId] = { x, y, w, h, class_id };
      return { x, y, w, h, class_id, _aiId };
    });
    aiSnapshotRef.current = snapshot;
    setBoxes(tagged);
    setBalance(result.tokens_remaining); // nav badge reflects the spend immediately, no extra fetch
    setAiStatus(summarizeAiResult(before, result.boxes));
  }

  async function gatherExamples(): Promise<AiExample[] | null> {
    if (!id || !projectImages) return null;
    const withBoxes = projectImages.filter((img) => img.boxes.length > 0).slice(0, MAX_AI_ASSIST_EXAMPLES);
    if (withBoxes.length < MIN_AI_ASSIST_EXAMPLES) {
      setError(`Annotate at least ${MIN_AI_ASSIST_EXAMPLES} images manually first so AI Assist has examples to learn from.`);
      return null;
    }
    return Promise.all(
      withBoxes.map(async (img) => {
        const blob = await api.fetchProjectImageBlob(id, img.image_id);
        const image_b64 = await downscaleToBase64Jpeg(blob, undefined, undefined, true);
        return { image_b64, boxes: img.boxes };
      })
    );
  }

  // Same button drives two actions depending on frame state: with no boxes
  // yet, it starts (or restarts) the normal batch-suggest flow; with boxes
  // already on the frame — AI-suggested and/or hand-edited — it re-runs AI
  // Assist on just this frame, feeding those boxes back so Claude can refine
  // rather than guess again from a blank slate.
  async function onAiAssistClick() {
    if (!id || !objectUrl || !projectImages) return;
    setError(null);

    if (boxes.length > 0) {
      setAiBusy(true);
      try {
        const examples = aiBatchExamples ?? (await gatherExamples());
        if (!examples) return;
        if (!aiBatchExamples) setAiBatchExamples(examples);
        const currentBoxes = boxes.map(({ x, y, w, h, class_id }) => ({ x, y, w, h, class_id }));
        await runAiAssist(examples, currentBoxes);
      } finally {
        setAiBusy(false);
      }
      return;
    }

    setAiBusy(true);
    try {
      const examples = await gatherExamples();
      if (!examples) return;
      setAiBatchExamples(examples);
      setAiBatchActive(true);
      aiAssistedFrameRef.current = null; // let the batch-mode effect pick up the current frame
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

  const annotatedCount = projectImages?.filter((img) => img.boxes.length > 0).length ?? 0;
  // Not gated on aiBatchActive: once a frame has boxes, this same button
  // switches to "Improve suggestion" and re-clicking it should stay usable.
  const aiAssistDisabled =
    busy || aiBusy || !objectUrl || !projectImages || annotatedCount < MIN_AI_ASSIST_EXAMPLES;

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
          processing={IS_REMOTE && aiBusy}
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
          <button
            className="btn-secondary ai-assist-btn"
            onClick={onAiAssistClick}
            disabled={aiAssistDisabled}
            title={
              projectImages && annotatedCount < MIN_AI_ASSIST_EXAMPLES
                ? `Annotate at least ${MIN_AI_ASSIST_EXAMPLES} images manually first`
                : undefined
            }
          >
            {aiBusy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
            {boxes.length > 0 ? "Improve suggestion" : aiBatchActive ? "AI Assist (active)" : "AI Assist"}
            {comboPop && (
              <span key={comboPop.key} className="combo-float" onAnimationEnd={() => setComboPop(null)}>
                <Flame size={12} />
                {comboPop.value}x
              </span>
            )}
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

      {IS_REMOTE && aiStatus && (
        <p className="muted" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          {aiBusy ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
          {aiStatus}
        </p>
      )}
    </div>
  );
}
