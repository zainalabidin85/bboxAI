import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import * as api from "../api/client";

const IS_REMOTE = import.meta.env.VITE_REMOTE === "true";

interface WalletContextValue {
  balance: number | null;
  refresh: () => Promise<void>;
  setBalance: (balance: number) => void;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [balance, setBalance] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!IS_REMOTE) return;
    try {
      const wallet = await api.getWallet();
      setBalance(wallet.balance);
    } catch {
      // leave balance as-is (e.g. transient network error) rather than blanking the badge
    }
  }, []);

  return (
    <WalletContext.Provider value={{ balance, refresh, setBalance }}>
      {children}
    </WalletContext.Provider>
  );
}

// Shared so the nav balance badge reflects spends/top-ups made anywhere in the
// app (AI Assist, Wallet page) without a full page reload — see AnnotatePage's
// setBalance(result.tokens_remaining) call after each AI-assist call.
export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
