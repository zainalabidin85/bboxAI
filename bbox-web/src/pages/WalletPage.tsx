import { useEffect, useState } from "react";
import { AlertCircle, Coins, Loader2, PartyPopper } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import * as api from "../api/client";
import type { WalletInfo } from "../api/types";
import { useWallet } from "../contexts/WalletContext";

// A "tier ladder" of tile colors — cool blue for the smallest package,
// warming to gold/red for the biggest, instead of every tier reusing the
// same flat accent blue.
const TIER_GRADIENTS = [
  "linear-gradient(135deg, #30d158, #00c7be)",
  "linear-gradient(135deg, #af52de, #bf5af2)",
  "linear-gradient(135deg, #bf5af2, #ff375f)",
  "linear-gradient(135deg, #ff9f0a, #ff6300)",
  "linear-gradient(135deg, #ffd60a, #ff375f)",
];

export function WalletPage() {
  const [params] = useSearchParams();
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [busyPackage, setBusyPackage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [termsChecked, setTermsChecked] = useState(false);
  const { setBalance: setNavBalance } = useWallet();

  const status = params.get("status");

  async function refresh() {
    try {
      const data = await api.getWallet();
      setWallet(data);
      setNavBalance(data.balance); // keep the nav badge in sync
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Failed to load wallet.");
    }
  }

  useEffect(() => {
    refresh();
    // Coming back from a payment redirect: the webhook that actually credits
    // tokens can land a moment after Stripe's redirect does, so re-check once.
    if (status === "success") {
      const t = setTimeout(refresh, 3000);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onBuy(packageId: string) {
    setBusyPackage(packageId);
    setError(null);
    try {
      const { checkout_url } = await api.initiateTopup(packageId, wallet?.terms_accepted || termsChecked);
      window.location.href = checkout_url;
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Failed to start checkout.");
      setBusyPackage(null);
    }
  }

  // Gate purchases behind ticking the checkbox until the server has a
  // recorded acceptance for this account — checked once ever, not on every
  // visit (see bbox-relay's wallet.has_accepted_terms).
  const needsTermsGate = wallet != null && !wallet.terms_accepted;
  const canBuy = !needsTermsGate || termsChecked;

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
        <div className="wallet-hero">
          <Coins size={22} />
          <strong>{wallet.balance}</strong>
          <span>tokens available</span>
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
        <div className="card wallet-terms">
          {needsTermsGate ? (
            <>
              <ul className="wallet-terms-list">
                {wallet.terms_text.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
              <label className="wallet-terms-checkbox">
                <input
                  type="checkbox"
                  checked={termsChecked}
                  onChange={(e) => setTermsChecked(e.target.checked)}
                />
                I have read and agree to the Terms &amp; Conditions above.
              </label>
            </>
          ) : (
            <details>
              <summary className="muted">Terms &amp; Conditions (agreed)</summary>
              <ul className="wallet-terms-list">
                {wallet.terms_text.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {wallet && (
        <>
          <p className="ios-section-caption" style={{ marginTop: "var(--space-5)" }}>Buy tokens</p>
          <div className="ios-list">
            {Object.entries(wallet.packages).map(([packageId, pkg], i) => (
              <button
                key={packageId}
                className="ios-list-row ios-list-row--button"
                onClick={() => onBuy(packageId)}
                disabled={busyPackage !== null || !canBuy}
                title={!canBuy ? "Agree to the Terms & Conditions above first" : undefined}
              >
                <span className="ios-list-row-icon" style={{ background: TIER_GRADIENTS[i % TIER_GRADIENTS.length] }}>
                  <Coins size={16} strokeWidth={2.25} />
                </span>
                <span className="ios-list-row-body">
                  <span className="ios-list-row-title">{pkg.label}</span>
                </span>
                {busyPackage === packageId ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <span className="ios-list-row-buy">Buy</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
