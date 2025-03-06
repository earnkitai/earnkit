import { ReactNode } from "react";
import DashboardSidebar from "@/app/components/dashboard/Sidebar";
import { WalletsProvider } from "@/providers/wallet-provider";
import { Toaster } from "@/app/components/ui/sonner";
import { TransactionsProvider } from "@/providers/transactions-provider";

export default function DashboardLayout({
    children,
}: {
    children: ReactNode;
}) {
    return (
        <div className="min-h-screen bg-white flex font-funnel-sans">
            {/* Sidebar */}

            <WalletsProvider>
                <TransactionsProvider>
                    <DashboardSidebar />

                    {/* Main Content */}
                    <div className="flex-1 ml-[250px]">
                        {children}
                    </div>
                </TransactionsProvider>
            </WalletsProvider>

            <Toaster />
        </div >
    );
} 