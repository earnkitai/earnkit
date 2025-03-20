"use client";
import { useEffect, useState } from "react";
import { Passkeys } from "@/app/components/sections/passkeys";
import { getUserByTurnkeyId, updateRecoveryAddress } from "@/actions/user";
import { useTurnkey } from "@turnkey/sdk-react";
import { User } from "@/types/user";
import { injected, useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi';
import { Button } from "@/app/components/ui/button";
import { toast } from "sonner";
import { SiweMessage } from "siwe";
import { truncateAddress } from "@/lib/utils";
import { FarcasterSection } from "./components/FarcasterSection";


const baseURL =
    process.env.NEXT_PUBLIC_VERCEL_ENV === 'production'
        ? `https://${process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL}`
        : `http://localhost:3000`;

export default function SettingsPage() {
    const [notifications, setNotifications] = useState(true);
    const [darkMode, setDarkMode] = useState(false);
    const { address, isConnected } = useAccount();
    const { connectAsync } = useConnect();
    const { disconnect } = useDisconnect();
    const { signMessageAsync } = useSignMessage();
    const [isLoading, setIsLoading] = useState(false);

    const { turnkey } = useTurnkey()
    const [userData, setUserData] = useState<User | null>(null);

    useEffect(() => {
        if (turnkey) {
            const fetchUser = async () => {
                try {
                    const currentUser = await turnkey.getCurrentUser();
                    if (currentUser?.userId) {
                        const result = await getUserByTurnkeyId(currentUser.userId);
                        if (result.success && result.data) {
                            console.log(result.data, "user data")
                            setUserData(result.data);
                        }
                    }
                } catch (error) {
                    console.error("Error fetching user profile:", error);
                }
            };
            fetchUser();
        }
    }, [turnkey]);

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

    const handleConnectWallet = async () => {
        try {
            setIsLoading(true);
            await connectAsync({
                connector: injected(),
            }).then(async (data) => {
                const address = data.accounts[0];
                if (!address) {
                    console.error("Wallet address is not available");
                    return;
                }

                const message = createSiweMessage(
                    address,
                    'Sign in with Ethereum to verify wallet ownership'
                );
                let signature: string = "";
                await signMessageAsync({
                    message,
                }).then(async (sig) => {
                    signature = sig;
                });

                // Store the address as recovery address
                if (userData?.turnkeyUserId) {
                    const result = await updateRecoveryAddress(userData.turnkeyUserId, address, signature);
                    if (result.success) {
                        toast.success("Recovery address updated successfully!");
                        // Refresh user data
                        const userResult = await getUserByTurnkeyId(userData.turnkeyUserId);
                        if (userResult.success && userResult.data) {
                            setUserData(userResult.data);
                        }
                    } else {
                        toast.error(result.error || "Failed to update recovery address");
                    }
                }

                console.log("Message signed successfully!", address);
                toast.success("Message signed successfully!");
            });
        } catch (error) {
            console.error("Error connecting wallet:", error);
            toast.error("Failed to connect wallet");
        } finally {
            setIsLoading(false);
        }
    };

    const handleDisconnectWallet = async () => {
        try {
            await disconnect();
            toast.success("Wallet disconnected successfully!");
        } catch (error) {
            console.error("Error disconnecting wallet:", error);
            toast.error("Failed to disconnect wallet");
        }
    };

    return (
        <div>
            <h1 className="text-2xl font-bold mb-0 p-8">Settings</h1>
            <div className="bg-white rounded-xl p-8 pt-2 shadow-sm">
                <div className="space-y-4">
                    <div>
                        <h2 className="text-sm font-medium text-gray-500">Username</h2>
                        <p className="mt-1 text-lg">{userData?.username || 'Not set'}</p>
                    </div>
                    <div>
                        <h2 className="text-sm font-medium text-gray-500">Email</h2>
                        <p className="mt-1 text-lg">{userData?.email || 'Not set'}</p>
                    </div>
                    <div>
                        <h2 className="text-sm font-medium text-gray-500">Wallet Address</h2>
                        <p className="mt-1 text-lg">{userData?.walletAddress || 'Not set'}</p>
                    </div>
                </div>
                <div className="mt-6">
                    <Passkeys />
                </div>
            </div>
            <div className="bg-white rounded-xl p-8 shadow-sm mt-6">
                <h2 className="text-xl font-medium mb-4">Recovery Wallet Address</h2>
                <div className="space-y-4">
                    {userData?.recoveryAddress ? (
                        <div className="space-y-4">
                            <div>
                                <h3 className="text-sm font-medium text-gray-500">Current Recovery Address</h3>
                                <div className="flex items-center gap-2 mt-1">
                                    <p className="text-lg">{truncateAddress(userData.recoveryAddress)}</p>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => {
                                            navigator.clipboard.writeText(userData.recoveryAddress!);
                                            toast.success("Address copied to clipboard");
                                        }}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>
                                    </Button>
                                </div>
                            </div>
                            {isConnected ? (
                                <div className="space-y-4">
                                    <div>
                                        <h3 className="text-sm font-medium text-gray-500">New Address</h3>
                                        <p className="mt-1 text-lg">{address}</p>
                                    </div>
                                    <div className="flex gap-4">
                                        <Button
                                            onClick={handleConnectWallet}
                                            disabled={isLoading}
                                        >
                                            {isLoading ? "Updating..." : "Update Recovery Address"}
                                        </Button>
                                        <Button
                                            variant="destructive"
                                            onClick={handleDisconnectWallet}
                                        >
                                            Disconnect Wallet
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <Button
                                    onClick={handleConnectWallet}
                                    disabled={isLoading}
                                >
                                    {isLoading ? "Connecting..." : "Update Recovery Address"}
                                </Button>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <p className="text-sm text-gray-500">No recovery address set. Connect your wallet to add one.</p>
                            {isConnected ? (
                                <div className="space-y-4">
                                    <div>
                                        <h3 className="text-sm font-medium text-gray-500">Connected Address</h3>
                                        <p className="mt-1 text-lg">{address}</p>
                                    </div>
                                    <div className="flex gap-4">
                                        <Button
                                            onClick={handleConnectWallet}
                                            disabled={isLoading}
                                        >
                                            {isLoading ? "Adding..." : "Add Recovery Address"}
                                        </Button>
                                        <Button
                                            variant="destructive"
                                            onClick={handleDisconnectWallet}
                                        >
                                            Disconnect Wallet
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <Button
                                    onClick={handleConnectWallet}
                                    disabled={isLoading}
                                >
                                    {isLoading ? "Connecting..." : "Add Recovery Address"}
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            </div>
            <FarcasterSection userData={userData} setUserData={setUserData} />
            <div className="bg-white rounded-xl p-8 shadow-sm mt-6">
                <h2 className="text-xl font-medium mb-4">Preferences</h2>
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-medium">Notifications</h3>
                            <p className="text-gray-500 text-sm">Receive email notifications</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={notifications}
                                onChange={() => setNotifications(!notifications)}
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                        </label>
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-medium">Dark Mode</h3>
                            <p className="text-gray-500 text-sm">Switch between light and dark themes</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={darkMode}
                                onChange={() => setDarkMode(!darkMode)}
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                        </label>
                    </div>
                </div>
            </div>
        </div>
    );
} 