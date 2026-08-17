import { createContext, useContext, useState, type ReactNode } from "react";
import * as api from "../api/client";

interface AuthContextValue {
  displayName: string | null;
  isLoggedIn: boolean;
  login: (username: string, password: string) => Promise<void>;
  pair: (pairingCode: string) => Promise<void>;
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

  async function pair(pairingCode: string) {
    const data = await api.pairDevice(pairingCode);
    const label = `Device ${data.device_id.slice(0, 8)}`;
    localStorage.setItem("bboxai_display_name", label);
    setDisplayName(label);
  }

  function logout() {
    api.logout();
    localStorage.removeItem("bboxai_display_name");
    setDisplayName(null);
  }

  const isLoggedIn = Boolean(api.getToken());

  return (
    <AuthContext.Provider value={{ displayName, isLoggedIn, login, pair, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
