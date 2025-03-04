"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useDebounce } from "@/hooks/useDebounce";

export default function SetupUsername() {
    const { data: session, status, update } = useSession();
    const router = useRouter();
    const [username, setUsername] = useState("");
    const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
    const [isChecking, setIsChecking] = useState(false);
    const [error, setError] = useState("");

    const debouncedUsername = useDebounce(username, 500);

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/signin");
        } else if (status === "authenticated" && session?.user?.username) {
            router.push("/dashboard");
        }
    }, [status, session, router]);

    // Check username availability when debounced value changes
    useEffect(() => {
        const checkUsername = async () => {
            if (debouncedUsername.length < 3) {
                setIsAvailable(null);
                return;
            }

            setIsChecking(true);
            try {
                const response = await fetch(`/api/check-username?username=${debouncedUsername}`);
                const data = await response.json();
                setIsAvailable(data.available);
                setError(data.available ? "" : "Username is already taken");
            } catch (err) {
                console.error("Error checking username availability:", err);
                setError("Error checking username availability");
            } finally {
                setIsChecking(false);
            }
        };

        checkUsername();
    }, [debouncedUsername]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!isAvailable || username.length < 3) {
            return;
        }

        try {
            const response = await fetch("/api/setup-username", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ username }),
            });

            if (!response.ok) {
                throw new Error("Failed to set username");
            }

            // Update the session with the new username
            await update({
                ...session,
                user: {
                    ...session?.user,
                    username,
                },
            });

            router.push("/dashboard");
        } catch (err) {
            console.error("Error setting username:", err);
            setError("Failed to set username. Please try again.");
        }
    };

    if (status === "loading") {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white">
                <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-white">
            <div className="w-full max-w-md p-8 bg-black/[4%] rounded-3xl shadow-sm">
                <div className="text-center mb-8">
                    <h1 className="text-2xl font-bold mb-2">Create your username</h1>
                    <p className="text-gray-600">
                        Choose a unique username for your account
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <div className="relative">
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => {
                                    setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''));
                                    setError("");
                                }}
                                className={`w-full px-4 py-3 rounded-lg border ${isAvailable ? 'border-green-500' :
                                    error ? 'border-red-500' : 'border-gray-200'
                                    } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                                placeholder="Enter username"
                                minLength={3}
                                maxLength={15}
                                pattern="[a-z0-9]+"
                                required
                            />
                            {isChecking && (
                                <div className="absolute right-3 top-3">
                                    <div className="w-6 h-6 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin"></div>
                                </div>
                            )}
                            {!isChecking && isAvailable && username.length >= 3 && (
                                <div className="absolute right-3 top-3 text-green-500">
                                    ✓
                                </div>
                            )}
                        </div>
                        {error && (
                            <p className="mt-2 text-sm text-red-500">{error}</p>
                        )}
                        {isAvailable && username.length >= 3 && (
                            <p className="mt-2 text-sm text-green-500">Username is available!</p>
                        )}
                        <p className="mt-2 text-sm text-gray-500">
                            Username must be 3-15 characters long and can only contain lowercase letters and numbers.
                        </p>
                    </div>

                    <button
                        type="submit"
                        disabled={!isAvailable || username.length < 3}
                        className={`w-full py-3 rounded-full text-white font-medium
                            ${isAvailable && username.length >= 3
                                ? 'bg-blue-500 hover:bg-blue-600'
                                : 'bg-gray-300 cursor-not-allowed'
                            } transition-colors`}
                    >
                        Continue to Dashboard
                    </button>
                </form>
            </div>
        </div>
    );
} 