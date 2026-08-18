import { Scan, LogOut } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export function NavBar() {
  const { displayName, logout } = useAuth();

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
          <span className="navbar-username">{displayName}</span>
          <button className="btn-ghost" onClick={logout} title="Logout" aria-label="Logout">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </nav>
  );
}
