"use client";

import { useSetWalletRecovery, usePrivy, type Wallet } from '@privy-io/react-auth';
import { toast } from "sonner";
import { Shield, Download } from "lucide-react";

export function EmbeddedWalletSection() {
    const { setWalletRecovery } = useSetWalletRecovery({
        onSuccess: ({ method, wallet }: {
            method: string;
            wallet: Wallet;
        }) => {
            console.log('Successfully enrolled auth factor', { method, wallet });
            toast.success("Recovery password set successfully");
        },
        onError: (error) => {
            console.log('Failed to enroll auth factor with error ', error);
            toast.error("Failed to set recovery password");
        }
    });

    const { exportWallet } = usePrivy();

    const handleSetRecoveryPassword = async () => {
        try {
            await setWalletRecovery();
        } catch (error) {
            console.log(error);
            toast.error("Failed to set recovery password");
        }
    };

    const handleExportWallet = async () => {
        try {
            await exportWallet();
        } catch (error) {
            console.log(error);
        }
    };

    return (
        <div className="space-y-6 font-funnel-sans">
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <h3 className="text-base sm:text-lg font-medium text-white/40">Recovery Options</h3>
                </div>
                <div className="space-y-2">
                    <p className="text-sm text-white/40">
                        Set a recovery password to help you recover your wallet if you lose access.
                    </p>
                    <button
                        className="bg-transparent text-white/80 border border-white/40 px-10 py-5 h-16 rounded-full hover:text-white hover:border-white flex items-center gap-2"
                        onClick={handleSetRecoveryPassword}
                    >
                        <Shield className="w-4 h-4" />
                        Set Recovery Password
                    </button>
                </div>
            </div>

            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <h3 className="text-base sm:text-lg font-medium text-white/40">Export Options</h3>
                </div>
                <div className="space-y-2">
                    <p className="text-sm text-white/40">
                        Export your wallet to use it with other applications or as a backup.
                    </p>
                    <button
                        className="bg-transparent text-white/80 border border-white/40 px-10 py-5 h-16 rounded-full hover:text-white hover:border-white flex items-center gap-2"
                        onClick={handleExportWallet}
                    >
                        <Download className="w-4 h-4" />
                        Export Wallet
                    </button>
                </div>
            </div>
        </div>
    );
} 