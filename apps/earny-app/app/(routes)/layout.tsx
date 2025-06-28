import { ReactNode } from "react";
import Sidebar from "@/app/components/dashboard/Sidebar";
// import { WalletsProvider } from "@/providers/wallet-provider";
import { Toaster } from "@/app/components/ui/sonner";
import NewFooter from "../components/common/NewFooter";
// import { BalanceProvider } from "@/providers/balance-provider";
// import { TransactionsProvider } from "@/providers/transactions-provider";

export default function Layout({
    children,
}: {
    children: ReactNode;
}) {
    return (
        <div className="min-h-screen flex font-funnel-sans items-center">
            {/* Sidebar */}
            {/* <WalletsProvider> */}
            {/* <TransactionsProvider> */}
            {/* <BalanceProvider> */}
            <Sidebar />

            {/* Main Content */}
            <div className="flex-1 w-[calc(100% - 200px)] ml-[200px] overflow-x-hidden overflow-y-auto p-[20px]">
                <div className="pb-[20px]">
                    {children}
                </div>
                <NewFooter />
            </div>
            {/* </BalanceProvider> */}
            {/* </TransactionsProvider> */}
            {/* </WalletsProvider> */}

            <Toaster />
        </div >
    );
} 