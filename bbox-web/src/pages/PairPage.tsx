import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export function PairPage() {
  const { pair } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await pair(code.trim());
      navigate("/projects");
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Pairing failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="card" onSubmit={onSubmit}>
        <h2>Connect to your desktop</h2>
        <p className="muted">
          Make sure bboxAI is running on your desktop with the agent connected, then enter the
          pairing code shown in its console.
        </p>
        <label>
          Pairing code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            inputMode="numeric"
            maxLength={6}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn-primary" type="submit" disabled={loading}>
          {loading ? "Connecting…" : "Connect"}
        </button>
      </form>
    </div>
  );
}
