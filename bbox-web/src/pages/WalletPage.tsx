import { useEffect, useState } from "react";
import { AlertCircle, Coins, Loader2, PartyPopper } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import * as api from "../api/client";
import type { WalletInfo } from "../api/types";

export function WalletPage() {
  const [params] = useSearchParams();
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [busyPackage, setBusyPackage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const status = params.get("status");

  async function refresh() {
    try {
      setWallet(await api.getWallet());
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Failed to load wallet.");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onBuy(packageId: string) {
    setBusyPackage(packageId);
    setError(null);
    try {
      const { checkout_url } = await api.initiateTopup(packageId);
      window.location.href = checkout_url;
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Failed to start checkout.");
      setBusyPackage(null);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h2>AI-assist tokens</h2>
      </header>

      {status === "success" && (
        <p className="muted">Payment received — your balance will update once it's confirmed (usually within seconds).</p>
      )}
      {status === "processing" && (
        <p className="muted">Payment processing — your balance will update once it's confirmed.</p>
      )}
      {status === "cancelled" && <p className="muted">Checkout cancelled — no charge was made.</p>}

      {wallet?.welcome_bonus_granted && (
        <p className="wallet-welcome-banner">
          <PartyPopper size={16} />
          Welcome! You've received {wallet.balance} free AI-assist tokens to try it out.
        </p>
      )}

      {wallet ? (
        <div className="card wallet-balance">
          <Coins size={20} />
          <span>
            <strong>{wallet.balance}</strong> tokens
          </span>
        </div>
      ) : (
        <p className="muted" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Loader2 size={14} className="spin" />
          Loading balance…
        </p>
      )}

      {error && (
        <p className="error">
          <AlertCircle />
          {error}
        </p>
      )}

      {wallet && (
        <div className="wallet-packages">
          {Object.entries(wallet.packages).map(([packageId, pkg]) => (
            <button
              key={packageId}
              className="btn-secondary"
              onClick={() => onBuy(packageId)}
              disabled={busyPackage !== null}
            >
              {busyPackage === packageId && <Loader2 size={16} className="spin" />}
              {pkg.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
