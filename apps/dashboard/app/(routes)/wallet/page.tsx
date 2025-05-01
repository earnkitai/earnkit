"use client";

import { Skeleton } from "@/app/components/ui/skeleton";
import { truncateAddress } from "@/lib/utils";
import { useFundWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { ArrowDown, ArrowUp, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
// import TransferDialog from "@/app/components/sections/transfer-dialog";
import Assets from "@/app/components/sections/assets";
// import Activity from "@/app/components/sections/activity";
import { Toaster } from "@/app/components/ui/sonner";
import { Button } from "@/app/components/ui/button";
import { SendTransactionModal } from '@/components/modals/send-transaction-modal';


export default function WalletPage() {
    // const { user } = useUser();
    const { ready: privyReady, authenticated, user: privyUser } = usePrivy();
    const [totalValue, setTotalValue] = useState<number>(0);
    const [walletAddress, setWalletAddress] = useState<`0x${string}` | null>(null);
    // const { state } = useWallets();  
    const { fundWallet } = useFundWallet();
    const { ready: privyWalletReady, wallets } = useWallets();
    const [isSendModalOpen, setIsSendModalOpen] = useState(false);


    useEffect(() => {
        if (privyReady && authenticated) {
            console.log(privyUser, "privy user details")
        }
    }, [privyReady, privyUser, authenticated]);

    useEffect(() => {
        if (privyWalletReady && wallets.length > 0) {
            console.log("Wallets ready");
            console.log(wallets)
            setWalletAddress(wallets[0].address as `0x${string}`)
        }
    }, [privyWalletReady, wallets]);

    const handleCopyAddress = () => {
        if (privyWalletReady && wallets.length > 0) {
            navigator.clipboard.writeText(wallets[0].address)
            toast.success("Address copied to clipboard")
        }
    }

    const handleAddFunds = async () => {
        await fundWallet(walletAddress!);
    }

    return (
        <section className="p-6 sm:p-8 pb-20 pt-20 md:pb-12 md:pt-10 max-w-4xl mx-auto">
            {/* Header with Balance and Actions */}
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 sm:gap-0 mb-8 sm:mb-12">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold mb-0 py-4 text-foreground">Wallet</h1>
                    {walletAddress ? (
                        <div
                            onClick={handleCopyAddress}
                            className="flex w-min cursor-pointer items-center gap-1 sm:gap-2 text-sm sm:text-base"
                        >
                            {truncateAddress(walletAddress)}
                            <CopyIcon className="h-3 w-3 sm:h-4 sm:w-4" />
                        </div>
                    ) : (
                        <Skeleton className="h-3 w-24 sm:w-32 rounded-sm bg-muted-foreground/50" />
                    )}
                    <h1 className="text-2xl sm:text-4xl font-bold mt-1 sm:mt-2">${totalValue.toFixed(2)} <span className="ml-1 text-xs sm:text-sm text-muted-foreground">USD</span></h1>
                </div>
                <div className="flex gap-2">

                    <Button
                        onClick={() => setIsSendModalOpen(true)}
                        variant="secondary"
                        className="border border-gray-300 hover:border-gray-400 hover:bg-gray-50"
                    >
                        <ArrowUp className="mr-2 h-4 w-4" />
                        Send
                    </Button>
                    <Button
                        onClick={() => handleAddFunds()}
                        variant="secondary"
                        className="border border-gray-300 hover:border-gray-400 hover:bg-gray-50"
                    >
                        <ArrowDown className="mr-2 h-4 w-4" />
                        Receive
                    </Button>


                </div>
            </div>
            {/* Assets Section */}
            {walletAddress && (
                <div className="mt-8 sm:mt-12">
                    <Assets onTotalValueChange={setTotalValue} walletAddress={walletAddress} />
                </div>
            )}

            {/* Activity Log Section */}
            <div className="mt-8 sm:mt-12">
                {/* <Activity /> */}
            </div>

            <SendTransactionModal
                isOpen={isSendModalOpen}
                onClose={() => setIsSendModalOpen(false)}
            />

            <Toaster />
        </section>
    );
} 