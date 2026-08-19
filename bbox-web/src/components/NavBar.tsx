import { useEffect, useRef, useState } from "react";
import { Coins, Scan, LogOut } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useWallet } from "../contexts/WalletContext";

const IS_REMOTE = import.meta.env.VITE_REMOTE === "true";
const TWEEN_DURATION_MS = 1100;

export function NavBar() {
  const { displayName, logout } = useAuth();
  const { balance, delta, clearDelta, refresh } = useWallet();

  useEffect(() => {
    if (IS_REMOTE) refresh();
  }, [refresh]);

  // Animated count shown in the badge — chases `balance` via requestAnimationFrame
  // instead of snapping straight to it, so a top-up/spend reads as a counter
  // ticking rather than a silent number swap.
  const [displayBalance, setDisplayBalance] = useState<number | null>(balance);
  const displayBalanceRef = useRef<number | null>(balance);
  displayBalanceRef.current = displayBalance;

  useEffect(() => {
    if (balance === null) return;
    if (displayBalanceRef.current === null) {
      setDisplayBalance(balance);
      return;
    }
    const start = displayBalanceRef.current;
    const end = balance;
    if (start === end) return;
    const startTime = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / TWEEN_DURATION_MS);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplayBalance(Math.round(start + (end - start) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [balance]);

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link to="/projects" className="navbar-brand">
          <span className="navbar-brand-mark">
            <Scan size={17} strokeWidth={2.25} />
          </span>
          bboxAI
        </Link>
        <div className="navbar-user">
          {IS_REMOTE && (
            <Link
              to="/wallet"
              key={delta?.key ?? "static"}
              className={
                "navbar-token-badge" +
                (delta ? (delta.amount > 0 ? " navbar-token-badge--credit" : " navbar-token-badge--debit") : "")
              }
              title="AI-assist tokens"
            >
              <Coins size={14} className={delta ? "token-coin-icon token-coin-icon--spin" : "token-coin-icon"} />
              {displayBalance ?? "…"}
              {delta && (
                <span
                  className={
                    "token-delta-float " + (delta.amount > 0 ? "token-delta-float--positive" : "token-delta-float--negative")
                  }
                  onAnimationEnd={clearDelta}
                >
                  {delta.amount > 0 ? `+${delta.amount}` : delta.amount}
                </span>
              )}
            </Link>
          )}
          <span className="navbar-username">{displayName}</span>
          <button className="btn-ghost" onClick={logout} title="Logout" aria-label="Logout">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </nav>
  );
}
