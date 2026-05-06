"use client";

import { useHeadlessDelegatedActions, usePrivy, type WalletWithMetadata } from '@privy-io/react-auth';
import { toast } from "sonner";

export function RevokeAccessButton() {
    const { user } = usePrivy();
    // const { removeSessionSigners } = useSessionSigners();
    const { revokeWallets } = useHeadlessDelegatedActions();

    const hasDelegatedWallets =
        user?.linkedAccounts?.filter(
            (account): account is WalletWithMetadata => account.type === 'wallet' && account.delegated
        ).length !== 0;

    const onRevoke = async () => {
        if (!hasDelegatedWallets) return;
        try {
            // await removeSessionSigners({
            //     address: user?.wallet?.address as `0x${string}`
            // });
            await revokeWallets()
            toast.success("Access revoked successfully");
        } catch (error) {
            console.error(error);
            toast.error("Failed to revoke access");
        }
    };

    return (
        <div className="space-y-4 font-funnel-sans">
            <p className="text-sm text-muted-foreground">Access is currently delegated</p>
            <button
                className="bg-destructive text-white px-4 py-2 rounded-full hover:bg-destructive/90 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={onRevoke}
                disabled={!hasDelegatedWallets}
            >
                Revoke Access
            </button>
        </div>
    );
}
