import { useEffect, useState } from "react";
import { Coins, Scan, LogOut } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import * as api from "../api/client";

const IS_REMOTE = import.meta.env.VITE_REMOTE === "true";

export function NavBar() {
  const { displayName, logout } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (IS_REMOTE) {
      api.getWallet().then((w) => setBalance(w.balance)).catch(() => setBalance(null));
    }
  }, []);

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
            <Link to="/wallet" className="navbar-token-badge" title="AI-assist tokens">
              <Coins size={14} />
              {balance ?? "…"}
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
