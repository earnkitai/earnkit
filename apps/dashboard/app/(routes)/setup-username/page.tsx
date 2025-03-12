"use client";

// import { useSession } from "next-auth/react";
// import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useDebounce } from "@/hooks/use-debounce";
import { useRouter } from "next/navigation";
// import { useUser } from "@/hooks/use-user";
import { toast } from "sonner";
import { checkUsername, getUserByTurnkeyId, updateUsername } from "@/actions/user";
import { useTurnkey } from "@turnkey/sdk-react";

import { User } from "@/types/user";
import { CheckCircleIcon } from "lucide-react";
// import { setAuthenticator } from "@/actions/turnkey";

export default function SetupUsername() {
    // const { data: session, status, update } = useSession();
    const [user, setUser] = useState<User | null>(null);
    const { passkeyClient, turnkey, authIframeClient } = useTurnkey()
    const router = useRouter();
    const [username, setUsername] = useState("");
    const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
    const [isChecking, setIsChecking] = useState(false);
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    // const [loading, setLoading] = useState(true);

    const debouncedUsername = useDebounce(username, 500);

    // useEffect(() => {
    //     if (turnkey && client) {
    //         setLoading(false);
    //     }
    // }, [turnkey, client]);

    useEffect(() => {
        if (turnkey) {
            console.log(authIframeClient)
            const getUser = async () => {
                const turnkeyUser = await turnkey?.getCurrentUser();
                console.log(turnkeyUser)

                if (turnkeyUser) {
                    console.log("User retrieved successfully");
                    setUser({
                        turnkeyUserId: turnkeyUser.userId,
                        username: turnkeyUser.username,
                        email: "",
                        turnkeyOrganizationId: turnkeyUser.organization.organizationId,
                        walletAddress: "",
                        isVerified: false,
                        isActive: false,
                        hasPasskey: false,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    });
                    // Fetch user from database
                    const result = await getUserByTurnkeyId(turnkeyUser.userId);

                    if (result.success && result.data?.username) {
                        // User has a username, redirect to dashboard
                        router.push("/dashboard");
                    }
                    // If no username, stay on this page to set it up
                }
                return turnkeyUser;
            };
            getUser();
        }
    }, [turnkey, router]);

    // Check username availability when debounced value changes
    useEffect(() => {
        const checkUsernameAvailability = async () => {
            if (debouncedUsername.length < 3) {
                setIsAvailable(null);
                return;
            }

            setIsChecking(true);
            try {
                const result = await checkUsername(debouncedUsername);
                if (result.success) {
                    setIsAvailable(result.available ?? false);
                    setError(result.available ? "" : "Username is already taken");
                } else {
                    setError("Error checking username availability");
                }
            } catch (err) {
                console.error("Error checking username availability:", err);
                setError("Error checking username availability");
            } finally {
                setIsChecking(false);
            }
        };

        checkUsernameAvailability();
    }, [debouncedUsername]);


    const handleSubmit = async (e: React.FormEvent) => {
        if (!passkeyClient) {
            return
        }
        e.preventDefault();
        console.log(username)
        console.log(user)
        if (!isAvailable || username.length < 3 || !user?.turnkeyUserId) return;

        setIsSubmitting(true);
        try {
            if (passkeyClient) {
                const credential = await passkeyClient?.createUserPasskey({
                    publicKey: {
                        rp: {
                            name: "Earnkit",
                        },
                        user: {
                            name: `Earnkit-${username}`,
                            displayName: `Earnkit-${username}`,
                        },
                    },
                })
                console.log("turnkeyClient")
                console.log("credential", credential)
                console.log("authIframeClient", authIframeClient)
                console.log({ turnkeyUserId: user?.turnkeyUserId, turnkeyOrganizationId: user?.turnkeyOrganizationId })
                if (credential && user?.turnkeyUserId && authIframeClient) {
                    console.log("credential", credential)
                    // const authenticatorsResponse = await client?.createAuthenticators({
                    //     authenticators: [
                    //         {
                    //             authenticatorName: "Passkey",
                    //             challenge: credential.encodedChallenge,
                    //             attestation: credential.attestation,
                    //         },
                    //     ],
                    //     userId: `${user?.turnkeyUserId}`,
                    //     organizationId: user?.turnkeyOrganizationId as string,
                    // })

                    const authenticatorsResponse = await authIframeClient?.createAuthenticators({
                        organizationId: user?.turnkeyOrganizationId as string,
                        userId: `${user?.turnkeyUserId}`,
                        authenticators: [
                            {
                                authenticatorName: `Passkey - ${Date.now()}`,
                                challenge: credential.encodedChallenge,
                                attestation: credential.attestation,
                            },
                        ],
                    });
                    console.log("authenticatorsResponse", authenticatorsResponse)

                    // First update the username
                    const result = await updateUsername(user.turnkeyUserId, username);

                    if (!result.success) {
                        console.log(result.error || "Failed to set username");
                    }
                    toast.success("Username set successfully!");

                    if (authenticatorsResponse?.activity.id) {
                        toast.success("Passkey added!")
                    }
                }
            }
            router.push("/dashboard");
        } catch (error) {
            console.error("Error setting up account:", error);
            toast.error("Failed to set up account");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!user) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white">
                <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin"></div>
            </div>
        );
    }

    // if (loading) {
    //     return (
    //         <div className="min-h-screen flex items-center justify-center bg-white">
    //             <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin"></div>
    //         </div>
    //     );
    // }

    return (
        <div className="min-h-screen flex items-center justify-center bg-white flex-col gap-8">
            <h1 className="text-4xl font-bold font-funnel-sans text-center">Create Wallet</h1>
            <form
                onSubmit={handleSubmit}
                className="w-full max-w-xl p-12 bg-black/[4%] rounded-3xl shadow-sm flex flex-col gap-8 p-14">

                {/* Logo */}
                <div className="flex justify-center mb-4">
                    <svg width="136.5" height="80" viewBox="0 0 138 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path fillRule="evenodd" clipRule="evenodd" d="M60.711 16.3597C60.711 11.8335 64.3802 8.16426 68.9064 8.16426C73.4326 8.16426 77.1018 11.8335 77.1018 16.3597H85.266C85.266 7.32447 77.9416 0 68.9064 0C59.8712 0 52.5467 7.32447 52.5467 16.3597H60.711ZM52.4866 24.608C57.042 24.608 60.7349 20.9151 60.7349 16.3597H68.8992C68.8992 25.4241 61.551 32.7723 52.4866 32.7723V24.608ZM77.0779 16.3597C77.0779 20.8766 80.7396 24.5383 85.2565 24.5383V32.7025C76.2306 32.7025 68.9136 25.3856 68.9136 16.3597H77.0779ZM118.389 54.2984C120.252 54.2984 121.762 52.7885 121.762 50.926C121.762 49.0634 120.252 47.5536 118.389 47.5536C116.527 47.5536 115.017 49.0634 115.017 50.926C115.017 52.7885 116.527 54.2984 118.389 54.2984ZM115.017 56.2789V79.7117H121.762V56.2789H115.017ZM131.07 63.4862V68.0609C131.085 70.9894 133.348 73.2421 137.258 73.2552L137.236 80C130.609 79.9778 124.356 75.6384 124.325 68.0826L124.325 68.0687V50.5921H131.07V56.7413H137.246V63.4862H131.07ZM40.8535 79.7117V78.6078C39.3721 79.293 37.7219 79.6754 35.9824 79.6754C29.5671 79.6754 24.3664 74.4747 24.3664 68.0594C24.3664 61.6441 29.5671 56.4434 35.9824 56.4434C37.7219 56.4434 39.3721 56.8258 40.8535 57.511V56.2789H47.5984V68.0416L47.5984 68.0594L47.5984 68.0772V79.7117H40.8535ZM40.8535 68.0709V68.0479C40.8473 65.3629 38.6688 63.1883 35.9824 63.1883C33.2921 63.1883 31.1113 65.3691 31.1113 68.0594C31.1113 70.7496 33.2921 72.9305 35.9824 72.9305C38.6688 72.9305 40.8473 70.7559 40.8535 68.0709ZM70.9101 68.0594C70.9101 65.3692 73.091 63.1883 75.7812 63.1883C78.4715 63.1883 80.6524 65.3692 80.6524 68.0594V79.6643H87.3972V68.0594C87.3972 61.6441 82.1966 56.4435 75.7812 56.4435C69.3659 56.4435 64.1653 61.6441 64.1653 68.0594V79.6643H70.9101V68.0594ZM61.5307 63.2045L62.9188 63.1881L62.8391 56.4437L61.4693 56.4599C55.0901 56.4715 49.8418 61.625 49.8418 68.0594V79.6574H56.5866V68.0594C56.5866 65.3955 58.7742 63.2047 61.4909 63.2047H61.5108L61.5307 63.2045ZM16.2459 48.2961L16.1824 48.2963H16.0361V48.2975C7.43355 48.4098 0.494507 55.4183 0.494507 64.0475C0.494507 72.6767 7.43356 79.6852 16.0361 79.7975V79.7989H16.2282L16.2459 79.7989L22.8061 79.7989L22.8061 73.054L16.2313 73.054C12.4559 73.048 9.22519 70.7191 7.89204 67.42H19.5374L19.5374 60.6752L7.89195 60.6752C9.22111 57.3858 12.4367 55.0607 16.1979 55.0411L22.8061 55.0411L22.8061 48.2963L16.2459 48.2963V48.2961ZM89.4709 79.5832V50.1189H96.2157V79.5832H89.4709ZM98.8409 62.916C103.176 59.7548 105.129 54.579 105.159 50.2283L111.904 50.2748C111.868 55.5061 109.877 61.7175 105.229 66.3125L113.6 79.6689H105.64L97.9704 67.4317L96.3012 64.7682L98.8409 62.916Z" fill="black" fillOpacity="0.4" />
                    </svg>
                </div>

                <div className="relative">
                    <input
                        type="text"
                        value={username}
                        onChange={(e) => {
                            setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''));
                            setError("");
                        }}
                        className={`w-full px-4 py-3 border bg-white rounded-full outline-none font-funnel-sans text-[1.375rem] text-black ${isAvailable ? 'border-green-500' :
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
                        <div className="absolute right-4 top-4 text-green-500">
                            <CheckCircleIcon className="w-6 h-6" />
                        </div>
                    )}

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
                    disabled={!isAvailable || username.length < 3 || isSubmitting}
                    className={`w-full px-10 py-5 rounded-full font-funnel-sans font-medium text-[1.375rem] text-white
                            ${isAvailable && username.length >= 3 && !isSubmitting
                            ? 'bg-primary hover:bg-primary/80'
                            : 'bg-gray-300 cursor-not-allowed'
                        } transition-colors`}
                >
                    {isSubmitting ? "Setting up..." : "Continue with Passkey"}
                </button>
            </form>


            {/* <div className="min-h-screen flex items-center justify-center bg-white ">

                <form
                    onSubmit={handleSubmit}
                    className="w-full max-w-xl p-12 bg-black/[4%] rounded-3xl shadow-sm flex flex-col gap-8 p-14">

                    <div className="flex justify-center mb-4">
                        <svg width="136.5" height="80" viewBox="0 0 138 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path fillRule="evenodd" clipRule="evenodd" d="M60.711 16.3597C60.711 11.8335 64.3802 8.16426 68.9064 8.16426C73.4326 8.16426 77.1018 11.8335 77.1018 16.3597H85.266C85.266 7.32447 77.9416 0 68.9064 0C59.8712 0 52.5467 7.32447 52.5467 16.3597H60.711ZM52.4866 24.608C57.042 24.608 60.7349 20.9151 60.7349 16.3597H68.8992C68.8992 25.4241 61.551 32.7723 52.4866 32.7723V24.608ZM77.0779 16.3597C77.0779 20.8766 80.7396 24.5383 85.2565 24.5383V32.7025C76.2306 32.7025 68.9136 25.3856 68.9136 16.3597H77.0779ZM118.389 54.2984C120.252 54.2984 121.762 52.7885 121.762 50.926C121.762 49.0634 120.252 47.5536 118.389 47.5536C116.527 47.5536 115.017 49.0634 115.017 50.926C115.017 52.7885 116.527 54.2984 118.389 54.2984ZM115.017 56.2789V79.7117H121.762V56.2789H115.017ZM131.07 63.4862V68.0609C131.085 70.9894 133.348 73.2421 137.258 73.2552L137.236 80C130.609 79.9778 124.356 75.6384 124.325 68.0826L124.325 68.0687V50.5921H131.07V56.7413H137.246V63.4862H131.07ZM40.8535 79.7117V78.6078C39.3721 79.293 37.7219 79.6754 35.9824 79.6754C29.5671 79.6754 24.3664 74.4747 24.3664 68.0594C24.3664 61.6441 29.5671 56.4434 35.9824 56.4434C37.7219 56.4434 39.3721 56.8258 40.8535 57.511V56.2789H47.5984V68.0416L47.5984 68.0594L47.5984 68.0772V79.7117H40.8535ZM40.8535 68.0709V68.0479C40.8473 65.3629 38.6688 63.1883 35.9824 63.1883C33.2921 63.1883 31.1113 65.3691 31.1113 68.0594C31.1113 70.7496 33.2921 72.9305 35.9824 72.9305C38.6688 72.9305 40.8473 70.7559 40.8535 68.0709ZM70.9101 68.0594C70.9101 65.3692 73.091 63.1883 75.7812 63.1883C78.4715 63.1883 80.6524 65.3692 80.6524 68.0594V79.6643H87.3972V68.0594C87.3972 61.6441 82.1966 56.4435 75.7812 56.4435C69.3659 56.4435 64.1653 61.6441 64.1653 68.0594V79.6643H70.9101V68.0594ZM61.5307 63.2045L62.9188 63.1881L62.8391 56.4437L61.4693 56.4599C55.0901 56.4715 49.8418 61.625 49.8418 68.0594V79.6574H56.5866V68.0594C56.5866 65.3955 58.7742 63.2047 61.4909 63.2047H61.5108L61.5307 63.2045ZM16.2459 48.2961L16.1824 48.2963H16.0361V48.2975C7.43355 48.4098 0.494507 55.4183 0.494507 64.0475C0.494507 72.6767 7.43356 79.6852 16.0361 79.7975V79.7989H16.2282L16.2459 79.7989L22.8061 79.7989L22.8061 73.054L16.2313 73.054C12.4559 73.048 9.22519 70.7191 7.89204 67.42H19.5374L19.5374 60.6752L7.89195 60.6752C9.22111 57.3858 12.4367 55.0607 16.1979 55.0411L22.8061 55.0411L22.8061 48.2963L16.2459 48.2963V48.2961ZM89.4709 79.5832V50.1189H96.2157V79.5832H89.4709ZM98.8409 62.916C103.176 59.7548 105.129 54.579 105.159 50.2283L111.904 50.2748C111.868 55.5061 109.877 61.7175 105.229 66.3125L113.6 79.6689H105.64L97.9704 67.4317L96.3012 64.7682L98.8409 62.916Z" fill="black" fillOpacity="0.4" />
                        </svg>
                    </div>



                    <div className="bg-black/[10%] rounded-full flex gap-4 px-10 py-5">
                        <label htmlFor="username" className="text-[1.375rem] font-funnel-sans text-black/[40%] flex items-center justify-center">Username</label>
                        <input
                            type="text"
                            id="username"
                            name="username"
                            required
                            placeholder="Enter your username"
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full bg-transparent outline-none font-funnel-sans text-[1.375rem] ml-4 text-black"
                        />
                    </div>

                    <LoadingButton
                        type="submit"
                        className="flex items-center justify-center gap-2 w-full px-10 py-5 bg-primary font-funnel-sans font-medium text-[1.375rem] text-white rounded-full hover:bg-blue-600 transition-colors disabled:opacity-70 h-auto"
                        disabled={!username}
                        loading={isSubmitting}
                    >

                        Continue with Passkey
                    </LoadingButton>

                    <p className="text-center text-black/[40%] font-funnel-sans text-sm">Don&apos;t have an account? <Link href="/" className="text-primary">Sign up</Link></p>
                </form>
                <Toaster />
            </div > */}
        </div >
    );
} 