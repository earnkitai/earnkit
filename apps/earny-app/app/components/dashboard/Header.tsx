"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function DashboardHeader() {
    const pathname = usePathname();
    return (
        <header className="bg-white py-4 px-8">
            <div className="flex justify-end mb-8">
                {/* hide this if the route is /dashboard/create-agent */}
                {pathname !== "/home/create-agent" && (
                    <Link
                        href="/home/create-agent"
                        className="bg-primary text-white px-6 py-2 rounded-full hover:bg-primary/90 transition-colors flex items-center gap-2"
                    >
                        <Plus className="w-4 h-4" />
                        <span>Create</span>
                    </Link>
                )}
            </div>
        </header>
    );
} 