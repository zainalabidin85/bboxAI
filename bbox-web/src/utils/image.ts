// Draws a normalized-coordinate reference grid (10% steps, labeled) over an
// image so a vision model has visual anchor points to estimate bbox
// coordinates against, instead of guessing pixel positions unaided.
function drawCoordinateGrid(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.save();
  ctx.strokeStyle = "rgba(255, 0, 0, 0.45)";
  ctx.lineWidth = 1;
  ctx.font = "11px monospace";

  for (let i = 1; i < 10; i++) {
    const x = Math.round((i / 10) * width);
    const y = Math.round((i / 10) * height);
    const label = (i / 10).toFixed(1);

    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();

    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fillRect(x + 1, 0, 22, 12);
    ctx.fillRect(0, y + 1, 22, 12);
    ctx.fillStyle = "rgba(255, 255, 0, 0.95)";
    ctx.fillText(label, x + 2, 10);
    ctx.fillText(label, 2, y + 10);
  }
  ctx.restore();
}

// Downscales an image (from a Blob or an already-loaded <img> src URL) to at
// most `maxDim` px on its long side and returns raw base64 JPEG data (no
// "data:image/jpeg;base64," prefix) — used to keep AI-assist request payloads
// small before sending them to bbox-relay. `overlayGrid` draws a labeled 10%
// coordinate grid on top, to help a vision model localize boxes more
// precisely (see ai_assist.py's prompt, which explains the grid to the model).
export async function downscaleToBase64Jpeg(
  source: Blob | string,
  maxDim = 1024,
  quality = 0.85,
  overlayGrid = false
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

    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    return dataUrl.split(",")[1] ?? "";
  } finally {
    if (isBlob) URL.revokeObjectURL(url);
  }
}
