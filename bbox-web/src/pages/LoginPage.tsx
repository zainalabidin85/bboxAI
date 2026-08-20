import { useState, type FormEvent } from "react";
import { AlertCircle, Loader2, LogIn, Lock, Scan } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

const IS_REMOTE = import.meta.env.VITE_REMOTE === "true";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password);
      navigate("/projects");
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Login failed.");
      setShake(false);
      requestAnimationFrame(() => setShake(true));
    } finally {
      setLoading(false);
    }
  }

  if (IS_REMOTE) {
    return (
      <div className="lock-screen">
        <div className="lock-screen-glow" />

        <form
          className={`lock-screen-panel${shake ? " shake" : ""}`}
          onSubmit={onSubmit}
          onAnimationEnd={() => setShake(false)}
        >
          <div className={`lock-screen-face-id${loading ? " lock-screen-face-id--busy" : ""}`}>
            <Scan size={26} strokeWidth={1.75} />
          </div>
          <p className="lock-screen-title">bboxAI Remote</p>
          <p className="lock-screen-subtitle">Enter your account to unlock</p>

          <input
            className="lock-screen-input"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            autoFocus
          />
          <input
            className="lock-screen-input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />

          {error && (
            <p className="error">
              <AlertCircle />
              {error}
            </p>
          )}

          <button className="lock-screen-unlock" type="submit" disabled={loading}>
            {loading ? <Loader2 size={16} className="spin" /> : <Lock size={16} />}
            {loading ? "Unlocking…" : "Unlock"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="navbar-brand-mark">
            <Scan size={17} strokeWidth={2.25} />
          </span>
          bboxAI
        </div>
        <form
          className={`card${shake ? " shake" : ""}`}
          onSubmit={onSubmit}
          onAnimationEnd={() => setShake(false)}
        >
          <h3>Sign in to your account</h3>
          <label>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              autoFocus
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <p className="error">
              <AlertCircle />
              {error}
            </p>
          )}
          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? <Loader2 size={16} className="spin" /> : <LogIn size={16} />}
            {loading ? "Signing in…" : "Sign in"}
          </button>
          {!IS_REMOTE && (
            <p className="muted">
              No account? <Link to="/register">Register</Link>
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
