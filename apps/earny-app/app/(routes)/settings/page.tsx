"use client";
import { useEffect, useState } from "react";
// import { Passkeys } from "@/app/components/sections/passkeys";
// import { getUserByTurnkeyId } from "@/actions/user";
// import { useTurnkey } from "@turnkey/sdk-react";
import { toast } from "sonner";
// import { truncateAddress } from "@/lib/utils";
// import RecoveryAddressDialog from "@/app/components/sections/recovery-address-dialog";
// import { useTheme } from "@/providers/theme-provider";
import { useActiveWallet, useDelegatedActions, usePrivy, useWallets, WalletWithMetadata } from "@privy-io/react-auth";
// import { useSessionSigners } from "@privy-io/react-auth";
import { RevokeAccessButton } from "@/app/(routes)/settings/components/RevokeAccessButton";
import { EmbeddedWalletSection } from "@/app/(routes)/settings/components/EmbeddedWalletSection";
import { PasskeySection } from "@/app/(routes)/settings/components/PasskeySection";
import { FarcasterPrivy } from "@/app/(routes)/settings/components/FarcasterPrivy";
import { findUsernameByUserId, updateUser } from "@/actions/user";
import { WalletsSection } from "@/app/(routes)/settings/components/WalletsSection";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { User, Shield, Wallet, Key } from "lucide-react";
import { Icons } from "@/app/components/sections/icons";

export default function SettingsPage() {
    // const [notifications, setNotifications] = useState(true);
    const { ready, authenticated, user } = usePrivy();
    // const { theme, setTheme } = useTheme();
    // const { addSessionSigners } = useSessionSigners();

    const { delegateWallet } = useDelegatedActions();

    // const { turnkey } = useTurnkey()
    const [isDelegated, setIsDelegated] = useState(false);
    const [username, setUsername] = useState<string | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [newUsername, setNewUsername] = useState("");
    const { wallets, ready: walletsReady } = useWallets();
    const { wallet: activeWallet } = useActiveWallet()

    useEffect(() => {
        if (ready && authenticated && user?.id) {
            const userId = user.id.split(':').pop() || user.id;
            const fetchUsername = async () => {
                try {
                    const fetchedUsername = await findUsernameByUserId(userId);
                    setUsername(fetchedUsername || null);
                } catch (error) {
                    console.error("Error fetching username:", error);
                }
            };
            fetchUsername();
        }
    }, [ready, authenticated, user]);

    const handleUsernameUpdate = async () => {
        if (!user?.id || !newUsername.trim()) return;

        try {
            const userId = user.id.split(':').pop() || user.id;
            await updateUser(userId, { username: newUsername.trim() });
            setUsername(newUsername.trim());
            setIsEditing(false);
            toast.success("Username updated successfully");
        } catch (error) {
            console.error("Error updating username:", error);
            toast.error("Failed to update username");
        }
    };

    useEffect(() => {
        if (ready && authenticated) {
            if (user) {
                console.log(user, 'user')
                setIsDelegated(user.wallet?.delegated || false);
            }
        }
    }, [ready, authenticated, user]);

    const handleDelegateAccess = async () => {
        console.log(user)
        console.log(user?.wallet?.address, 'user?.wallet?.address')
        try {

            // Find the embedded wallet to delegate from the array of the user's wallets
            const walletToDelegate = wallets.find((wallet) => wallet.walletClientType === 'privy');

            // Check if the wallet to delegate by inspecting the user's linked accounts
            const isAlreadyDelegated = !!user?.linkedAccounts.find(
                (account): account is WalletWithMetadata => account.type === 'wallet' && account.delegated,
            );

            if (!walletToDelegate || !walletsReady || isAlreadyDelegated) return;
            try {
                const delegateAccess = await delegateWallet({
                    address: walletToDelegate.address,
                    chainType: 'ethereum'
                });
                console.log(delegateAccess, 'delegateAccess');
                setIsDelegated(true);
                toast.success("Access delegated successfully");
            }
            catch (error) {
                console.log("error delegating wallet", error)
                toast.error("Failed to delegate access");
            }

        } catch (error) {
            console.error(error, 'error');
            toast.error("Failed to delegate access");
        }
    }



    return (
        <section className="w-full mx-auto text-white min-h-screen bg-base">
            <div className="mx-auto">
                {/* Header Section */}
                {/* <div className="mb-12">
                    <div className="flex items-center gap-4 mb-4">
                        <div>
                            <h1 className="text-3xl sm:text-3xl font-bold font-funnel-display text-white">Settings</h1>
                            <p className="text-white/60 font-funnel-sans text-lg mt-1">Manage your account preferences and security</p>
                        </div>
                    </div>
                </div> */}

                {/* Grid Layout */}
                <div className="grid grid-cols-1 md:grid-cols-8 md:grid-rows-6 gap-[20px] min-h-[80vh]">
                    {/* Profile Information Card - Large */}
                    <div className="md:col-start-1 md:col-end-5 md:row-start-1 md:row-end-4 bg-black border border-white/10 rounded-[56px] p-8 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-color2/10 rounded-full -translate-y-16 translate-x-16"></div>
                        <div className="relative z-10">
                            <div className="flex items-center gap-3 mb-8">
                                <div className="w-10 h-10 bg-color2 rounded-full flex items-center justify-center">
                                    <User className="w-5 h-5 text-white" />
                                </div>
                                <h2 className="text-2xl font-bold font-funnel-display text-white">Profile Information</h2>
                            </div>
                            <div className="space-y-8">
                                <div>
                                    <label className="text-white/80 font-funnel-sans text-sm font-medium mb-3 block">Username</label>
                                    {isEditing ? (
                                        <div className="flex items-center gap-4">
                                            <Input
                                                type="text"
                                                value={newUsername}
                                                onChange={(e) => setNewUsername(e.target.value)}
                                                className="flex-1 bg-white/5 border-white/20 text-white placeholder:text-white/40 rounded-full px-6 py-4 h-14 focus:border-color6 focus:ring-color6/20 text-lg"
                                                placeholder="Enter new username"
                                            />
                                            <Button
                                                onClick={handleUsernameUpdate}
                                                className="bg-color2 hover:bg-color3 text-white font-funnel-display font-semibold rounded-full px-8 py-4 h-14 transition-all duration-200 hover:scale-105 shadow-lg"
                                            >
                                                Save
                                            </Button>
                                            <Button
                                                onClick={() => {
                                                    setIsEditing(false);
                                                    setNewUsername("");
                                                }}
                                                variant="outline"
                                                className="border-white/20 bg-transparent text-white/80 hover:bg-white/5 rounded-full px-8 py-4 h-14 transition-all duration-200 hover:scale-105"
                                            >
                                                Cancel
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-4">
                                            <div className="flex-1 bg-white/5 rounded-full px-6 py-4 border border-white/10">
                                                <p className="text-white font-medium text-lg">{username || 'Not set'}</p>
                                            </div>
                                            <Button
                                                onClick={() => {
                                                    setIsEditing(true);
                                                    setNewUsername(username || "");
                                                }}
                                                variant="outline"
                                                className="border-white/20 bg-transparent text-white/80 hover:bg-white/5 rounded-full px-8 py-4 h-14 transition-all duration-200 hover:scale-105"
                                            >
                                                Edit
                                            </Button>
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <label className="text-white/80 font-funnel-sans text-sm font-medium mb-3 block">Email</label>
                                    <div className="bg-white/5 rounded-full px-6 py-4 border border-white/10">
                                        <p className="text-white font-medium text-lg">{user?.email?.address || 'Not set'}</p>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-white/80 font-funnel-sans text-sm font-medium mb-3 block">Wallet Address</label>
                                    <div className="bg-white/5 rounded-full px-6 py-4 border border-white/10">
                                        <p className="text-white font-medium font-mono text-sm break-all">
                                            {activeWallet ? activeWallet.address : user?.wallet?.address || 'Not set'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Delegate Access Card - Medium */}
                    <div className="md:col-start-5 md:col-end-9 md:row-start-1 md:row-end-3 bg-color2 rounded-[56px] p-8 flex flex-col justify-center relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -translate-y-12 translate-x-12"></div>
                        <div className="relative z-10">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                                    <Shield className="w-5 h-5 min-w-5 min-h-5 text-white" />
                                </div>
                                <h2 className="text-2xl font-bold font-funnel-display text-white">Delegate Access</h2>
                            </div>
                            {isDelegated ? (
                                <RevokeAccessButton />
                            ) : (
                                <div className="space-y-6">
                                    <p className="text-white/90 font-funnel-sans text-lg leading-relaxed">Delegate access to enable additional features and enhanced functionality</p>
                                    <Button
                                        onClick={handleDelegateAccess}
                                        className="bg-white text-color3 font-funnel-display font-semibold rounded-full px-10 py-5 h-16 transition-all duration-200 hover:scale-105 hover:bg-gray-200 shadow-lg text-lg"
                                    >
                                        Delegate Access
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Embedded Wallet Card - Medium */}
                    <div className="md:col-start-5 md:col-end-9 md:row-start-3 md:row-end-5 bg-black border border-white/10 rounded-[56px] p-8 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-20 h-20 bg-color6/10 rounded-full -translate-y-10 translate-x-10"></div>
                        <div className="relative z-10">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 bg-color6 rounded-full flex items-center justify-center">
                                    <Wallet className="w-5 h-5 text-white" />
                                </div>
                                <h2 className="text-2xl font-bold font-funnel-display text-white">Embedded Wallet</h2>
                            </div>
                            <EmbeddedWalletSection />
                        </div>
                    </div>
                    {/* Wallets Section - Large */}
                    <div className="md:col-start-1 md:col-end-5 md:row-start-4 md:row-end-7 bg-black border border-white/10 rounded-[56px] p-8 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-24 h-24 bg-color13/10 rounded-full -translate-y-12 translate-x-12"></div>
                        <div className="relative z-10">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 bg-color13 rounded-full flex items-center justify-center">
                                    <Icons.sidebarWalletIcon className="w-5 h-5 text-white" />
                                </div>
                                <h2 className="text-2xl font-bold font-funnel-display text-white">Connected Wallets</h2>
                            </div>
                            <WalletsSection />
                        </div>
                    </div>

                    {/* Passkey Card - Small */}
                    <div className="md:col-start-5 md:col-end-7 md:row-start-5 md:row-end-7 bg-black rounded-[56px] p-6 flex flex-col justify-center relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-16 h-16 bg-color2/10 rounded-full -translate-y-8 translate-x-8"></div>
                        <div className="relative z-10">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                                    <Key className="w-4 h-4 text-white" />
                                </div>
                                <h2 className="text-xl font-bold font-funnel-display text-white">Passkey</h2>
                            </div>
                            <PasskeySection />
                        </div>
                    </div>

                    {/* Farcaster Card - Small */}
                    <div className="md:col-start-7 md:col-end-9 md:row-start-5 md:row-end-7 bg-color13 border border-white/10 rounded-[56px] p-6 flex flex-col justify-center relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-16 h-16 bg-white/10 rounded-full -translate-y-8 translate-x-8"></div>
                        <div className="relative z-10">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-8 h-8 bg-color2 rounded-full flex items-center justify-center">
                                    <Icons.farcasterWhiteIcon className="w-4 h-4 text-white" />
                                </div>
                                <h2 className="text-xl font-bold font-funnel-display text-white">Farcaster</h2>
                            </div>
                            <FarcasterPrivy />
                        </div>
                    </div>


                </div>
            </div>
        </section>
    );
} 