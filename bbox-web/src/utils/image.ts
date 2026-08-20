// Draws a normalized-coordinate reference grid (10% steps, labeled) over an
// image so a vision model has visual anchor points to estimate bbox
// coordinates against, instead of guessing pixel positions unaided.
//
// Labels sit at every interior intersection (not just the top/left edges) so
// an object anywhere in the frame has a labeled anchor within ~10% of its
// own position, instead of forcing the model to count/interpolate several
// unlabeled gridlines inward from a distant edge label — that long-distance
// extrapolation was producing a consistent directional offset in AI-assist
// suggestions for objects away from the top-left corner (see ai_assist.py's
// grid_note, which this grid backs).
function drawCoordinateGrid(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.save();
  ctx.strokeStyle = "rgba(255, 0, 0, 0.45)";
  ctx.lineWidth = 1;
  ctx.font = "11px monospace";

  for (let i = 1; i < 10; i++) {
    const x = Math.round((i / 10) * width);
    const y = Math.round((i / 10) * height);

    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.textBaseline = "top";
  for (let i = 1; i < 10; i++) {
    for (let j = 1; j < 10; j++) {
      const x = Math.round((i / 10) * width);
      const y = Math.round((j / 10) * height);
      const label = `${(i / 10).toFixed(1)},${(j / 10).toFixed(1)}`;
      const textWidth = ctx.measureText(label).width;

      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx.fillRect(x + 2, y + 2, textWidth + 4, 12);
      ctx.fillStyle = "rgba(255, 255, 0, 0.95)";
      ctx.fillText(label, x + 4, y + 3);
    }
  }
  ctx.restore();
}

export interface BoxOverlay {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  color: string;
}

// Draws normalized-coordinate boxes (e.g. the current/AI-suggested boxes on a
// frame) directly onto the image, in a bright outline distinct from the red
// grid, with a filled label above each. Used so a refine call actually shows
// Claude where its own prior suggestion landed relative to the real objects,
// instead of only describing those boxes as JSON coordinates in the prompt
// text — a JSON-only description gives Claude nothing to visually compare
// against when checking whether a box is correctly placed.
function drawBoxesOverlay(ctx: CanvasRenderingContext2D, boxes: BoxOverlay[], width: number, height: number) {
  ctx.save();
  ctx.lineWidth = 2;
  ctx.font = "bold 12px sans-serif";
  ctx.textBaseline = "alphabetic";

  for (const b of boxes) {
    const x = b.x * width;
    const y = b.y * height;
    const w = b.w * width;
    const h = b.h * height;

    ctx.strokeStyle = b.color;
    ctx.strokeRect(x, y, w, h);

    const textWidth = ctx.measureText(b.label).width;
    ctx.fillStyle = b.color;
    ctx.fillRect(x, Math.max(0, y - 16), textWidth + 8, 16);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(b.label, x + 4, Math.max(12, y - 4));
  }
  ctx.restore();
}

// Downscales an image (from a Blob or an already-loaded <img> src URL) to at
// most `maxDim` px on its long side and returns raw base64 JPEG data (no
// "data:image/jpeg;base64," prefix) — used to keep AI-assist request payloads
// small before sending them to bbox-relay. `overlayGrid` draws a labeled 10%
// coordinate grid on top, to help a vision model localize boxes more
// precisely (see ai_assist.py's prompt, which explains the grid to the model).
// `boxes`, when given, are drawn on top of the grid so Claude can visually
// compare a suggestion's current boxes against the real objects (used for
// "Improve suggestion" refine calls).
export async function downscaleToBase64Jpeg(
  source: Blob | string,
  maxDim = 1024,
  quality = 0.85,
  overlayGrid = false,
  boxes?: BoxOverlay[]
): Promise<string> {
  const isBlob = typeof source !== "string";
  const url = isBlob ? URL.createObjectURL(source) : source;
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to load image."));
      img.src = url;
    });

    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported.");
    ctx.drawImage(img, 0, 0, width, height);
    if (overlayGrid) drawCoordinateGrid(ctx, width, height);
    if (boxes && boxes.length > 0) drawBoxesOverlay(ctx, boxes, width, height);

    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    return dataUrl.split(",")[1] ?? "";
  } finally {
    if (isBlob) URL.revokeObjectURL(url);
  }
}
