"use client";

import { usePrivy } from '@privy-io/react-auth';
import { toast } from "sonner";
// import { MessageSquare } from "lucide-react";
import { Icons } from '@/app/components/sections/icons';

export function FarcasterPrivy() {
    const { linkFarcaster } = usePrivy();

    const handleLinkFarcaster = async () => {
        try {
            linkFarcaster();
        } catch (error) {
            console.log(error);
            toast.error("Failed to link Farcaster account");
        }
    };

    return (
        <div className="space-y-4 font-funnel-sans ">
            <div className="space-y-6">
                <p className="text-sm text-white/40">
                    Link your Farcaster account to enable social features.
                </p>
                <button
                    className="bg-[#8a63d2] text-white border border-black/40 px-4 py-2 rounded-full flex items-center gap-2"
                    onClick={handleLinkFarcaster}
                >
                    <Icons.farcasterWhiteIcon className="w-4 h-4" />
                    Farcaster
                </button>
            </div>
        </div>
    );
}
