import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EpochMetric } from "../api/types";

interface Props {
  data: EpochMetric[];
}

export function MetricsChart({ data }: Props) {
  if (data.length === 0) {
    return <p className="muted">No epoch data yet — metrics appear after the first epoch completes.</p>;
  }

  return (
    <div className="metrics-charts">
      <div className="chart-block">
        <h4>Accuracy metrics</h4>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="epoch" />
            <YAxis domain={[0, 1]} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="map50" name="mAP50" stroke="#2a9d8f" dot={false} />
            <Line type="monotone" dataKey="map50_95" name="mAP50-95" stroke="#264653" dot={false} />
            <Line type="monotone" dataKey="precision" name="Precision" stroke="#e76f51" dot={false} />
            <Line type="monotone" dataKey="recall" name="Recall" stroke="#a663cc" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-block">
        <h4>Loss</h4>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="epoch" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="box_loss" name="Box loss" stroke="#e63946" dot={false} />
            <Line type="monotone" dataKey="cls_loss" name="Class loss" stroke="#f4a261" dot={false} />
            <Line type="monotone" dataKey="dfl_loss" name="DFL loss" stroke="#457b9d" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
