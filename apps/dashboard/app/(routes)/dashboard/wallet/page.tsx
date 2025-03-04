"use client";

import { Minus } from "lucide-react";
import { Plus } from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function WalletPage() {
    const { status } = useSession();
    const router = useRouter();

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/signin");
        }
    }, [status, router]);

    if (status === "loading") {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-black text-xl">Loading...</div>
            </div>
        );
    }

    return (
        <div className="p-8">
            {/* Header with Balance and Actions */}
            <div className="flex justify-between items-start mb-12">
                <div>
                    <h2 className="text-gray-600 text-sm mb-2">Wallet balance</h2>
                    <h1 className="text-4xl font-bold">$ 0.00</h1>
                </div>
                <div className="flex gap-2">
                    <button className="px-2 py-3 rounded-lg flex flex-col items-center">
                        <Plus className="w-8 h-8 bg-gray-200 rounded-lg mb-1" />
                        <span className="text-sm text-gray-600">Deposit</span>
                    </button>
                    <button className="px-2 py-3 rounded-lg flex flex-col items-center">
                        <Minus className="w-8 h-8 bg-gray-200 rounded-lg mb-1" />
                        <span className="text-sm text-gray-600">Withdraw</span>
                    </button>
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