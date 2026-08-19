// Downscales an image (from a Blob or an already-loaded <img> src URL) to at
// most `maxDim` px on its long side and returns raw base64 JPEG data (no
// "data:image/jpeg;base64," prefix) — used to keep AI-assist request payloads
// small before sending them to bbox-relay.
export async function downscaleToBase64Jpeg(
  source: Blob | string,
  maxDim = 1024,
  quality = 0.85
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

    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    return dataUrl.split(",")[1] ?? "";
  } finally {
    if (isBlob) URL.revokeObjectURL(url);
  }
}
