"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function SettingsPage() {
    const { status } = useSession();
    const router = useRouter();
    const [notifications, setNotifications] = useState(true);
    const [darkMode, setDarkMode] = useState(false);

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
            <h1 className="text-2xl font-bold mb-6">Settings</h1>
            <div className="bg-white rounded-xl p-6 shadow-sm">
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