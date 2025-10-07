"use client";

import { useActiveWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { Icons } from "@/app/components/sections/icons";
import { useEffect, useState, useCallback, useMemo } from "react";
import clsx from "clsx";
import { toast } from "sonner";
import { Plus, Trash2, CheckCircle, ExternalLink } from "lucide-react";
import Image from "next/image";
import { Button } from "@/app/components/ui/button";
import { removeWalletAccount, syncWalletAccounts } from "@/actions/linked-accounts";
import { extractUserId } from "@/lib/utils";

export function WalletsSection() {
    const { user, linkWallet, unlinkWallet } = usePrivy();
    const { wallets: privyWallets, ready } = useWallets();
    const [hovered, setHovered] = useState<string | null>(null);
    const { wallet: activeWallet, setActiveWallet: setActiveWalletPrivy } = useActiveWallet();

    const wallets = useMemo(() =>
        user?.linkedAccounts?.filter((acc) => acc.type === "wallet") || [],
        [user?.linkedAccounts]
    );

    const handleSetActive = (address: string) => {
        const selectedWallet = privyWallets.find((wallet) => wallet.address === address);
        console.log(privyWallets, "privyWallets")
        console.log(selectedWallet, "selectedWallet")
        console.log(wallets, "wallets")
        if (selectedWallet) {
            setActiveWalletPrivy(selectedWallet);
            toast.success("Wallet set as active");
        }
    };

    const syncWalletsWithDatabase = useCallback(async () => {
        if (!user?.id) return;

        try {
            // Extract the user ID without the did:privy: prefix
            const userId = extractUserId(user.id);
            const result = await syncWalletAccounts(userId, user.linkedAccounts || []);
            console.log('Wallet sync result:', result);

            // Provide feedback if there were changes
            if (result.added > 0 || result.removed > 0) {
                const changes = [];
                if (result.added > 0) changes.push(`${result.added} wallet(s) added`);
                if (result.removed > 0) changes.push(`${result.removed} wallet(s) removed`);
                toast.success(`Wallet Connected Successfully`);
            }
        } catch (error) {
            console.error('Failed to sync wallets with database:', error);
            toast.error("Failed to sync wallet data");
        }
    }, [user?.id, user?.linkedAccounts]);

    useEffect(() => {
        if (ready) {
            console.log(user, 'user');
            console.log(privyWallets, 'all wallets');
            console.log(
                wallets,
                "wallets"
            )
        }
    }, [ready, privyWallets, user, wallets]);

    // Sync wallets with database when user changes or component mounts
    useEffect(() => {
        if (user?.id && ready) {
            syncWalletsWithDatabase();
        }
    }, [user?.id, ready, syncWalletsWithDatabase]);

    const handleConnectWallet = async () => {
        try {
            await linkWallet({
                walletList: ['metamask', 'rainbow', "detected_ethereum_wallets"],
                walletChainType: "ethereum-only"
            });

            // Sync with database after successful connection
            setTimeout(async () => {
                try {
                    await syncWalletsWithDatabase();
                } catch (syncError) {
                    console.error('Failed to sync wallet with database:', syncError);
                    toast.error("Wallet connected but failed to sync with database");
                }
            }, 1000); // Small delay to ensure Privy state is updated

        } catch (error) {
            console.error('Failed to connect wallet:', error);
            toast.error("Failed to connect wallet");
        }
    };

    const handleUnlinkWallet = async (address: string) => {
        try {
            await unlinkWallet(address);

            // Remove from database
            if (user?.id) {
                try {
                    // Extract the user ID without the did:privy: prefix
                    const userId = extractUserId(user.id);
                    const result = await removeWalletAccount(userId, address);
                    console.log('Wallet removal result:', result);
                } catch (dbError) {
                    console.error('Failed to remove wallet from database:', dbError);
                    toast.error("Wallet unlinked but failed to remove from database");
                    return;
                }
            }

            toast.success("Wallet unlinked successfully");
        } catch (error) {
            console.error('Failed to unlink wallet:', error);
            toast.error("Failed to unlink wallet");
        }
    };

    return (
        <div className="space-y-6">
            <div className="space-y-4">
                {wallets.length === 0 ? (
                    <div className="text-center py-8">
                        <div className="w-16 h-16 bg-black/5 rounded-full flex items-center justify-center mx-auto mb-4">
                            <ExternalLink className="w-8 h-8 text-black/40" />
                        </div>
                        <p className="text-black/60 font-funnel-sans text-lg mb-4">No wallets connected yet</p>
                        <p className="text-black/40 font-funnel-sans text-sm mb-6">Connect your first wallet to get started</p>
                        <Button
                            onClick={() => handleConnectWallet().then()}
                            className="bg-color2 hover:bg-color3 text-white font-funnel-display font-semibold rounded-full px-8 py-4 h-14 transition-all duration-200 hover:scale-105 shadow-lg"
                        >
                            <Plus className="w-5 h-5 mr-2" />
                            Connect Wallet
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {wallets.map((wallet) => {
                            const isEmbedded = wallet.connectorType === "embedded";
                            const isActive = activeWallet?.address === wallet.address;

                            // Determine wallet icon
                            let walletIcon = null;
                            let iconName = null;
                            if (!isEmbedded) {
                                iconName = (wallet.walletClientType || wallet.connectorType || "").toLowerCase();
                                const knownIcons = ["metamask", "phantom", "rainbow", "coinbase", "walletconnect"];
                                if (knownIcons.includes(iconName)) {
                                    walletIcon = (
                                        <Image
                                            src={`/images/wallet-icons/${iconName}.svg`}
                                            alt={iconName + " icon"}
                                            width={32}
                                            height={32}
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
                                        "group relative bg-black/5 border rounded-full px-6 py-4 transition-all duration-200 hover:bg-black/10",
                                        isActive
                                            ? "border-color6 bg-color6/10"
                                            : "border-black/10 hover:border-black/20"
                                    )}
                                    onMouseEnter={() => setHovered(wallet.address)}
                                    onMouseLeave={() => setHovered(null)}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className={clsx(
                                                "w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200",
                                                isActive ? "bg-color6" : "bg-black/10 group-hover:bg-black/20"
                                            )}>
                                                {isEmbedded ? (
                                                    <Icons.ethereum className="w-6 h-6 text-white" />
                                                ) : (
                                                    walletIcon || <Icons.sidebarWalletIcon className="w-6 h-6 text-white" />
                                                )}
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="font-mono text-black font-medium text-lg">
                                                    {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
                                                </span>
                                                <span className="text-black/60 font-funnel-sans text-sm">
                                                    {isEmbedded ? "Embedded Wallet" : "External Wallet"}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-3">
                                            {isActive && (
                                                <div className="flex items-center gap-2 px-3 py-1 bg-color6/20 rounded-full">
                                                    <CheckCircle className="w-4 h-4 text-color6" />
                                                    <span className="text-color6 font-funnel-sans text-sm font-medium">Active</span>
                                                </div>
                                            )}

                                            {!isActive && hovered === wallet.address && (
                                                <Button
                                                    onClick={() => handleSetActive(wallet.address)}
                                                    className="bg-color2 hover:bg-color3 text-white font-funnel-sans font-medium rounded-full px-4 py-2 h-8 transition-all duration-200 hover:scale-105 text-sm"
                                                >
                                                    Set Active
                                                </Button>
                                            )}

                                            {!isEmbedded && (
                                                <Button
                                                    variant="outline"
                                                    className="border-black/20 text-black/60 hover:text-black hover:bg-black/5 rounded-full p-2 h-8 w-8 transition-all duration-200 hover:scale-105"
                                                    title="Unlink Wallet"
                                                    onClick={() => handleUnlinkWallet(wallet.address)}
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {privyWallets.length > 0 && (
                <div className="pt-4 border-t border-black/10">
                    <Button
                        onClick={handleConnectWallet}
                        variant="outline"
                        className="border-black/20  bg-transparent text-black/80 hover:bg-black/5 rounded-full px-6 py-3 h-12 transition-all duration-200 hover:scale-105 w-full"
                    >
                        <Plus className="w-5 h-5 mr-2" />
                        Connect Another Wallet
                    </Button>
                </div>
            )}
        </div>
    );
} 