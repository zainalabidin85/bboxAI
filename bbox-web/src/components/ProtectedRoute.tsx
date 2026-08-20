import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { NavBar } from "./NavBar";

export function ProtectedRoute() {
  const { isLoggedIn } = useAuth();
  const location = useLocation();
  if (!isLoggedIn) return <Navigate to="/login" replace />;
  return (
    <>
      <NavBar />
      {/* Remounting this wrapper (keyed on pathname) re-triggers the CSS
          entrance animation on every navigation — see .page-fade in
          theme-remote.css. NavBar itself stays mounted so the balance
          badge etc. don't flicker on page changes. */}
      <div key={location.pathname} className="page-fade">
        <Outlet />
      </div>
    </>
  );
}
