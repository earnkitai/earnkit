"use client";

import { useConnectWallet } from '@privy-io/react-auth';
import { toast } from "sonner";
import { Wallet } from "lucide-react";

export function ExternalWalletSection() {
    const { connectWallet } = useConnectWallet({
        onSuccess: ({ wallet }) => {
            console.log('Successfully connected wallet', wallet);
            toast.success("Wallet connected successfully");
        },
        onError: (error) => {
            console.log('Failed to connect wallet', error);
            toast.error("Failed to connect wallet");
        },
    });

    const handleConnectWallet = async () => {
        try {
            connectWallet({
                walletList: ['metamask', "detected_ethereum_wallets", "detected_solana_wallets"],
                walletChainType: "ethereum-and-solana"
            });
        } catch (error) {
            console.log(error);
            toast.error("Failed to connect wallet");
        }
    };

    return (
        <div className="space-y-4 font-funnel-sans">
            <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                    Connect an external wallet to use with your account.
                </p>
                <button
                    className="bg-transparent text-black border border-black/40 px-4 py-2 rounded-md hover:bg-black/4 flex items-center gap-2"
                    onClick={handleConnectWallet}
                >
                    <Wallet className="w-4 h-4" />
                    Connect Wallet
                </button>
            </div>
        </div>
    );
} 