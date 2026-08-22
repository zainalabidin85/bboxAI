import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Trash2, Undo2 } from "lucide-react";
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
const HANDLE_HIT = 8; // px tolerance for grabbing a resize handle

type HandleKey = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLE_KEYS: HandleKey[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const HANDLE_CURSOR: Record<HandleKey, string> = {
  nw: "nwse-resize", n: "ns-resize", ne: "nesw-resize", e: "ew-resize",
  se: "nwse-resize", s: "ns-resize", sw: "nesw-resize", w: "ew-resize",
};

type DragMode =
  | { kind: "draw"; startX: number; startY: number; x: number; y: number }
  | { kind: "move"; index: number; offsetX: number; offsetY: number }
  | { kind: "resize"; index: number; handle: HandleKey; left0: number; top0: number; right0: number; bottom0: number };

interface Props {
  imageUrl: string;
  classes: BboxClass[];
  boxes: Annotation[];
  onBoxesChange: (boxes: Annotation[]) => void;
  // Blurs the canvas and shows a scanning overlay while true — purely a
  // "Claude is looking at this image" visual cue for AI Assist, not tied to
  // any other loading state.
  processing?: boolean;
}

function handlePositions(x: number, y: number, w: number, h: number): Record<HandleKey, { x: number; y: number }> {
  return {
    nw: { x, y }, n: { x: x + w / 2, y }, ne: { x: x + w, y },
    e: { x: x + w, y: y + h / 2 }, se: { x: x + w, y: y + h }, s: { x: x + w / 2, y: y + h },
    sw: { x, y: y + h }, w: { x, y: y + h / 2 },
  };
}

export function BBoxCanvas({ imageUrl, classes, boxes, onBoxesChange, processing = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [size, setSize] = useState({ width: MAX_WIDTH, height: MAX_WIDTH });
  const [dragMode, setDragMode] = useState<DragMode | null>(null);
  const [pendingRect, setPendingRect] = useState<Annotation | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [cursor, setCursor] = useState("crosshair");

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const width = Math.min(MAX_WIDTH, img.naturalWidth);
      const height = width * (img.naturalHeight / img.naturalWidth);
      setSize({ width, height });
    };
    img.src = imageUrl;
    setSelectedIndex(null);
  }, [imageUrl]);

  useEffect(() => {
    setSelectedIndex((prev) => (prev !== null && prev < boxes.length ? prev : null));
  }, [boxes.length]);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, boxes, dragMode, selectedIndex]);

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

    boxes.forEach((b, i) => {
      const color = classColor(b.class_id);
      const x = b.x * size.width;
      const y = b.y * size.height;
      const w = b.w * size.width;
      const h = b.h * size.height;
      const selected = i === selectedIndex;

      ctx.strokeStyle = color;
      ctx.lineWidth = selected ? 3 : 2;
      ctx.strokeRect(x, y, w, h);

      const className = classes.find((c) => c.id === b.class_id)?.name ?? `class ${b.class_id}`;
      ctx.font = "12px sans-serif";
      const textWidth = ctx.measureText(className).width;
      ctx.fillStyle = color;
      ctx.fillRect(x, Math.max(0, y - 16), textWidth + 8, 16);
      ctx.fillStyle = "#fff";
      ctx.fillText(className, x + 4, Math.max(12, y - 4));

      if (selected) {
        const handles = handlePositions(x, y, w, h);
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        for (const key of HANDLE_KEYS) {
          const { x: hx, y: hy } = handles[key];
          ctx.fillRect(hx - 4, hy - 4, 8, 8);
          ctx.strokeRect(hx - 4, hy - 4, 8, 8);
        }
      }
    });

    if (dragMode?.kind === "draw") {
      const x = Math.min(dragMode.startX, dragMode.x);
      const y = Math.min(dragMode.startY, dragMode.y);
      const w = Math.abs(dragMode.x - dragMode.startX);
      const h = Math.abs(dragMode.y - dragMode.startY);
      ctx.strokeStyle = "#ffffff";
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }
  }

  function getPos(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(size.width, ((e.clientX - rect.left) / rect.width) * size.width));
    const y = Math.max(0, Math.min(size.height, ((e.clientY - rect.top) / rect.height) * size.height));
    return { x, y };
  }

  function hitHandle(px: number, py: number, index: number): HandleKey | null {
    const b = boxes[index];
    const handles = handlePositions(b.x * size.width, b.y * size.height, b.w * size.width, b.h * size.height);
    for (const key of HANDLE_KEYS) {
      const { x: hx, y: hy } = handles[key];
      if (Math.abs(px - hx) <= HANDLE_HIT && Math.abs(py - hy) <= HANDLE_HIT) return key;
    }
    return null;
  }

  function hitBoxIndex(px: number, py: number): number | null {
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      const x = b.x * size.width, y = b.y * size.height, w = b.w * size.width, h = b.h * size.height;
      if (px >= x && px <= x + w && py >= y && py <= y + h) return i;
    }
    return null;
  }

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const { x, y } = getPos(e);

    if (selectedIndex !== null) {
      const handle = hitHandle(x, y, selectedIndex);
      if (handle) {
        const b = boxes[selectedIndex];
        const left0 = b.x * size.width, top0 = b.y * size.height;
        setDragMode({
          kind: "resize", index: selectedIndex, handle,
          left0, top0, right0: left0 + b.w * size.width, bottom0: top0 + b.h * size.height,
        });
        return;
      }
    }

    const hitIndex = hitBoxIndex(x, y);
    if (hitIndex !== null) {
      const b = boxes[hitIndex];
      setSelectedIndex(hitIndex);
      setDragMode({ kind: "move", index: hitIndex, offsetX: x - b.x * size.width, offsetY: y - b.y * size.height });
      return;
    }

    setSelectedIndex(null);
    setDragMode({ kind: "draw", startX: x, startY: y, x, y });
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const { x, y } = getPos(e);

    if (!dragMode) {
      // Hover feedback only (no active drag).
      if (selectedIndex !== null) {
        const handle = hitHandle(x, y, selectedIndex);
        if (handle) {
          setCursor(HANDLE_CURSOR[handle]);
          return;
        }
      }
      setCursor(hitBoxIndex(x, y) !== null ? "move" : "crosshair");
      return;
    }

    if (dragMode.kind === "draw") {
      setDragMode({ ...dragMode, x, y });
      return;
    }

    if (dragMode.kind === "move") {
      const b = boxes[dragMode.index];
      const newX = Math.max(0, Math.min(size.width - b.w * size.width, x - dragMode.offsetX)) / size.width;
      const newY = Math.max(0, Math.min(size.height - b.h * size.height, y - dragMode.offsetY)) / size.height;
      onBoxesChange(boxes.map((box, i) => (i === dragMode.index ? { ...box, x: newX, y: newY } : box)));
      return;
    }

    // resize
    const minW = MIN_BOX_FRACTION * size.width;
    const minH = MIN_BOX_FRACTION * size.height;
    let { left0: left, top0: top, right0: right, bottom0: bottom } = dragMode;
    const isLeft = dragMode.handle === "nw" || dragMode.handle === "w" || dragMode.handle === "sw";
    const isRight = dragMode.handle === "ne" || dragMode.handle === "e" || dragMode.handle === "se";
    const isTop = dragMode.handle === "nw" || dragMode.handle === "n" || dragMode.handle === "ne";
    const isBottom = dragMode.handle === "sw" || dragMode.handle === "s" || dragMode.handle === "se";
    if (isLeft) left = Math.min(x, right - minW);
    if (isRight) right = Math.max(x, left + minW);
    if (isTop) top = Math.min(y, bottom - minH);
    if (isBottom) bottom = Math.max(y, top + minH);

    onBoxesChange(
      boxes.map((box, i) =>
        i === dragMode.index
          ? { ...box, x: left / size.width, y: top / size.height, w: (right - left) / size.width, h: (bottom - top) / size.height }
          : box
      )
    );
  }

  function onPointerUp() {
    if (dragMode?.kind === "draw") {
      const x0 = Math.min(dragMode.startX, dragMode.x) / size.width;
      const y0 = Math.min(dragMode.startY, dragMode.y) / size.height;
      const w = Math.abs(dragMode.x - dragMode.startX) / size.width;
      const h = Math.abs(dragMode.y - dragMode.startY) / size.height;
      if (w >= MIN_BOX_FRACTION && h >= MIN_BOX_FRACTION) {
        setPendingRect({ x: x0, y: y0, w, h, class_id: 0 });
      }
    }
    setDragMode(null);
  }

  function handleClassPick(classId: number) {
    if (!pendingRect) return;
    onBoxesChange([...boxes, { ...pendingRect, class_id: classId }]);
    setPendingRect(null);
  }

  function undo() {
    onBoxesChange(boxes.slice(0, -1));
  }

  function deleteSelected() {
    if (selectedIndex === null) return;
    onBoxesChange(boxes.filter((_, i) => i !== selectedIndex));
    setSelectedIndex(null);
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLCanvasElement>) {
    if ((e.key === "Delete" || e.key === "Backspace") && selectedIndex !== null) {
      e.preventDefault();
      deleteSelected();
    }
  }

  return (
    <div
      className={"bbox-canvas-wrap" + (processing ? " bbox-canvas-wrap--processing" : "")}
      style={{ maxWidth: size.width }}
    >
      <canvas
        ref={canvasRef}
        tabIndex={0}
        style={{ width: "100%", height: "auto", touchAction: "none", cursor, outline: "none", display: "block" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
      />
      {processing && (
        <div className="bbox-canvas-scan" aria-hidden="true">
          <div className="bbox-canvas-scan-line" />
        </div>
      )}
      <div className="canvas-toolbar">
        <button className="btn-secondary" onClick={undo} disabled={boxes.length === 0}>
          <Undo2 size={16} />
          Undo
        </button>
        <button className="btn-secondary" onClick={deleteSelected} disabled={selectedIndex === null}>
          <Trash2 size={16} />
          Delete selected
        </button>
        <span>{boxes.length} box{boxes.length === 1 ? "" : "es"}</span>
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
