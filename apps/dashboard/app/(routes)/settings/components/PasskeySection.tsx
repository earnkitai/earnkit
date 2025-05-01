"use client";

import { usePrivy } from '@privy-io/react-auth';
import { toast } from "sonner";
import { Key } from "lucide-react";

export function PasskeySection() {
    const { linkPasskey } = usePrivy();

    const handleLinkPasskey = async () => {
        try {
            linkPasskey();
        } catch (error) {
            console.log(error);
            toast.error("Failed to link passkey");
        }
    };

    return (
        <div className="space-y-4 font-funnel-sans">
            <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                    Link a passkey for secure and convenient authentication.
                </p>
                <button
                    className="bg-transparent text-black border border-black/40 px-4 py-2 rounded-md hover:bg-black/4 flex items-center gap-2"
                    onClick={handleLinkPasskey}
                >
                    <Key className="w-4 h-4" />
                    Link Passkey
                </button>
            </div>
        </div>
    );
} 