import { X } from "lucide-react";
import type { BboxClass } from "../api/types";
import { classColor } from "./BBoxCanvas";

interface Props {
  classes: BboxClass[];
  onPick: (classId: number) => void;
  onCancel: () => void;
}

export function ClassPicker({ classes, onPick, onCancel }: Props) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="header-actions">
          <h3 style={{ flex: 1 }}>Pick a class</h3>
          <button className="btn-ghost" onClick={onCancel} aria-label="Cancel">
            <X size={16} />
          </button>
        </div>
        <div className="class-list">
          {classes.map((c) => (
            <button
              key={c.id}
              className="class-option"
              style={{ borderColor: classColor(c.id) }}
              onClick={() => onPick(c.id)}
            >
              <span className="swatch" style={{ background: classColor(c.id) }} />
              {c.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
