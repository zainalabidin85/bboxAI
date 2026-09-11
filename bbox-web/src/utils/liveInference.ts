import * as ort from "onnxruntime-web";

// Fixed at export time (see bbox-api's services/trainer.py _export_onnx) —
// the model this loads was always exported at 320x320, opset 12.
export const IMG_SIZE = 320;
export const CONF_THRES = 0.35;
export const IOU_THRES = 0.45;

export type ExecutionProvider = "webgpu" | "wasm";

export interface Detection {
  box: [number, number, number, number]; // x1, y1, x2, y2 in source-video pixel coords
  score: number;
  classId: number;
}

// Tries WebGPU first (measured ~15 FPS on Android Chrome in the feasibility
// spike), falls back to WASM silently on any device/browser where WebGPU
// isn't available (notably most iOS Safari versions) — no user-facing
// warning by design, see the design spec's "iOS handling" decision.
export async function loadSession(
  modelBytes: ArrayBuffer
): Promise<{ session: ort.InferenceSession; ep: ExecutionProvider }> {
  ort.env.wasm.numThreads = navigator.hardwareConcurrency
    ? Math.min(4, navigator.hardwareConcurrency)
    : 1;
  ort.env.wasm.simd = true;

  try {
    const session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ["webgpu"],
    });
    return { session, ep: "webgpu" };
  } catch {
    const session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ["wasm"],
    });
    return { session, ep: "wasm" };
  }
}

function iou(a: [number, number, number, number], b: [number, number, number, number]): number {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  return inter / (areaA + areaB - inter + 1e-6);
}

function nms(dets: Detection[], thres: number): Detection[] {
  const sorted = [...dets].sort((a, b) => b.score - a.score);
  const keep: Detection[] = [];
  for (const d of sorted) {
    const suppressed = keep.some((k) => k.classId === d.classId && iou(k.box, d.box) > thres);
    if (!suppressed) keep.push(d);
  }
  return keep;
}

// One call per animation frame. `offCanvas` is caller-owned scratch space
// (IMG_SIZE x IMG_SIZE) reused across calls to avoid allocating a new
// canvas every frame.
export async function detectFrame(
  session: ort.InferenceSession,
  video: HTMLVideoElement,
  offCanvas: HTMLCanvasElement
): Promise<Detection[]> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  offCanvas.width = IMG_SIZE;
  offCanvas.height = IMG_SIZE;
  const offCtx = offCanvas.getContext("2d")!;

  // Letterbox: scale to fit inside IMG_SIZE x IMG_SIZE, pad with grey.
  const scale = Math.min(IMG_SIZE / vw, IMG_SIZE / vh);
  const nw = Math.round(vw * scale);
  const nh = Math.round(vh * scale);
  const padX = (IMG_SIZE - nw) / 2;
  const padY = (IMG_SIZE - nh) / 2;
  offCtx.fillStyle = "#727272";
  offCtx.fillRect(0, 0, IMG_SIZE, IMG_SIZE);
  offCtx.drawImage(video, 0, 0, vw, vh, padX, padY, nw, nh);

  const imgData = offCtx.getImageData(0, 0, IMG_SIZE, IMG_SIZE).data;
  const plane = IMG_SIZE * IMG_SIZE;
  const chw = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    chw[i] = imgData[i * 4] / 255;
    chw[plane + i] = imgData[i * 4 + 1] / 255;
    chw[2 * plane + i] = imgData[i * 4 + 2] / 255;
  }
  const tensor = new ort.Tensor("float32", chw, [1, 3, IMG_SIZE, IMG_SIZE]);

  const outputs = await session.run({ images: tensor });
  const outputKey = Object.keys(outputs)[0];
  const output = outputs[outputKey];
  const data = output.data as Float32Array;
  const numBoxes = output.dims[2] as number;
  const numAttrs = output.dims[1] as number;
  const numClasses = numAttrs - 4;

  const dets: Detection[] = [];
  for (let i = 0; i < numBoxes; i++) {
    let bestClass = -1;
    let bestScore = 0;
    for (let c = 0; c < numClasses; c++) {
      const s = data[(4 + c) * numBoxes + i];
      if (s > bestScore) {
        bestScore = s;
        bestClass = c;
      }
    }
    if (bestScore < CONF_THRES) continue;

    const cx = data[0 * numBoxes + i];
    const cy = data[1 * numBoxes + i];
    const w = data[2 * numBoxes + i];
    const h = data[3 * numBoxes + i];
    const x1 = (cx - w / 2 - padX) / scale;
    const y1 = (cy - h / 2 - padY) / scale;
    const x2 = (cx + w / 2 - padX) / scale;
    const y2 = (cy + h / 2 - padY) / scale;
    dets.push({ box: [x1, y1, x2, y2], score: bestScore, classId: bestClass });
  }

  return nms(dets, IOU_THRES);
}
