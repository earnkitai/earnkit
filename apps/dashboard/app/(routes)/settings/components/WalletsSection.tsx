"use client";

import { useActiveWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { Icons } from "@/app/components/sections/icons";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import Image from "next/image";

export function WalletsSection() {
    const { user, linkWallet, unlinkWallet } = usePrivy();
    const { wallets: privyWallets, ready } = useWallets();
    const [hovered, setHovered] = useState<string | null>(null);
    const { wallet: activeWallet, setActiveWallet: setActiveWalletPrivy } = useActiveWallet();
    // const [activeWallet, setActiveWallet] = useState<string | null>(user?.wallet?.address || null);

    const wallets = user?.linkedAccounts?.filter((acc) => acc.type === "wallet") || [];

    const handleSetActive = (address: string) => {
        const selectedWallet = privyWallets.find((wallet) => wallet.address === address);
        if (selectedWallet) {
            setActiveWalletPrivy(selectedWallet);
        }
        // TODO: Add logic to persist active wallet if needed
    };

    useEffect(() => {
        if (ready) {
            console.log(privyWallets, 'wallets');
        }
    }, [ready, privyWallets]);

    const handleConnectWallet = async () => {
        try {
            linkWallet({
                walletList: ['metamask', 'phantom', 'rainbow', "detected_ethereum_wallets", "detected_solana_wallets"],
                walletChainType: "ethereum-and-solana"
            });
        } catch (error) {
            console.log(error);
            toast.error("Failed to connect wallet");
        }
    };



    return (
        <div className="bg-card rounded-xl p-4 sm:p-8 shadow-sm mt-4 sm:mt-6 border mx-4 sm:mx-8">
            <h2 className="text-lg sm:text-xl font-medium mb-3 sm:mb-4 text-foreground flex items-center gap-2">
                Wallets
            </h2>
            <p className="text-sm text-muted-foreground mb-4">Connect and link wallets to your account.</p>
            <div className="space-y-3">
                {wallets.length === 0 && (
                    <div className="text-muted-foreground text-sm">No wallets linked.</div>
                )}
                {wallets.map((wallet) => {
                    const isEmbedded = wallet.connectorType === "embedded";
                    const isActive = activeWallet?.address === wallet.address;

                    // Determine wallet icon
                    let walletIcon = null;
                    let iconName = null;
                    if (!isEmbedded) {
                        // Try walletClientType or connectorType for icon name
                        iconName = (wallet.walletClientType || wallet.connectorType || "").toLowerCase();
                        // Only allow certain names (add more as needed)
                        const knownIcons = ["metamask", "phantom", "rainbow", "coinbase", "walletconnect"];
                        if (knownIcons.includes(iconName)) {
                            walletIcon = (
                                <Image
                                    src={`/images/wallet-icons/${iconName}.svg`}
                                    alt={iconName + " icon"}
                                    width={24}
                                    height={24}
                                    className="rounded-full"
                                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                />
                            );
                        }
                    }

                    return (
                        <div
                            key={wallet.address}
                            className={clsx(
                                "max-w-[320px] flex items-center gap-3 border rounded-md px-3 py-2 transition-all",
                                isActive ? "border-primary bg-primary/5" : "border-black/20 bg-transparent",
                                "relative group"
                            )}
                            onMouseEnter={() => setHovered(wallet.address)}
                            onMouseLeave={() => setHovered(null)}
                        >
                            <span className="w-7 h-7 flex items-center justify-center">
                                {isEmbedded ? (
                                    <Icons.ethereum className="w-6 h-6" />
                                ) : (
                                    walletIcon || <Icons.sidebarWalletIcon className="w-6 h-6" />
                                )}
                            </span>
                            <span className="font-mono text-base text-foreground">
                                {wallet.address.slice(0, 6)}...{wallet.address.slice(-3)}
                            </span>
                            {isActive && (
                                <span className="ml-auto px-2 py-0.5 rounded bg-gradient-to-r from-pink-400 to-indigo-400 text-xs text-white font-semibold">Active</span>
                            )}
                            {!isActive && hovered === wallet.address && (
                                <button
                                    className="ml-auto px-2 py-0.5 rounded border border-primary text-primary text-xs font-semibold hover:bg-primary/10 transition"
                                    onClick={() => handleSetActive(wallet.address)}
                                >
                                    Set Active
                                </button>
                            )}
                            {/* Unlink icon for external wallets */}
                            {!isEmbedded && (
                                <button
                                    className="ml-auto p-1 rounded hover:bg-destructive/10 text-destructive transition relative group/unlink"
                                    title="Unlink Wallet"
                                    onClick={() => {
                                        unlinkWallet(wallet.address);
                                        toast.success("Wallet unlinked");
                                    }}
                                >
                                    <Trash2 className="w-4 h-4" />
                                    <span className="absolute left-1/2 -translate-x-1/2 top-full mt-1 text-xs bg-black text-white rounded px-2 py-0.5 opacity-0 group-hover/unlink:opacity-100 pointer-events-none z-10">Unlink Wallet</span>
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="mt-4">
                <button
                    className="bg-transparent text-black border border-black/40 px-4 py-2 rounded-md hover:bg-black/4 flex items-center gap-2"
                    onClick={handleConnectWallet}
                >
                    <Plus className="w-4 h-4" />
                    Link a Wallet
                </button>

            </div>
        </div>
    );
} 