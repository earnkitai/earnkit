"use client";
import { useEffect, useState } from "react";
// import { Passkeys } from "@/app/components/sections/passkeys";
// import { getUserByTurnkeyId } from "@/actions/user";
// import { useTurnkey } from "@turnkey/sdk-react";
import { toast } from "sonner";
// import { truncateAddress } from "@/lib/utils";
// import RecoveryAddressDialog from "@/app/components/sections/recovery-address-dialog";
// import { useTheme } from "@/providers/theme-provider";
import { usePrivy } from "@privy-io/react-auth";
// import { useSessionSigners } from "@privy-io/react-auth";
import { ApiKeySection } from "@/app/(routes)/settings/components/ApiKeySection";
import { EmbeddedWalletSection } from "@/app/(routes)/settings/components/EmbeddedWalletSection";
import { PasskeySection } from "@/app/(routes)/settings/components/PasskeySection";
import { FarcasterPrivy } from "@/app/(routes)/settings/components/FarcasterPrivy";
import { findUsernameByUserId, updateUser } from "@/actions/user";
import { WalletsSection } from "@/app/(routes)/settings/components/WalletsSection";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";


export default function SettingsPage() {
    // const [notifications, setNotifications] = useState(true);
    const { ready, authenticated, user } = usePrivy();
    // const { theme, setTheme } = useTheme();
    // const { addSessionSigners } = useSessionSigners();

    // const { turnkey } = useTurnkey()
    const [username, setUsername] = useState<string | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [newUsername, setNewUsername] = useState("");
    // const { wallets, ready: walletsReady } = useWallets();

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




    return (
        <section className="w-full mx-auto text-black min-h-screen">
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
                <div className="grid grid-cols-1 md:grid-cols-8 md:grid-rows-6 gap-6 min-h-[80vh]">
                    {/* Profile Information Card - Large */}
                    <div className="md:col-start-1 md:col-end-5 md:row-start-1 md:row-end-4 border border-black/10 rounded-[56px] p-8 relative overflow-hidden">
                        <div className="relative z-10">
                            <div className="mb-8">
                                <h2 className="text-2xl font-bold font-funnel-display text-color2">Profile Information</h2>
                            </div>
                            <div className="space-y-8">
                                <div>
                                    <label className="text-black font-funnel-sans text-sm font-medium mb-3 block">Username</label>
                                    {isEditing ? (
                                        <div className="flex items-center gap-4">
                                            <Input
                                                type="text"
                                                value={newUsername}
                                                onChange={(e) => setNewUsername(e.target.value)}
                                                className="flex-1 bg-white/5 border-black/20 text-black placeholder:text-black/40 rounded-full px-6 py-4 h-14 focus:border-color6 focus:ring-color6/20 text-lg"
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
                                                className="border-black/20 bg-transparent text-black/80 hover:bg-black/5 rounded-full px-8 py-4 h-14 transition-all duration-200 hover:scale-105"
                                            >
                                                Cancel
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-4">
                                            <div className="flex-1 bg-white/5 rounded-full px-6 py-4 border border-black/10">
                                                <p className="text-black font-medium text-lg">{username || 'Not set'}</p>
                                            </div>
                                            <Button
                                                onClick={() => {
                                                    setIsEditing(true);
                                                    setNewUsername(username || "");
                                                }}
                                                variant="outline"
                                                className="border-black/20 bg-transparent text-black/80 hover:bg-black/5 rounded-full px-8 py-4 h-14 transition-all duration-200 hover:scale-105"
                                            >
                                                Edit
                                            </Button>
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <label className="text-black font-funnel-sans text-sm font-medium mb-3 block">Email</label>
                                    <div className="bg-white/5 rounded-full px-6 py-4 border border-black/10">
                                        <p className="text-black font-medium text-lg ">{user?.email?.address || 'Not set'}</p>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-black font-funnel-sans text-sm font-medium mb-3 block">Wallet Address</label>
                                    <div className="bg-white/5 rounded-full px-6 py-4 border border-black/10">
                                        <p className="text-black font-medium text-lg break-all">
                                            {user?.wallet?.address || 'Not set'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* API Key Card - Medium */}
                    <div className="md:col-start-5 md:col-end-9 md:row-start-1 md:row-end-3 border border-black/10 rounded-[56px] p-8 flex flex-col justify-center relative overflow-hidden">
                        <div className="relative z-10">
                            <div className="mb-6">
                                <h2 className="text-2xl font-bold font-funnel-display text-color2">API Key</h2>
                            </div>
                            <ApiKeySection />
                        </div>
                    </div>

                    {/* Embedded Wallet Card - Medium */}
                    <div className="md:col-start-5 md:col-end-9 md:row-start-3 md:row-end-5 border border-black/10 rounded-[56px] p-8 relative overflow-hidden">
                        <div className="relative z-10">
                            <div className="mb-6">
                                <h2 className="text-2xl font-bold font-funnel-display text-color2">Embedded Wallet</h2>
                            </div>
                            <EmbeddedWalletSection />
                        </div>
                    </div>
                    {/* Wallets Section - Large */}
                    <div className="md:col-start-1 md:col-end-5 md:row-start-4 md:row-end-7 border border-black/10 rounded-[56px] p-8 relative overflow-hidden">
                        <div className="relative z-10">
                            <div className="mb-6">
                                <h2 className="text-2xl font-bold font-funnel-display text-color2">Connected Wallets</h2>
                            </div>
                            <WalletsSection />
                        </div>
                    </div>

                    {/* Passkey Card - Small */}
                    <div className="md:col-start-5 md:col-end-7 md:row-start-5 md:row-end-7 border border-black/10 rounded-[56px] p-6 flex flex-col justify-center relative overflow-hidden">
                        <div className="relative z-10">
                            <div className="mb-4">
                                <h2 className="text-xl font-bold font-funnel-display text-color2">Passkey</h2>
                            </div>
                            <PasskeySection />
                        </div>
                    </div>

                    {/* Farcaster Card - Small */}
                    <div className="md:col-start-7 md:col-end-9 md:row-start-5 md:row-end-7 border border-black/10 rounded-[56px] p-6 flex flex-col justify-center relative overflow-hidden">
                        <div className="relative z-10">
                            <div className="mb-4">
                                <h2 className="text-xl font-bold font-funnel-display text-color2">Farcaster</h2>
                            </div>
                            <FarcasterPrivy />
                        </div>
                    </div>


                </div>
            </div>
        </section>
    );
} 