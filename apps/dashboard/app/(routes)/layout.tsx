import { ReactNode } from "react";
import Sidebar from "@/app/components/dashboard/Sidebar";
// import { WalletsProvider } from "@/providers/wallet-provider";
import { Toaster } from "@/app/components/ui/sonner";
// import { TransactionsProvider } from "@/providers/transactions-provider";

export default function Layout({
    children,
}: {
    children: ReactNode;
}) {
    return (
        <div className="min-h-screen bg-white flex font-funnel-sans flex-col items-center">
            {/* Sidebar */}
            {/* <WalletsProvider> */}
            {/* <TransactionsProvider> */}
            <Sidebar />

            {/* Main Content */}
            <div className="flex-1 w-full">
                {children}
            </div>
            {/* </TransactionsProvider> */}
            {/* </WalletsProvider> */}

            <Toaster />
        </div >
    );
} 