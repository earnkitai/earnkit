"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy, useLinkWithPasskey, useActiveWallet, BaseConnectedWalletType } from "@privy-io/react-auth";
import { LoadingButton } from "@/app/components/ui/button.loader";
import { toast } from "sonner";
import { Toaster } from "@/app/components/ui/sonner";
import { findUserByUsername, updateUser, findUserById } from "@/actions/user";
import { z } from "zod";
import { Icons } from "@/app/components/sections/icons";

const usernameSchema = z.object({
    username: z.string().min(3, "Username must be at least 3 characters").max(30, "Username must be less than 30 characters"),
});

export default function PasskeySetupPage() {
    const router = useRouter();
    const { createWallet, user, authenticated, ready } = usePrivy();
    const { linkWithPasskey } = useLinkWithPasskey();
    const { setActiveWallet } = useActiveWallet();

    const [isLoading, setIsLoading] = useState<string | null>(null);
    const [username, setUsername] = useState("");
    const [usernameError, setUsernameError] = useState<string | null>(null);
    const [isCheckingUser, setIsCheckingUser] = useState(true);
    const [hasPasskey, setHasPasskey] = useState(false);

    useEffect(() => {
        if (ready && authenticated && user) {
            console.log(user, "user")
            // Check if user has passkey
            const hasPasskeyAccount = user.linkedAccounts?.some(account => account.type === 'passkey');
            setHasPasskey(hasPasskeyAccount);
        }
    }, [ready, authenticated, user])
    // Handle passkey state changes
    // useEffect(() => {
    //     switch (passkeyState.status) {
    //     case 'generating-challenge':
    //         toast.loading("Generating passkey challenge...");
    //         break;
    //     case 'awaiting-passkey':
    //         toast.loading("Please complete the passkey setup on your device...");
    //         break;
    //     case 'submitting-response':
    //         toast.loading("Verifying your passkey...");
    //         break;
    //     case 'error':
    //         toast.error(passkeyState.error?.message || "Failed to setup passkey");
    //         break;
    //     case 'done':
    //         toast.success("Passkey setup completed successfully!");
    //         break;
    //     }
    // }, [passkeyState]);

    useEffect(() => {
        if (username) {
            setUsernameError(null)
        }
    }, [username]);

    useEffect(() => {
        const checkUserStatus = async () => {
            if (!ready || !user) return;

            if (ready && !user) {
                router.push("/");
                return;
            }

            try {
                const userId = user.id.split(':').pop() || user.id;
                const existingUser = await findUserById(userId);

                if (existingUser) {
                    if (existingUser.username) {
                        // Case 4: User exists and has username - redirect to home
                        router.push("/home");
                        return;
                    }
                    // Case 3: User exists but no username - stay on page to set username
                } else {
                    // Case 1 & 2: User doesn't exist in database - create user
                    router.push("/");
                }
            } catch (error) {
                console.error("Error checking user status:", error);
                toast.error("Failed to check user status");
            } finally {
                setIsCheckingUser(false);
            }
        };

        checkUserStatus();
    }, [ready, user, router]);

    const validateUsername = (username: string) => {
        const result = usernameSchema.safeParse({ username });
        setUsernameError(result.success ? null : result.error.errors[0].message);
        return result.success;
    };

    const handleContinueWithPasskey = async () => {

        if (!ready || !authenticated || !user) return;
        if (!validateUsername(username)) {
            return;
        }

        try {
            setIsLoading("username");

            // check if the username is already taken
            const existingUser = await findUserByUsername(username);
            if (existingUser) {
                toast.error("Username already taken");
                setUsernameError("Username already taken");
                return;
            }

            // Link passkey
            if (!hasPasskey) {
                await linkWithPasskey().then(async () => {
                    toast.success("Passkey setup completed successfully!");
                    // Update user with username
                    if (user) {
                        const userId = user.id.split(':').pop() || user.id;
                        await updateUser(userId, { username });
                    }

                    // Create wallet
                    await createWallet({ createAdditional: false }).then(async (wallet) => {
                        toast.success("Wallet created successfully");
                        setActiveWallet(wallet as unknown as BaseConnectedWalletType);
                    });

                    // Store username in local storage for future reference
                    const accountsHistory = localStorage.getItem('default:accounts_history');
                    let usernames = [];
                    if (accountsHistory) {
                        try {
                            const parsed = JSON.parse(accountsHistory);
                            usernames = parsed.value || [];
                        } catch (e) {
                            console.error('Error parsing accounts history:', e);
                        }
                    }

                    // Add username if not already present
                    if (!usernames.includes(username)) {
                        usernames.push(username);
                        localStorage.setItem('default:accounts_history', JSON.stringify({
                            value: usernames,
                            expiration: null
                        }));
                    }

                    router.push("/home");
                }).catch((error) => {
                    console.error("Error linking passkey:", error);
                    toast.error("Failed to link passkey");
                });
                toast.success("Passkey setup completed successfully!");
            }



        } catch (error) {
            console.error("Error setting up passkey:", error);
            toast.error("Failed to setup passkey");
        } finally {
            setIsLoading(null);
        }
    };

    // const handleLinkPasskey = async () => {
    //     try {
    //         setIsLoading("passkey");
    //         linkPasskey();
    //     } catch (error) {
    //         console.error("Error linking passkey:", error);
    //         toast.error("Failed to link passkey");
    //     } finally {
    //         setIsLoading(null);
    //     }
    // }

    if (isCheckingUser) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-base">
                <div className="text-center">
                    <div className="w-12 h-12 sm:w-16 sm:h-16 border-4 border-color2/20 border-t-color2 rounded-full animate-spin"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-base flex-col gap-4 sm:gap-8 px-4 sm:px-0">
            <div className="w-full max-w-xl p-6 sm:p-12 bg-black rounded-[56px] shadow-xl flex flex-col items-center justify-center gap-6 sm:gap-8 border border-white/10">
                {/* Logo */}
                <div className="flex justify-center mb-2 sm:mb-4">
                    <Icons.newEarnyLogoWithWhite className="w-32 sm:w-40" />
                </div>

                {/* Welcome Text */}
                <div className="text-center mb-6">
                    <h1 className="text-2xl sm:text-3xl font-bold font-funnel-display text-white mb-2">Set Up Passkey</h1>
                    <p className="text-white/40 font-funnel-sans text-sm">Choose a username and set up your passkey for secure login</p>
                </div>

                {/* Username Input */}
                <div className="w-full">
                    <div className="bg-white/5 rounded-full flex gap-2 sm:gap-4 px-4 sm:px-10 py-3 sm:py-5 border border-white/10">
                        <label htmlFor="username" className="text-base sm:text-[1.375rem] font-funnel-sans text-white/60 flex items-center justify-center">Username</label>
                        <input
                            type="text"
                            id="username"
                            name="username"
                            placeholder="Choose a username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className={`w-full bg-transparent outline-none font-funnel-sans text-base sm:text-[1.375rem] ml-2 sm:ml-4 text-white placeholder:text-white/40 focus:outline-none focus:ring-0 focus:bg-none ${usernameError ? 'border-secondary-red' : ''}`}
                            aria-invalid={!!usernameError}
                            aria-describedby={usernameError ? "username-error" : undefined}
                            required
                        />
                    </div>
                    {usernameError && (
                        <p id="username-error" className="text-secondary-red text-sm ml-4 mt-2" role="alert">{usernameError}</p>
                    )}
                </div>

                <LoadingButton
                    onClick={handleContinueWithPasskey}
                    className="flex items-center justify-center gap-2 w-full px-6 sm:px-10 py-3 sm:py-5 bg-color2 font-funnel-sans font-medium text-base sm:text-[1.375rem] text-white rounded-full hover:bg-color3 transition-all duration-300 ease-in-out disabled:opacity-30 disabled:cursor-not-allowed h-auto shadow-lg"
                    loading={isLoading === "username"}
                    disabled={isLoading === "username" || !username}
                >
                    <Icons.passkeyIcon className="w-6 h-6" /> Continue with Passkey
                </LoadingButton>
            </div>
            <Toaster />
        </div>
    );
} 