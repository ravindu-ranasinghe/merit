"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { useLinkWallet, useWalletLink } from "@/lib/api/queries";
import { describeChainError } from "@/lib/chain/errors";
import { useNeedsGas, useSignMessage, useWallet } from "@/lib/chain/hooks";
import { formatDate } from "@/lib/format";
import { IconCheckDraw, IconExternal, IconWallet } from "./icons";
import { AddressLink, Button, LinkButton, Notice } from "./ui";

/**
 * Wraps an action that needs a wallet on Arc testnet. Until one is connected it shows a
 * connect or switch-network button with a plain reason, then renders the children.
 */
export function WalletGate({ reason, children }: { reason: string; children: ReactNode }) {
  const wallet = useWallet();
  if (!wallet.connected) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={wallet.connect} loading={wallet.busy}>
          <IconWallet size={15} />
          Connect wallet
        </Button>
        <p className="text-[13px] text-mut">{reason}</p>
      </div>
    );
  }
  if (wallet.wrongNetwork) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={wallet.switchNetwork} loading={wallet.busy}>
          Switch to Arc testnet
        </Button>
        <p className="text-[13px] text-mut">Your wallet is on a different network. Merit runs on Arc testnet.</p>
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * A step, not an error: Arc charges gas in USDC, so a wallet with none cannot send a claim.
 * Renders nothing unless the balance is known to be zero, and goes away once USDC arrives.
 */
export function GasStep({ address, className }: { address: string | null | undefined; className?: string }) {
  const needsGas = useNeedsGas(address as `0x${string}` | null | undefined);
  const [copied, setCopied] = useState(false);
  if (!needsGas || !address) return null;
  return (
    <Notice tone="progress" className={className} title="Next step: get a little testnet USDC for gas">
      <p>
        You&apos;ll need a small amount of USDC to cover gas — Arc charges gas in USDC. Get testnet USDC from the
        Circle faucet: choose Arc Testnet and paste your address.
      </p>
      <p className="mt-2 break-all font-mono text-[12px] text-ink">{address}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* The faucet has no address parameter, so the address is copied for pasting there. */}
        <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(address).then(() => setCopied(true))}>
          {copied ? "Address copied" : "Copy address"}
        </Button>
        <LinkButton href="https://faucet.circle.com/" external variant="accent">
          Open the Circle faucet
          <IconExternal size={13} />
        </LinkButton>
      </div>
      <p className="mt-2 text-[12px] text-mut">This step clears by itself once the USDC arrives.</p>
    </Notice>
  );
}

/**
 * Links a payout wallet to the signed-in GitHub account by signing a challenge message.
 * Signing is free and moves no money; it shows the reviewer controls the address.
 */
export function WalletLinkCard() {
  const wallet = useWallet();
  const link = useWalletLink();
  const { challenge, verify } = useLinkWallet();
  const signer = useSignMessage();
  const [relinking, setRelinking] = useState(false);

  const busy = challenge.isPending || signer.busy || verify.isPending;
  const apiError = challenge.error ?? verify.error;

  const start = async () => {
    if (!wallet.address) return;
    const address = wallet.address;
    const ch = await challenge.mutateAsync(address).catch(() => null);
    if (!ch) return;
    const signature = await signer.sign(ch.message);
    if (!signature) return;
    await verify.mutateAsync({ address, nonce: ch.nonce, signature }).catch(() => null);
    setRelinking(false);
  };

  if (link.data && !relinking) {
    return (
      <div>
        <p className="flex items-center gap-2 text-[16px] font-medium">
          <span className="flex size-6 items-center justify-center rounded-full bg-good text-bg">
            <IconCheckDraw size={13} />
          </span>
          Payout wallet linked
        </p>
        <p className="mt-2 text-[13px] text-mut">
          Rewards approved for you are paid to this address. Linked {formatDate(link.data.verifiedAt)}.
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-card bg-card px-4 py-3 shadow-inner-card">
          <AddressLink address={link.data.walletAddress} full />
          <button onClick={() => setRelinking(true)} className="text-[13px] font-medium text-mut hover:text-ink">
            Change
          </button>
        </div>
        <GasStep address={link.data.walletAddress} className="mt-3" />
      </div>
    );
  }

  return (
    <div>
      <p className="flex items-center gap-2 text-[16px] font-medium">
        <IconWallet size={17} />
        {relinking ? "Link a different wallet" : "Link a payout wallet"}
      </p>
      <p className="mt-2 text-[13px] text-mut">
        A maintainer can only approve a reward for you once you have linked the wallet it should be paid to. You prove
        the wallet is yours by signing a short message. Signing is free and moves no money.
      </p>
      <div className="mt-4">
        <WalletGate reason="Connect the wallet you want rewards paid to.">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="accent" onClick={start} loading={busy}>
              {signer.busy ? "Waiting for signature" : "Sign message to link"}
            </Button>
            {wallet.address && <AddressLink address={wallet.address} />}
            {relinking && (
              <button onClick={() => setRelinking(false)} className="text-[13px] font-medium text-mut hover:text-ink">
                Cancel
              </button>
            )}
          </div>
        </WalletGate>
      </div>
      {signer.error && (
        <Notice tone="warning" className="mt-3" title={describeChainError(signer.error).title}>
          {describeChainError(signer.error).body}
        </Notice>
      )}
      {apiError && (
        <Notice tone="critical" className="mt-3" title="Couldn't link this wallet">
          {apiError.message}
        </Notice>
      )}
    </div>
  );
}
