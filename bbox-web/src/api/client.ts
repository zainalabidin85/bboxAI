import axios from "axios";
import type {
  AiAssistResult,
  Annotation,
  EpochMetric,
  ImageBox,
  PendingBatch,
  PendingFrame,
  Project,
  ProjectImage,
  ReportUnlockResult,
  ReportUnlockStatus,
  Stats,
  TestPredictionResult,
  TrainingStatus,
  VideoUploadResult,
  WalletInfo,
} from "./types";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const IS_REMOTE = import.meta.env.VITE_REMOTE === "true";
const TOKEN_KEY = "bboxai_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

const client = axios.create({ baseURL: BASE_URL });

client.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Auth ─────────────────────────────────────────────────────────────────────

export async function login(username: string, password: string) {
  if (IS_REMOTE) {
    const { data } = await axios.post(`${BASE_URL}/login`, { username, password });
    setToken(data.access_token);
    return data as { access_token: string; device_id: string; username: string };
  }
  const form = new URLSearchParams();
  form.set("username", username);
  form.set("password", password);
  const { data } = await axios.post(`${BASE_URL}/auth/login`, form, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  setToken(data.access_token);
  return data as { access_token: string; token_type: string; username: string };
}

export async function register(username: string, email: string, password: string) {
  const { data } = await axios.post(`${BASE_URL}/auth/register`, {
    username,
    email,
    password,
  });
  return data;
}

export function logout() {
  setToken(null);
}

// ── Projects ─────────────────────────────────────────────────────────────────

export async function getProjects(): Promise<Project[]> {
  const { data } = await client.get("/projects");
  return data;
}

export async function getProject(id: string): Promise<Project> {
  const { data } = await client.get(`/projects/${id}`);
  return data;
}

export async function createProject(name: string, classes: string[]): Promise<Project> {
  const { data } = await client.post("/projects", { name, classes });
  return data;
}

export async function deleteProject(id: string) {
  await client.delete(`/projects/${id}`);
}

export async function getStats(id: string): Promise<Stats> {
  const { data } = await client.get(`/projects/${id}/stats`);
  return data;
}

// ── Weights / training ───────────────────────────────────────────────────────

export async function getWeights(): Promise<{ filename: string }[]> {
  const { data } = await client.get("/weights");
  return data;
}

export async function startTraining(
  projectId: string,
  baseModel: string,
  epochs: number,
  imgsz: number
) {
  const { data } = await client.post(`/projects/${projectId}/train`, {
    base_model: baseModel,
    epochs,
    imgsz,
  });
  return data;
}

export async function cancelTraining(projectId: string) {
  const { data } = await client.post(`/projects/${projectId}/train/cancel`);
  return data;
}

export async function getTrainingStatus(projectId: string): Promise<TrainingStatus> {
  const { data } = await client.get(`/projects/${projectId}/train/status`);
  return data;
}

export async function getTrainingMetrics(projectId: string): Promise<EpochMetric[]> {
  const { data } = await client.get(`/projects/${projectId}/train/metrics`);
  return data;
}

async function downloadFile(url: string, suggestedName: string) {
  const { data } = await client.get(url, { responseType: "blob" });
  const objectUrl = URL.createObjectURL(data as Blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

// tier is optional and only meaningful on the local build talking directly
// to bbox-api — bbox-relay's report route (remote build) ignores any tier
// in the query string and decides for itself based on unlock status, so
// passing it there would be a no-op, not a bypass.
export function downloadReport(projectId: string, tier?: "free" | "paid") {
  const suffix = tier ? `?tier=${tier}` : "";
  const filename = tier === "free" ? `${projectId}_report_free.pdf` : `${projectId}_report.pdf`;
  return downloadFile(`/projects/${projectId}/report${suffix}`, filename);
}

// Detailed-report paywall — remote build only. The local build's
// downloadReport() above always gets the full report for free (bbox-api is
// payment-unaware); on the remote build the same URL is transparently
// tier-gated by bbox-relay based on unlock status, see main.py's
// GET /projects/{id}/report there.
export async function getReportUnlockStatus(projectId: string): Promise<ReportUnlockStatus> {
  const { data } = await client.get(`/projects/${projectId}/report/status`);
  return data;
}

export async function unlockReport(projectId: string): Promise<ReportUnlockResult> {
  const { data } = await client.post(`/projects/${projectId}/report/unlock`);
  return data;
}

export function downloadModel(projectId: string) {
  return downloadFile(`/projects/${projectId}/weights/download`, `${projectId}_best.pt`);
}

export async function testModel(projectId: string, file: File): Promise<TestPredictionResult> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await client.post(`/projects/${projectId}/test`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

// ── Video → frames ───────────────────────────────────────────────────────────

export async function uploadVideo(
  projectId: string,
  file: File,
  targetFps: number
): Promise<VideoUploadResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("target_fps", String(targetFps));
  const { data } = await client.post(`/projects/${projectId}/videos/upload`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function getPendingBatches(projectId: string): Promise<PendingBatch[]> {
  const { data } = await client.get(`/projects/${projectId}/videos`);
  return data;
}

export async function deleteBatch(projectId: string, batchId: string) {
  await client.delete(`/projects/${projectId}/videos/${batchId}`);
}

export function pendingFrameImageUrl(
  projectId: string,
  batchId: string,
  frameId: string
): string {
  return `${BASE_URL}/projects/${projectId}/videos/${batchId}/${frameId}/image`;
}

export async function fetchPendingFrameBlob(
  projectId: string,
  batchId: string,
  frameId: string
): Promise<Blob> {
  const { data } = await client.get(
    `/projects/${projectId}/videos/${batchId}/${frameId}/image`,
    { responseType: "blob" }
  );
  return data;
}

export async function commitFrame(
  projectId: string,
  batchId: string,
  frameId: string,
  annotations: Annotation[],
  tagger = "web",
  notes = ""
) {
  const { data } = await client.post(
    `/projects/${projectId}/videos/${batchId}/${frameId}/commit`,
    { annotations, tagger, notes }
  );
  return data;
}

export async function skipFrame(projectId: string, batchId: string, frameId: string) {
  const { data } = await client.post(
    `/projects/${projectId}/videos/${batchId}/${frameId}/skip`
  );
  return data;
}

// ── AI-assist + wallet (bboxai-remote only) ─────────────────────────────────

export async function listProjectImages(projectId: string): Promise<ProjectImage[]> {
  const { data } = await client.get(`/projects/${projectId}/images`);
  return data;
}

export async function fetchProjectImageBlob(projectId: string, imageId: string): Promise<Blob> {
  const { data } = await client.get(`/projects/${projectId}/images/${imageId}/file`, {
    responseType: "blob",
  });
  return data;
}

export async function requestAiAssist(
  classes: { class_id: number; name: string }[],
  examples: { image_b64: string; boxes: ImageBox[] }[],
  targetImageB64: string,
  currentBoxes?: Annotation[]
): Promise<AiAssistResult> {
  const { data } = await client.post("/ai-assist", {
    classes,
    examples,
    target_image_b64: targetImageB64,
    current_boxes: currentBoxes && currentBoxes.length > 0 ? currentBoxes : undefined,
  });
  return data;
}

export async function getWallet(): Promise<WalletInfo> {
  const { data } = await client.get("/wallet");
  return data;
}

// Validation-loop signal: how many AI-suggested boxes on a committed frame
// were kept as-is vs. edited vs. deleted. Fire-and-forget from the caller.
export async function submitAiAssistFeedback(
  projectId: string,
  counts: { suggested: number; accepted: number; edited: number; deleted: number }
) {
  await client.post("/ai-assist/feedback", { project_id: projectId, ...counts });
}

interface AiAssistBox {
  x: number;
  y: number;
  w: number;
  h: number;
  class_id: number;
}

// Correction loop: the actual before/after per box behind the aggregate
// counts above. `final` is omitted for a deleted box. `exampleImageIds` are
// the project image_ids used as few-shot examples for the batch this frame
// belongs to — lets the relay attribute outcomes back to specific examples
// (see example_ranking.py). Omit when unknown (e.g. no examples were sent).
export async function submitAiAssistCorrections(
  projectId: string,
  corrections: { outcome: "accepted" | "edited" | "deleted"; original: AiAssistBox; final?: AiAssistBox }[],
  exampleImageIds?: string[]
) {
  await client.post("/ai-assist/corrections", {
    project_id: projectId,
    corrections,
    example_image_ids: exampleImageIds,
  });
}

// Per-example-image quality scores (0-1, Bayesian-smoothed toward a neutral
// prior) derived from past AI-assist correction outcomes — used to prefer
// better-performing images as few-shot examples. Empty/missing entries mean
// "no data yet", not "bad" — callers should treat an unscored image as
// average, not worst.
export async function getAiAssistExampleRanking(
  projectId: string
): Promise<Record<string, { score: number; n: number }>> {
  const { data } = await client.get("/ai-assist/example-ranking", { params: { project_id: projectId } });
  return data.scores;
}

export async function initiateTopup(pkg: string, termsAccepted: boolean): Promise<{ checkout_url: string }> {
  const { data } = await client.post("/wallet/topup", { package: pkg, terms_accepted: termsAccepted });
  return data;
}

export type { PendingFrame };
