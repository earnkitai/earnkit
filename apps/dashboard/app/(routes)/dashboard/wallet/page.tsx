"use client";

import { Skeleton } from "@/app/components/ui/skeleton";
import { useTokenPrice } from "@/hooks/use-token-price";
import { useUser } from "@/hooks/use-user";
import { truncateAddress } from "@/lib/utils";
import { useWallets } from "@/providers/wallet-provider";
import { CopyIcon } from "lucide-react";
// import { Plus } from "lucide-react";
// import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatEther } from "viem";
import { toast } from "sonner";
import TransferDialog from "@/app/components/sections/transfer-dialog";

export default function WalletPage() {
    const { user } = useUser();
    const [usdAmount, setUsdAmount] = useState<number | undefined>(undefined)
    const { ethPrice } = useTokenPrice()
    // const router = useRouter();
    const { state } =
        useWallets()
    const { selectedAccount } = state

    useEffect(() => {
        if (!user) {
            console.log("No user found");
            // router.push("/");
        }
    }, [user]);

    const handleCopyAddress = () => {
        if (selectedAccount?.address) {
            navigator.clipboard.writeText(selectedAccount.address)
            toast.success("Address copied to clipboard")
        }
    }

    useEffect(() => {
        if (ethPrice && selectedAccount?.balance !== undefined) {
            const balanceInEther = formatEther(selectedAccount?.balance)
            setUsdAmount(Number(balanceInEther) * ethPrice)
        }
    }, [ethPrice, selectedAccount?.balance])

    return (
        <div className="p-8">
            {/* Header with Balance and Actions */}
            <div className="flex justify-between items-start mb-12">
                <div>
                    <h2 className="text-gray-600 text-sm mb-2">Wallet</h2>
                    {/* {selectedWallet?.walletName || (
                        <Skeleton className="h-4 w-20 bg-muted-foreground/50" />
                    )} */}
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
                    <h1 className="text-4xl font-bold">${usdAmount?.toFixed(2) || "0.00"} <span className="ml-1 text-sm text-muted-foreground">USD</span></h1>
                </div>
                <div className="flex gap-2">
                    {/* <button className="px-2 py-3 rounded-lg flex flex-col items-center">
                        <Plus className="w-8 h-8 bg-gray-200 rounded-lg mb-1" />
                        <span className="text-sm text-gray-600">Deposit</span>
                    </button>
                    <button className="px-2 py-3 rounded-lg flex flex-col items-center">
                        <Minus className="w-8 h-8 bg-gray-200 rounded-lg mb-1" />
                        <span className="text-sm text-gray-600">Withdraw</span>
                    </button> */}
                    <TransferDialog />
                </div>
            </div>

            {/* Assets Section */}
            <div className="mb-12">
                <h2 className="text-xl font-semibold mb-4">Assets</h2>
                <div className="bg-gray-50 rounded-xl p-8 flex items-center justify-center">
                    <span className="text-gray-500">You don&apos;t have any assets</span>
                </div>
            </div>

            {/* Activity Log Section */}
            <div>
                <h2 className="text-xl font-semibold mb-4">Activity log</h2>
                <div className="bg-gray-50 rounded-xl p-8 flex items-center justify-center">
                    <span className="text-gray-500">No activity yet</span>
                </div>
            </div>
        </div>
    );
} 