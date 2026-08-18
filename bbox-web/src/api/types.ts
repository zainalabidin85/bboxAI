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
