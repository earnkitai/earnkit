"use client";

import { useRouter } from "next/navigation";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/app/components/ui/dialog";
import { Button } from "@/app/components/ui/button";
import { Key, Wallet } from "lucide-react";

interface PrerequisiteModalProps {
    isOpen: boolean;
    onClose: () => void;
    missingPrerequisites: {
        apiKey: boolean;
        wallet: boolean;
    };
}

export function PrerequisiteModal({
    isOpen,
    onClose,
    missingPrerequisites
}: PrerequisiteModalProps) {
    const router = useRouter();

    const handleGoToSettings = () => {
        onClose();
        router.push("/settings");
    };

    const getTitle = () => {
        const missingCount = Object.values(missingPrerequisites).filter(Boolean).length;
        if (missingCount > 1) {
            return "Setup Required";
        }
        return missingPrerequisites.apiKey ? "API Key Required" : "Wallet Required";
    };

    const getDescription = () => {
        const missingCount = Object.values(missingPrerequisites).filter(Boolean).length;
        if (missingCount > 1) {
            return "Complete the following setup to create your first agent:";
        }
        return missingPrerequisites.apiKey
            ? "Create an API key to authenticate with our services."
            : "Connect a wallet to enable transactions for your agent.";
    };

    return (

        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-lg bg-white">
                <DialogHeader className="text-center mb-8">

                    <DialogTitle className="text-2xl font-bold font-funnel-display text-color2 mb-2">
                        {getTitle()}
                    </DialogTitle>
                    <DialogDescription className="text-black/60 font-funnel-sans text-lg leading-relaxed">
                        {getDescription()}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 mb-8">
                    {missingPrerequisites.apiKey && (
                        <div className="flex items-center gap-4 p-6 bg-white/5 border border-black/10 rounded-[20px]">
                            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                                <Key className="h-6 w-6 text-blue-600" />
                            </div>
                            <div className="flex-1">
                                <h4 className="font-semibold text-black font-funnel-sans text-lg mb-1">API Key</h4>
                                <p className="text-black/60 font-funnel-sans text-sm leading-relaxed">
                                    Generate a secure API key for programmatic access to our services
                                </p>
                            </div>
                        </div>
                    )}

                    {missingPrerequisites.wallet && (
                        <div className="flex items-center gap-4 p-6 bg-white/5 border border-black/10 rounded-[20px]">
                            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                                <Wallet className="h-6 w-6 text-green-600" />
                            </div>
                            <div className="flex-1">
                                <h4 className="font-semibold text-black font-funnel-sans text-lg mb-1">Connected Wallet</h4>
                                <p className="text-black/60 font-funnel-sans text-sm leading-relaxed">
                                    Link your wallet to enable secure transactions and payments
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter className="flex flex-col sm:flex-row gap-4 pt-6">
                    <Button
                        variant="outline"
                        onClick={onClose}
                        className="w-full sm:w-auto border-black/20 bg-transparent text-black/80 hover:bg-black/5 rounded-full px-8 py-4 h-14 transition-all duration-200 hover:scale-105 font-funnel-sans"
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleGoToSettings}
                        className="w-full sm:w-auto bg-color2 hover:bg-color3 text-white font-funnel-display font-semibold rounded-full px-8 py-4 h-14 transition-all duration-200 hover:scale-105 shadow-lg"
                    >
                        Go to Settings
                    </Button>
                </DialogFooter>

            </DialogContent>
        </Dialog>

    );
}
