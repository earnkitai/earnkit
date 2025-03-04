"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function UserProfilePage() {
    const { data: session, status } = useSession();
    const router = useRouter();

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/signin");
        }
    }, [status, router]);

    if (status === "loading") {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-black text-xl">Loading...</div>
            </div>
        );
    }

    return (
        <div>
            <h1 className="text-2xl font-bold mb-6">User Profile</h1>
            <div className="bg-white rounded-xl p-6 shadow-sm">
                <h2 className="text-xl font-medium mb-4">Profile Information</h2>
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Email</label>
                        <div className="mt-1 p-2 bg-gray-50 rounded-md">
                            {session?.user?.email}
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Username</label>
                        <div className="mt-1 p-2 bg-gray-50 rounded-md">
                            {session?.user?.username || "Not available"}
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">User ID</label>
                        <div className="mt-1 p-2 bg-gray-50 rounded-md">
                            {session?.user?.id || "Not available"}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
} 