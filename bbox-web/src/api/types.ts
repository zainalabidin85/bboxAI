export interface BboxClass {
  id: number;
  name: string;
}

export interface Project {
  id: string;
  name: string;
  owner_id: number;
  is_public: boolean;
  created_at: string;
  classes: BboxClass[];
}

export interface Stats {
  total: number;
  labeled: number;
  total_boxes: number;
  per_class: { id: number; name: string; count: number }[];
}

export interface TrainingStatus {
  state: "idle" | "running" | "done" | "failed" | "cancelled";
  started_at: string | null;
  finished_at: string | null;
  total_images: number;
  total_boxes: number;
  epochs_done: number;
  total_epochs: number;
  base_model: string | null;
  imgsz?: number;
  model_deployed: boolean;
  map50?: number;
  map50_95?: number;
  precision?: number;
  recall?: number;
  error: string | null;
}

export interface EpochMetric {
  epoch: number;
  box_loss: number | null;
  cls_loss: number | null;
  dfl_loss: number | null;
  precision: number | null;
  recall: number | null;
  map50: number | null;
  map50_95: number | null;
}

export interface PendingFrame {
  frame_id: string;
  index: number;
}

export interface PendingBatch {
  batch_id: string;
  frame_count: number;
  frames: PendingFrame[];
}

export interface VideoUploadResult {
  batch_id: string;
  frame_count: number;
  frames: PendingFrame[];
}

export interface Annotation {
  x: number;
  y: number;
  w: number;
  h: number;
  class_id: number;
}

export interface TestPredictionBox extends Annotation {
  class_name: string;
  confidence: number;
}

export interface TestPredictionResult {
  boxes: TestPredictionBox[];
  image_width: number;
  image_height: number;
}

// ── AI-assist (bboxai-remote only) ──────────────────────────────────────────

export interface ImageBox extends Annotation {
  class_name: string;
}

export interface ProjectImage {
  image_id: string;
  filename: string;
  boxes: ImageBox[];
}

export interface TokenPackage {
  tokens: number;
  amount_cents: number;
  label: string;
}

export interface WalletInfo {
  balance: number;
  packages: Record<string, TokenPackage>;
  welcome_bonus_granted: boolean;
  terms_accepted: boolean;
  terms_version: string;
  terms_text: string[];
}

export interface ReportUnlockStatus {
  training_done: boolean;
  unlocked: boolean;
  cost: number;
}

export interface ReportUnlockResult {
  unlocked: boolean;
  already_unlocked: boolean;
  tokens_remaining: number;
}

export interface AiAssistResult {
  boxes: ImageBox[];
  tokens_remaining: number;
}
