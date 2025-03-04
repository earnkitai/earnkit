import { ReactNode } from "react";
import DashboardSidebar from "@/app/components/dashboard/Sidebar";

export default function DashboardLayout({
    children,
}: {
    children: ReactNode;
}) {
    return (
        <div className="min-h-screen bg-white flex font-funnel-sans">
            {/* Sidebar */}
            <DashboardSidebar />

            {/* Main Content */}
            <div className="flex-1 ml-[250px]">
                {children}
            </div>
        </div >
    );
} 