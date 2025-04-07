"use client";
import { useEffect, useState } from "react";
import { Passkeys } from "@/app/components/sections/passkeys";
import { getUserByTurnkeyId } from "@/actions/user";
import { useTurnkey } from "@turnkey/sdk-react";
import { User } from "@/types/user";
import { Button } from "@/app/components/ui/button";
import { toast } from "sonner";
import { truncateAddress } from "@/lib/utils";
import { FarcasterSection } from "./components/FarcasterSection";
import RecoveryAddressDialog from "@/app/components/sections/recovery-address-dialog";
import { useTheme } from "@/app/providers/theme-provider";

export default function SettingsPage() {
    const [notifications, setNotifications] = useState(true);
    const { theme, setTheme } = useTheme();
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

    return (
        <div className="min-h-screen bg-background pb-12 sm:pb-20 pt-20 sm:pt-10">
            <h1 className="text-xl sm:text-2xl font-bold mb-0 p-4 sm:p-8 text-foreground">Settings</h1>
            <div className="bg-card rounded-xl p-4 sm:p-8 pt-4 sm:pt-6 shadow-sm border mx-4 sm:mx-8">
                <div className="space-y-3 sm:space-y-4">
                    <div>
                        <h2 className="text-xs sm:text-sm font-medium text-muted-foreground">Username</h2>
                        <p className="mt-1 text-base sm:text-lg text-foreground">{userData?.username || 'Not set'}</p>
                    </div>
                    <div>
                        <h2 className="text-xs sm:text-sm font-medium text-muted-foreground">Email</h2>
                        <p className="mt-1 text-base sm:text-lg text-foreground">{userData?.email || 'Not set'}</p>
                    </div>
                    <div>
                        <h2 className="text-xs sm:text-sm font-medium text-muted-foreground">Wallet Address</h2>
                        <p className="mt-1 text-base sm:text-lg text-foreground text-wrap break-all">{userData?.walletAddress || 'Not set'}</p>
                    </div>
                </div>

                <div className="mt-4 sm:mt-6">
                    <Passkeys />
                </div>
            </div>
            <div className="bg-card rounded-xl p-4 sm:p-8 shadow-sm mt-4 sm:mt-6 border mx-4 sm:mx-8">
                <h2 className="text-lg sm:text-xl font-medium mb-3 sm:mb-4 text-foreground">Recovery Wallet Address</h2>
                <div className="space-y-3 sm:space-y-4">
                    {userData?.recoveryAddress ? (
                        <div className="space-y-3 sm:space-y-4">
                            <div>
                                <h3 className="text-xs sm:text-sm font-medium text-muted-foreground">Current Recovery Address</h3>
                                <div className="flex items-center gap-2 mt-1">
                                    <p className="text-base sm:text-lg text-foreground">{truncateAddress(userData.recoveryAddress)}</p>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => {
                                            navigator.clipboard.writeText(userData.recoveryAddress!);
                                            toast.success("Address copied to clipboard");
                                        }}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 sm:w-5 sm:h-5"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>
                                    </Button>
                                </div>
                            </div>
                            <RecoveryAddressDialog userData={userData} setUserData={setUserData}>
                                <Button className="text-xs sm:text-sm hover:border-primary" variant="outline" size="sm">Update Recovery Address</Button>
                            </RecoveryAddressDialog>
                        </div>
                    ) : (
                        <div className="space-y-3 sm:space-y-4">
                            <p className="text-xs sm:text-sm text-muted-foreground">No recovery address set. Connect your wallet to add one.</p>
                            <RecoveryAddressDialog userData={userData} setUserData={setUserData}>
                                <Button className="text-xs sm:text-sm hover:border-primary" variant="outline" size="sm">Add Recovery Address</Button>
                            </RecoveryAddressDialog>
                        </div>
                    )}
                </div>
            </div>
            <div className="bg-card rounded-xl p-4 sm:p-8 shadow-sm mt-4 sm:mt-6 border mx-4 sm:mx-8">
                <FarcasterSection userData={userData} setUserData={setUserData} />
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
        </div>
    );
} 