import { useState, type FormEvent } from "react";
import { AlertCircle, Loader2, Scan, UserPlus } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import * as api from "../api/client";

export function RegisterPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await api.register(username, email, password);
      navigate("/login");
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Registration failed.");
    } finally {
      setLoading(false);
    }
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
        <form className="card" onSubmit={onSubmit}>
          <h3>Create your account</h3>
          <label>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              minLength={3}
              autoFocus
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
            />
          </label>
          <label>
            Confirm password
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
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
            {loading ? <Loader2 size={16} className="spin" /> : <UserPlus size={16} />}
            {loading ? "Creating…" : "Register"}
          </button>
          <p className="muted">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
