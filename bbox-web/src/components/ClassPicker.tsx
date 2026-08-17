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
        <h3>Pick a class</h3>
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
        <button className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
