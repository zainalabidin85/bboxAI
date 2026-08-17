import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { PairPage } from "./pages/PairPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { AnnotatePage } from "./pages/AnnotatePage";
import { TrainPage } from "./pages/TrainPage";

const IS_REMOTE = import.meta.env.VITE_REMOTE === "true";

function Root() {
  const { isLoggedIn } = useAuth();
  return <Navigate to={isLoggedIn ? "/projects" : "/login"} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Root />} />
        {IS_REMOTE ? (
          <Route path="/login" element={<PairPage />} />
        ) : (
          <>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
          </>
        )}
        <Route element={<ProtectedRoute />}>
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/projects/:id/annotate" element={<AnnotatePage />} />
          <Route path="/projects/:id/train" element={<TrainPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
