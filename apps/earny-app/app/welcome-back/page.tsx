"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useLoginWithPasskey } from "@privy-io/react-auth";
import { LoadingButton } from "@/app/components/ui/button.loader";
import { toast } from "sonner";
import { Toaster } from "@/app/components/ui/sonner";
import { Icons } from "../components/sections/icons";

export default function WelcomeBackPage() {
    const router = useRouter();
    const { ready, authenticated } = usePrivy();
    const { loginWithPasskey } = useLoginWithPasskey();
    const [username, setUsername] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (ready && authenticated) {
            router.push("/home");
            return;
        }

        // Get stored username from local storage
        const accountsHistory = localStorage.getItem('default:accounts_history');
        if (accountsHistory) {
            try {
                const parsed = JSON.parse(accountsHistory);
                const usernames = parsed.value || [];
                if (usernames.length > 0) {
                    setUsername([...usernames]); // Get the first username
                }
            } catch (e) {
                console.error('Error parsing accounts history:', e);
            }
        }
    }, [ready, authenticated, router]);

    const handleLoginWithPasskey = async () => {
        try {
            setIsLoading(true);
            await loginWithPasskey().then(() => {
                toast.success("Successfully logged in with passkey");
                router.push("/home");
            }).catch((error) => {
                console.error("Error logging in with passkey:", error);
                toast.error("Failed to login with passkey");
            });
            toast.success("Successfully logged in with passkey");
            router.push("/home");
        } catch (error) {
            console.error("Error logging in with passkey:", error);
            toast.error("Failed to login with passkey");
        } finally {
            setIsLoading(false);
        }
    };

    const handleClearUsername = () => {
        localStorage.removeItem('default:accounts_history');
        router.push("/");
    }

    // if (!username) {
    //     return (
    //         <div className="min-h-screen flex items-center justify-center bg-white">
    //             <div className="text-center">
    //                 <div className="w-12 h-12 sm:w-16 sm:h-16 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin"></div>
    //             </div>
    //         </div>
    //     );
    // }

    return (
        <div className="min-h-screen flex items-center justify-center bg-base flex-col gap-4 sm:gap-8 px-4 sm:px-0">
            <div className="w-full max-w-xl p-6 sm:p-12 bg-black rounded-[56px] shadow-xl flex flex-col items-center justify-center gap-6 sm:gap-8 border border-white/10">
                {/* Logo */}
                <div className="flex justify-center mb-2 sm:mb-4">
                    <Icons.newEarnyLogoWithWhite className="w-32 sm:w-40" />
                </div>

                {/* Welcome Text */}
                <div className="text-center mb-6">
                    <h1 className="text-2xl sm:text-3xl font-bold font-funnel-display text-white mb-2">Welcome Back</h1>
                    <p className="text-white/40 font-funnel-sans text-sm">Sign in to your account</p>
                </div>

                {username.map((username) => {
                    return (
                        <LoadingButton
                            key={username}
                            onClick={handleLoginWithPasskey}
                            className="flex items-center justify-center gap-2 w-full px-6 sm:px-10 py-3 sm:py-5 bg-color2 font-funnel-sans font-medium text-base sm:text-[1.375rem] text-white rounded-full hover:bg-color3 transition-all duration-300 ease-in-out disabled:opacity-30 disabled:cursor-not-allowed h-auto shadow-lg"
                            loading={isLoading}
                            disabled={!ready}
                        >
                            <Icons.passkeyIcon className="w-6 h-6" /> {username}
                        </LoadingButton>
                    )
                })}

                <button
                    onClick={handleClearUsername}
                    className="text-color2 text-sm hover:underline font-funnel-sans"
                >
                    Use another account
                </button>
            </div>
            <Toaster />
        </div>
    );
} 