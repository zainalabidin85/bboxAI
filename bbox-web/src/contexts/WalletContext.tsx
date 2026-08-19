import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import * as api from "../api/client";

const IS_REMOTE = import.meta.env.VITE_REMOTE === "true";

export interface WalletDelta {
  amount: number; // positive = credit (top-up), negative = debit (AI-assist spend)
  key: number; // unique per change, so a keyed element can remount to restart its CSS animation
}

interface WalletContextValue {
  balance: number | null;
  delta: WalletDelta | null;
  clearDelta: () => void;
  refresh: () => Promise<void>;
  setBalance: (balance: number) => void;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [balance, setBalanceState] = useState<number | null>(null);
  const [delta, setDelta] = useState<WalletDelta | null>(null);
  // Previous balance for delta computation. A ref, not state, so computing it
  // never itself triggers a render — only the derived delta below does.
  const prevBalanceRef = useRef<number | null>(null);

  const applyBalance = useCallback((next: number) => {
    const prev = prevBalanceRef.current;
    // Skip on first-ever value (nothing to diff against) so the coin badge
    // doesn't animate on initial page load.
    if (prev !== null && next !== prev) {
      setDelta({ amount: next - prev, key: Date.now() });
    }
    prevBalanceRef.current = next;
    setBalanceState(next);
  }, []);

  const refresh = useCallback(async () => {
    if (!IS_REMOTE) return;
    try {
      const wallet = await api.getWallet();
      applyBalance(wallet.balance);
    } catch {
      // leave balance as-is (e.g. transient network error) rather than blanking the badge
    }
  }, [applyBalance]);

  const clearDelta = useCallback(() => setDelta(null), []);

  return (
    <WalletContext.Provider value={{ balance, delta, clearDelta, refresh, setBalance: applyBalance }}>
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
