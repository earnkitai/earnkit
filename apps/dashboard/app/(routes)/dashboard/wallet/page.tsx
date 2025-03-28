"use client";

import { Skeleton } from "@/app/components/ui/skeleton";
import { useUser } from "@/hooks/use-user";
import { truncateAddress } from "@/lib/utils";
import { useWallets } from "@/providers/wallet-provider";
import { CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import TransferDialog from "@/app/components/sections/transfer-dialog";
import Assets from "@/app/components/sections/assets";
import Activity from "@/app/components/sections/activity";
import { Toaster } from "@/app/components/ui/sonner";

export default function WalletPage() {
    const { user } = useUser();
    const [totalValue, setTotalValue] = useState<number>(0);
    const { state } = useWallets();
    const { selectedAccount } = state;

    useEffect(() => {
        if (!user) {
            console.log("No user found");
        }
    }, [user]);

    const handleCopyAddress = () => {
        if (selectedAccount?.address) {
            navigator.clipboard.writeText(selectedAccount.address)
            toast.success("Address copied to clipboard")
        }
    }

    return (
        <div className="p-8 pb-20">
            {/* Header with Balance and Actions */}
            <div className="flex justify-between items-start mb-12">
                <div>
                    <h2 className="text-gray-600 text-sm mb-2">Wallet</h2>
                    {selectedAccount?.address ? (
                        <div
                            onClick={handleCopyAddress}
                            className="flex w-min cursor-pointer items-center gap-2"
                        >
                            {truncateAddress(selectedAccount?.address)}
                            <CopyIcon className="h-3 w-3" />
                        </div>
                    ) : (
                        <Skeleton className="h-3 w-32  rounded-sm bg-muted-foreground/50" />
                    )}
                    <h1 className="text-4xl font-bold">${totalValue.toFixed(2)} <span className="ml-1 text-sm text-muted-foreground">USD</span></h1>
                </div>
                <div className="flex gap-2">
                    <TransferDialog />
                </div>
            </div>

            {/* Assets Section */}
            <div className="mt-12">
                <Assets onTotalValueChange={setTotalValue} />
            </div>

            {/* Activity Log Section */}
            <div className="mt-12">
                <Activity />
            </div>

            <Toaster />
        </div>
    );
} 