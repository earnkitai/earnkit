import { ReactNode } from "react";
import Sidebar from "@/app/components/dashboard/Sidebar";
import { Toaster } from "@/app/components/ui/sonner";


export default function Layout({
    children,
}: {
    children: ReactNode;
}) {
    return (
        <div className="min-h-screen flex font-funnel-sans items-center">

            <Sidebar />
            {/* Main Content */}
            <div className="flex-1 w-[calc(100% - 200px)] ml-[200px] overflow-x-hidden overflow-y-auto p-[35px] pt-32">
                <div className="pb-[20px]">
                    {children}
                </div>
            </div>
            <Toaster />
        </div >
    );
} 