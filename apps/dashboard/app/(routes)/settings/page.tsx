"use client";
import { useEffect, useState } from "react";
// import { Passkeys } from "@/app/components/sections/passkeys";
// import { getUserByTurnkeyId } from "@/actions/user";
// import { useTurnkey } from "@turnkey/sdk-react";
// import { Button } from "@/app/components/ui/button";
import { toast } from "sonner";
// import { truncateAddress } from "@/lib/utils";
// import RecoveryAddressDialog from "@/app/components/sections/recovery-address-dialog";
import { useTheme } from "@/providers/theme-provider";
import { usePrivy } from "@privy-io/react-auth";
import { useSessionSigners } from "@privy-io/react-auth";
import { RevokeAccessButton } from "@/app/(routes)/settings/components/RevokeAccessButton";
import { EmbeddedWalletSection } from "@/app/(routes)/settings/components/EmbeddedWalletSection";
import { ExternalWalletSection } from "@/app/(routes)/settings/components/ExternalWalletSection";
import { PasskeySection } from "@/app/(routes)/settings/components/PasskeySection";
import { FarcasterPrivy } from "@/app/(routes)/settings/components/FarcasterPrivy";
import { findUsernameByUserId, updateUser } from "@/actions/user";

export default function SettingsPage() {
    const [notifications, setNotifications] = useState(true);
    const { ready, authenticated, user } = usePrivy();
    const { theme, setTheme } = useTheme();
    const { addSessionSigners } = useSessionSigners();
    // const { turnkey } = useTurnkey()
    const [isDelegated, setIsDelegated] = useState(false);
    const [username, setUsername] = useState<string | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [newUsername, setNewUsername] = useState("");

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
        console.log(process.env.NEXT_PUBLIC_AUTHORIZATION_ID, 'process.env.NEXT_PUBLIC_AUTHORIZATION_ID')
        try {
            const delegateAccess = await addSessionSigners({
                address: user?.wallet?.address as `0x${string}`,
                signers: []
            });
            console.log(delegateAccess, 'delegateAccess');
            setIsDelegated(true);
            toast.success("Access delegated successfully");
        } catch (error) {
            console.error(error, 'error');
            toast.error("Failed to delegate access");
        }
    }



    return (
        <section className="min-h-screen bg-background pb-12 sm:pb-20 pt-20 sm:pt-10 max-w-4xl mx-auto font-funnel-sans">
            <h1 className="text-xl sm:text-2xl font-bold mb-0 p-4 sm:p-8 text-foreground">Settings</h1>
            <div className="bg-card rounded-xl p-4 sm:p-8 pt-4 sm:pt-6 shadow-sm border mx-4 sm:mx-8">
                <div className="space-y-3 sm:space-y-4">
                    <div>
                        <h2 className="text-xs sm:text-sm font-medium text-muted-foreground">Username</h2>
                        {isEditing ? (
                            <div className="flex items-center gap-2 mt-1">
                                <input
                                    type="text"
                                    value={newUsername}
                                    onChange={(e) => setNewUsername(e.target.value)}
                                    className="text-base sm:text-lg text-foreground bg-transparent border-b border-foreground/20 focus:outline-none focus:border-foreground"
                                    placeholder="Enter new username"
                                />
                                <button
                                    onClick={handleUsernameUpdate}
                                    className="bg-transparent border border-foreground/20 px-2 py-1 rounded-md text-xs sm:text-sm text-primary hover:bg-black/4"
                                >
                                    Save
                                </button>
                                <button
                                    onClick={() => {
                                        setIsEditing(false);
                                        setNewUsername("");
                                    }}
                                    className="bg-transparent border border-foreground/20 px-2 py-1 rounded-md text-xs sm:text-sm text-muted-foreground hover:bg-black/4"
                                >
                                    Cancel
                                </button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 mt-1">
                                <p className="text-base sm:text-lg text-foreground">{username || 'Not set'}</p>
                                <button
                                    onClick={() => {
                                        setIsEditing(true);
                                        setNewUsername(username || "");
                                    }}
                                    className="text-xs sm:text-sm text-primary hover:underline"
                                >
                                    Edit
                                </button>
                            </div>
                        )}
                    </div>
                    <div>
                        <h2 className="text-xs sm:text-sm font-medium text-muted-foreground">Email</h2>
                        <p className="mt-1 text-base sm:text-lg text-foreground">{user?.email?.address || 'Not set'}</p>
                    </div>
                    <div>
                        <h2 className="text-xs sm:text-sm font-medium text-muted-foreground">Wallet Address</h2>
                        <p className="mt-1 text-base sm:text-lg text-foreground text-wrap break-all">{user?.wallet?.address || 'Not set'}</p>
                    </div>
                </div>
            </div>

            <div className="bg-card rounded-xl p-4 sm:p-8 shadow-sm mt-4 sm:mt-6 border mx-4 sm:mx-8">
                <h2 className="text-lg sm:text-xl font-medium mb-3 sm:mb-4 text-foreground">Delegate Access</h2>
                {isDelegated ? (
                    <RevokeAccessButton />
                ) : (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">Delegate access to enable additional features</p>
                        <button
                            className="bg-transparent text-black border border-black/40 px-4 py-2 rounded-md hover:bg-black/4"
                            onClick={handleDelegateAccess}
                        >
                            Delegate Access
                        </button>
                    </div>
                )}
            </div>

            <div className="bg-card rounded-xl p-4 sm:p-8 shadow-sm mt-4 sm:mt-6 border mx-4 sm:mx-8">
                <h2 className="text-lg sm:text-xl font-medium mb-3 sm:mb-4 text-foreground">Embedded Wallet</h2>
                <EmbeddedWalletSection />
            </div>

            <div className="bg-card rounded-xl p-4 sm:p-8 shadow-sm mt-4 sm:mt-6 border mx-4 sm:mx-8">
                <h2 className="text-lg sm:text-xl font-medium mb-3 sm:mb-4 text-foreground">External Wallet</h2>
                <ExternalWalletSection />
            </div>

            <div className="bg-card rounded-xl p-4 sm:p-8 shadow-sm mt-4 sm:mt-6 border mx-4 sm:mx-8">
                <h2 className="text-lg sm:text-xl font-medium mb-3 sm:mb-4 text-foreground">Passkey</h2>
                <PasskeySection />
            </div>

            <div className="bg-card rounded-xl p-4 sm:p-8 shadow-sm mt-4 sm:mt-6 border mx-4 sm:mx-8">
                <h2 className="text-lg sm:text-xl font-medium mb-3 sm:mb-4 text-foreground">Farcaster</h2>
                <FarcasterPrivy />
            </div>

            <div className="bg-card rounded-xl p-4 sm:p-8 shadow-sm mt-4 sm:mt-6 border mx-4 sm:mx-8">
                <h2 className="text-lg sm:text-xl font-medium mb-3 sm:mb-4 text-foreground">Preferences</h2>
                <div className="space-y-4 sm:space-y-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-base sm:text-lg font-medium text-foreground">Notifications</h3>
                            <p className="text-xs sm:text-sm text-muted-foreground">Receive email notifications</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={notifications}
                                onChange={() => setNotifications(!notifications)}
                            />
                            <div className="w-9 h-5 sm:w-11 sm:h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-ring rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 sm:after:h-5 sm:after:w-5 after:transition-all peer-checked:bg-primary"></div>
                        </label>
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-base sm:text-lg font-medium text-foreground">Dark Mode</h3>
                            <p className="text-xs sm:text-sm text-muted-foreground">Switch between light and dark themes</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={theme === "dark"}
                                onChange={() => setTheme(theme === "dark" ? "light" : "dark")}
                            />
                            <div className="w-9 h-5 sm:w-11 sm:h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-ring rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 sm:after:h-5 sm:after:w-5 after:transition-all peer-checked:bg-primary"></div>
                        </label>
                    </div>
                </div>
            </div>
        </section>
    );
} 