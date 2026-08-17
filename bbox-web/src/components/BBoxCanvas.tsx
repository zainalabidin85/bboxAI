import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Annotation, BboxClass } from "../api/types";
import { ClassPicker } from "./ClassPicker";

const PALETTE = [
  "#e63946", "#f4a261", "#2a9d8f", "#264653", "#e76f51",
  "#8ab17d", "#457b9d", "#a663cc", "#ffb703",
];

export function classColor(classId: number): string {
  return PALETTE[classId % PALETTE.length];
}

// Matches the 4%-of-image-dimension minimum box size used in the Flutter app
// (bbox-app/lib/screens/annotation_screen.dart) to filter out accidental taps.
const MIN_BOX_FRACTION = 0.04;
const MAX_WIDTH = 800;

interface Props {
  imageUrl: string;
  classes: BboxClass[];
  boxes: Annotation[];
  onBoxesChange: (boxes: Annotation[]) => void;
}

export function BBoxCanvas({ imageUrl, classes, boxes, onBoxesChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [size, setSize] = useState({ width: MAX_WIDTH, height: MAX_WIDTH });
  const [drag, setDrag] = useState<{ startX: number; startY: number; x: number; y: number } | null>(
    null
  );
  const [pendingRect, setPendingRect] = useState<Annotation | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const width = Math.min(MAX_WIDTH, img.naturalWidth);
      const height = width * (img.naturalHeight / img.naturalWidth);
      setSize({ width, height });
    };
    img.src = imageUrl;
  }, [imageUrl]);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, boxes, drag]);

  function draw() {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, size.width, size.height);
    ctx.drawImage(img, 0, 0, size.width, size.height);

    boxes.forEach((b) => {
      const color = classColor(b.class_id);
      const x = b.x * size.width;
      const y = b.y * size.height;
      const w = b.w * size.width;
      const h = b.h * size.height;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      const className = classes.find((c) => c.id === b.class_id)?.name ?? `class ${b.class_id}`;
      ctx.font = "12px sans-serif";
      const textWidth = ctx.measureText(className).width;
      ctx.fillStyle = color;
      ctx.fillRect(x, Math.max(0, y - 16), textWidth + 8, 16);
      ctx.fillStyle = "#fff";
      ctx.fillText(className, x + 4, Math.max(12, y - 4));
    });

    if (drag) {
      const x = Math.min(drag.startX, drag.x);
      const y = Math.min(drag.startY, drag.y);
      const w = Math.abs(drag.x - drag.startX);
      const h = Math.abs(drag.y - drag.startY);
      ctx.strokeStyle = "#ffffff";
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }
  }

  function getPos(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * size.width;
    const y = ((e.clientY - rect.top) / rect.height) * size.height;
    return { x, y };
  }

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const { x, y } = getPos(e);
    setDrag({ startX: x, startY: y, x, y });
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drag) return;
    const { x, y } = getPos(e);
    setDrag((prev) => (prev ? { ...prev, x, y } : prev));
  }

  function onPointerUp() {
    if (!drag) return;
    const x0 = Math.min(drag.startX, drag.x) / size.width;
    const y0 = Math.min(drag.startY, drag.y) / size.height;
    const w = Math.abs(drag.x - drag.startX) / size.width;
    const h = Math.abs(drag.y - drag.startY) / size.height;
    setDrag(null);
    if (w < MIN_BOX_FRACTION || h < MIN_BOX_FRACTION) return;
    setPendingRect({ x: x0, y: y0, w, h, class_id: 0 });
  }

  function handleClassPick(classId: number) {
    if (!pendingRect) return;
    onBoxesChange([...boxes, { ...pendingRect, class_id: classId }]);
    setPendingRect(null);
  }

  function undo() {
    onBoxesChange(boxes.slice(0, -1));
  }

  return (
    <div className="bbox-canvas-wrap">
      <canvas
        ref={canvasRef}
        style={{ width: size.width, height: size.height, touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <div className="canvas-toolbar">
        <button className="btn-secondary" onClick={undo} disabled={boxes.length === 0}>
          Undo
        </button>
        <span>{boxes.length} box(es)</span>
      </div>
      {pendingRect && (
        <ClassPicker
          classes={classes}
          onPick={handleClassPick}
          onCancel={() => setPendingRect(null)}
        />
      )}
    </div>
  );
}
