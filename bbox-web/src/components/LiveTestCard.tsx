import { useEffect, useState } from "react";
import { AlertCircle, Camera, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import * as api from "../api/client";
import type { LiveTestUnlockStatus } from "../api/types";
import { useWallet } from "../contexts/WalletContext";

interface Props {
  projectId: string;
}

// bboxai-remote only — never rendered on the desktop/self-hosted build (see
// the IS_REMOTE gate at the TrainPage.tsx call site). Mirrors the
// report-unlock button pattern in TrainPage.tsx: fetch status on mount,
// unlock on click, reflect the new wallet balance from the response.
export function LiveTestCard({ projectId }: Props) {
  const [status, setStatus] = useState<LiveTestUnlockStatus | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setBalance: setNavBalance } = useWallet();

  useEffect(() => {
    api.getLiveTestStatus(projectId).then(setStatus).catch(() => setStatus(null));
  }, [projectId]);

  async function onUnlock() {
    setUnlocking(true);
    setError(null);
    try {
      const result = await api.unlockLiveTest(projectId);
      setNavBalance(result.tokens_remaining);
      setStatus((prev) => (prev ? { ...prev, unlocked: true } : prev));
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Failed to unlock live test.");
    } finally {
      setUnlocking(false);
    }
  }

  return (
    <div className="card">
      <h3>
        <Camera size={18} />
        Test on live camera
      </h3>
      <p className="muted">
        Point your phone's camera at real objects and see the model detect them live — runs
        entirely on your phone, nothing uploaded per frame.
      </p>

      {error && (
        <p className="error">
          <AlertCircle />
          {error}
        </p>
      )}

      {status?.unlocked ? (
        <Link to={`/projects/${projectId}/live-test`} className="btn-primary">
          <Camera size={16} />
          Open live test
        </Link>
      ) : (
        <button className="btn-primary" onClick={onUnlock} disabled={unlocking || !status}>
          {unlocking ? <Loader2 size={16} className="spin" /> : <Camera size={16} />}
          {unlocking
            ? "Unlocking…"
            : status?.cost === 0
            ? "Try live test free"
            : `Unlock live test (${status?.cost ?? 50} tokens)`}
        </button>
      )}
    </div>
  );
}
