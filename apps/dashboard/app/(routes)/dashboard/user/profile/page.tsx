"use client";

import { useUser } from "@/hooks/use-user";
import { useTurnkey } from "@turnkey/sdk-react";
import { useEffect, useState } from "react";
import { getUserByTurnkeyId } from "@/actions/user";
import { User } from "@/types/user";
import { Passkeys } from "@/app/components/sections/passkeys";

export default function UserProfilePage() {
    const { user } = useUser()
    const { turnkey } = useTurnkey()
    const [userData, setUserData] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (turnkey) {
            const fetchUser = async () => {
                try {
                    const currentUser = await turnkey.getCurrentUser();
                    if (currentUser?.userId) {
                        const result = await getUserByTurnkeyId(currentUser.userId);
                        if (result.success && result.data) {
                            setUserData(result.data);
                        }
                    }
                } catch (error) {
                    console.error("Error fetching user profile:", error);
                } finally {
                    setIsLoading(false);
                }
            };
            fetchUser();
        }
    }, [turnkey]);

    useEffect(() => {
        if (!user) {
            console.log("No user found");
            // router.push("/");
        }
    }, [user]);

    if (isLoading) {
        return (
            <div className="p-8">
                <h1 className="text-2xl font-bold mb-6">User Profile</h1>
                <div className="animate-pulse">
                    <div className="h-8 w-48 bg-gray-200 rounded mb-6"></div>
                    <div className="bg-white rounded-xl p-6 shadow-sm">
                        <div className="space-y-4">
                            <div className="h-4 w-24 bg-gray-200 rounded"></div>
                            <div className="h-4 w-32 bg-gray-200 rounded"></div>
                            <div className="h-4 w-40 bg-gray-200 rounded"></div>
                            <div className="h-4 w-36 bg-gray-200 rounded"></div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="p-8">
            <h1 className="text-2xl font-bold mb-6">User Profile</h1>
            <div className="bg-white rounded-xl p-6 shadow-sm">
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
        </div>
    );
} 