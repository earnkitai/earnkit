"use client";

import { useState } from "react";
import { injected, useConnect, useSignMessage } from 'wagmi';
import { SiweMessage } from "siwe";
import { toast } from "sonner";
import { User } from "@/types/user";
import { updateRecoveryAddress } from "@/actions/user";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/app/components/ui/dialog";
import { Icons } from "./icons";
import Link from "next/link";
import { Loader2, Check, AlertCircle, ChevronRight, XCircle } from "lucide-react";
import { truncateAddress } from "@/lib/utils";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
import { cn } from "@/lib/utils";
import { Separator } from "@/app/components/ui/separator";
import { Button } from "@/app/components/ui/button";

const baseURL =
    process.env.NEXT_PUBLIC_VERCEL_ENV === 'production'
        ? `https://${process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL}`
        : `http://localhost:3000`;

interface RecoveryAddressDialogProps {
    userData: User | null;
    setUserData: (user: User) => void;
    children: React.ReactNode;
}

type ConnectionStep = 'initial' | 'connecting' | 'signing' | 'completed' | 'error';
type ErrorType = 'connection' | 'signature' | 'update' | null;

export default function RecoveryAddressDialog({ userData, setUserData, children }: RecoveryAddressDialogProps) {
    const { connectAsync } = useConnect();
    const { signMessageAsync } = useSignMessage();
    const [isLoading, setIsLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [connectionStep, setConnectionStep] = useState<ConnectionStep>('initial');
    const [connectedAddress, setConnectedAddress] = useState<string>('');
    const [errorMessage, setErrorMessage] = useState<string>('');

    function createSiweMessage(address: `0x${string}`, statement: string) {
        const message = new SiweMessage({
            scheme: 'https',
            domain: process.env.NEXT_PUBLIC_VERCEL_ENV === 'production' ? `${process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL}` : "localhost:3000",
            address,
            statement,
            uri: baseURL,
            version: '1',
            chainId: 8453
        });
        return message.prepareMessage();
    }

    const handleError = (type: ErrorType, message: string) => {
        setErrorMessage(message);
        setConnectionStep('error');
        setIsLoading(false);
    };

    const resetState = () => {
        setErrorMessage('');
        setConnectionStep('initial');
        setIsLoading(false);
        setConnectedAddress('');
    };

    const handleConnectWallet = async () => {
        try {
            setIsLoading(true);
            setConnectionStep('connecting');
            setErrorMessage('');

            // Connect wallet
            const { accounts } = await connectAsync({
                connector: injected(),
            });

            const address = accounts[0];
            if (!address) {
                handleError('connection', 'No wallet address found. Please try again.');
                return;
            }
            setConnectedAddress(address);

            // Sign message
            setConnectionStep('signing');
            const message = createSiweMessage(
                address,
                'Sign in with Ethereum to verify wallet ownership'
            );
            try {
                const signature = await signMessageAsync({ message });
                if (!signature) {
                    handleError('signature', 'Failed to get signature. Please try again.');
                    return;
                }

                // Store the address as recovery address
                if (userData?.turnkeyUserId) {
                    const result = await updateRecoveryAddress(userData.turnkeyUserId, address, signature);
                    if (result.success) {
                        setConnectionStep('completed');
                        // Refresh user data
                        setUserData({ ...userData, recoveryAddress: address });
                        setTimeout(() => {
                            setConnectionStep('initial');
                            setIsOpen(false);
                            toast.success("Recovery address updated successfully!");
                        }, 2000);
                    } else {
                        handleError('update', result.error || "Failed to update recovery address");
                    }
                }
            } catch {
                handleError('signature', 'Failed to sign message. Please try again.');
            }
        } catch {
            handleError('connection', 'Failed to connect wallet. Please try again.');
        }
    };

    const ConnectionStatus = () => {
        if (connectionStep === 'initial') return null;

        if (connectionStep === 'error') {
            return (
                <div className="mt-6">
                    <Alert variant="destructive" className="bg-destructive/10 text-destructive border-destructive/20">
                        <XCircle className="h-4 w-4 text-destructive" />
                        <AlertDescription>
                            <div className="font-medium">Error</div>
                            <div className="mt-1 text-sm text-destructive/90">
                                {errorMessage}
                            </div>
                        </AlertDescription>
                    </Alert>
                    <Button
                        variant="outline"
                        className="w-full mt-4"
                        onClick={resetState}
                    >
                        Try Again
                    </Button>
                </div>
            );
        }

        return (
            <div className="mt-6 space-y-4">
                <div className="flex items-center gap-3">
                    <div className="flex h-6 w-6 items-center justify-center">
                        {connectionStep === 'connecting' ? (
                            <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        ) : (
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                                <Check className="h-3 w-3 text-primary-foreground" />
                            </div>
                        )}
                    </div>
                    <span className="text-sm text-muted-foreground">
                        {connectionStep === 'connecting' ? 'Connecting wallet...' : 'Wallet connected'}
                    </span>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex h-6 w-6 items-center justify-center">
                        {connectionStep === 'signing' ? (
                            <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        ) : connectionStep === 'completed' ? (
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                                <Check className="h-3 w-3 text-primary-foreground" />
                            </div>
                        ) : null}
                    </div>
                    <span className="text-sm text-muted-foreground">
                        {connectionStep === 'signing' ? 'Waiting for signature...' :
                            connectionStep === 'completed' ? 'Message signed' : ''}
                    </span>
                </div>

                {connectionStep === 'completed' && (
                    <div className="mt-6">
                        <Alert className="bg-primary/10 text-primary border-primary/20">
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                                <Check className="h-3 w-3 text-primary-foreground" />
                            </div>
                            <AlertDescription>
                                <div className="font-medium">Recovery address added!</div>
                                <div className="mt-1 text-sm text-primary/90">
                                    {truncateAddress(connectedAddress)}
                                </div>
                            </AlertDescription>
                        </Alert>
                    </div>
                )}
            </div>
        );
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => {
            setIsOpen(open);
            if (!open) resetState();
        }}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="sm:max-w-[425px] font-funnel-sans">
                <DialogHeader>
                    <DialogTitle className="text-xl">Connect Wallet</DialogTitle>
                    <DialogDescription className="text-base">
                        Connect your wallet to set it as your recovery address
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-6">
                    {connectionStep === 'initial' && (
                        <Alert variant="destructive" className="bg-warning/10 text-warning border-warning/20">
                            <AlertCircle className="h-4 w-4 text-warning" />
                            <AlertDescription className="text-sm">
                                Make sure you&apos;re connecting the correct wallet. This address will be used for account recovery.
                            </AlertDescription>
                        </Alert>
                    )}

                    {connectionStep !== "completed" && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between text-sm text-muted-foreground">
                                <span>Choose your wallet</span>
                                <span className="text-xs bg-muted px-2 py-1 rounded-full">Recommended</span>
                            </div>

                            <button
                                onClick={handleConnectWallet}
                                disabled={isLoading || connectionStep !== 'initial'}
                                className={cn(
                                    "w-full flex items-center justify-between rounded-xl border border-input bg-background p-4 text-left transition-colors",
                                    "hover:bg-accent hover:text-accent-foreground hover:border-accent-foreground/20",
                                    "disabled:cursor-not-allowed disabled:opacity-50",
                                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                )}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="rounded-lg p-2 bg-orange-50 dark:bg-orange-950">
                                        <Icons.metamask className="h-6 w-6" />
                                    </div>
                                    <div>
                                        <div className="font-medium">MetaMask</div>
                                        <div className="text-sm text-muted-foreground">Connect to your MetaMask wallet</div>
                                    </div>
                                </div>
                                <ChevronRight className="h-5 w-5 text-muted-foreground" />
                            </button>
                        </div>
                    )}

                    <ConnectionStatus />

                    {connectionStep === 'initial' && (
                        <>
                            <Separator />
                            <div className="text-center text-sm text-muted-foreground">
                                Haven&apos;t got a wallet?{" "}
                                <Link
                                    href="https://metamask.io/"
                                    className="text-primary hover:text-primary/90 underline-offset-4 hover:underline font-medium"
                                    target="_blank"
                                >
                                    Get started with MetaMask
                                </Link>
                            </div>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
} 