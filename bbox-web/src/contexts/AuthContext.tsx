import { createContext, useContext, useState, type ReactNode } from "react";
import * as api from "../api/client";

interface AuthContextValue {
  displayName: string | null;
  isLoggedIn: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [displayName, setDisplayName] = useState<string | null>(
    localStorage.getItem("bboxai_display_name")
  );

  async function login(user: string, password: string) {
    const data = await api.login(user, password);
    localStorage.setItem("bboxai_display_name", data.username);
    setDisplayName(data.username);
  }

  function logout() {
    api.logout();
    localStorage.removeItem("bboxai_display_name");
    setDisplayName(null);
  }

  const isLoggedIn = Boolean(api.getToken());

  return (
    <AuthContext.Provider value={{ displayName, isLoggedIn, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
