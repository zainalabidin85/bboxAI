import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { WalletProvider } from "./contexts/WalletContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { AnnotatePage } from "./pages/AnnotatePage";
import { TrainPage } from "./pages/TrainPage";
import { WalletPage } from "./pages/WalletPage";

const IS_REMOTE = import.meta.env.VITE_REMOTE === "true";

function Root() {
  const { isLoggedIn } = useAuth();
  return <Navigate to={isLoggedIn ? "/projects" : "/login"} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <WalletProvider>
        <Routes>
          <Route path="/" element={<Root />} />
          <Route path="/login" element={<LoginPage />} />
          {!IS_REMOTE && <Route path="/register" element={<RegisterPage />} />}
          <Route element={<ProtectedRoute />}>
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            <Route path="/projects/:id/annotate" element={<AnnotatePage />} />
            <Route path="/projects/:id/train" element={<TrainPage />} />
            {IS_REMOTE && <Route path="/wallet" element={<WalletPage />} />}
          </Route>
        </Routes>
      </WalletProvider>
    </AuthProvider>
  );
}
