/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useEffect } from "react";
import { User } from "@/types/user";
import { toast } from "sonner";
import { truncateAddress } from "@/lib/utils";
import "@farcaster/auth-kit/styles.css";
import { AuthKitProvider, SignInButton, useProfile } from "@farcaster/auth-kit";
import { ethers } from "ethers";
import { getUserByTurnkeyId, updateFarcasterDetails } from "@/actions/user";
import Image from "next/image";


const pageUrl =
    process.env.NEXT_PUBLIC_VERCEL_ENV === 'production'
        ? `https://${process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL}/settings`
        : `http://localhost:3000/settings`;

const farcasterConfig = {
    relay: "https://relay.farcaster.xyz",
    rpcUrl: "https://mainnet.optimism.io",
    domain: process.env.NEXT_PUBLIC_VERCEL_ENV === 'production' ? `${process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL}` : "localhost:3000",
    siweUri: pageUrl,
    provider: new ethers.JsonRpcProvider(undefined, 10) as any // Type assertion needed due to version mismatch
};

interface FarcasterProfileData {
    fid: string;
    displayName: string;
    custodyAddress: string;
    profilePictureUrl: string;
}

function FarcasterProfile({ userData, setUserData }: { userData: User | null; setUserData: (data: User | null) => void }) {
    const profile = useProfile();
    const {
        isAuthenticated,
        profile: { fid, displayName, custody, pfpUrl },
    } = profile;
    console.log(profile, "farcaster profile")
    console.log(pfpUrl)

    useEffect(() => {
        if (isAuthenticated && userData?.turnkeyUserId && fid && custody) {

            // replce the pfp url with this one
            // it should be like this https://imagedelivery.net/BXluQx4ige9GuW0Ia56BHw/f773871a-2215-4666-5217-cf8162dcb900/anim=false,fit=contain,f=auto,w=100
            // not like this https://imagedelivery.net/BXluQx4ige9GuW0Ia56BHw/f773871a-2215-4666-5217-cf8162dcb900/rectcrop3
            //check if the rectcrop3 is in the pfpUrl
            let updatedPfpUrl = pfpUrl;
            if (pfpUrl?.includes("rectcrop3")) {
                updatedPfpUrl = pfpUrl?.replace("rectcrop3", "anim=false,fit=contain,f=auto,w=100");
            }

            const updateProfile = async () => {
                const profileData: FarcasterProfileData = {
                    fid: fid.toString(),
                    displayName: displayName || "",
                    custodyAddress: custody as string,
                    profilePictureUrl: updatedPfpUrl || "",
                };

                const result = await updateFarcasterDetails(userData.turnkeyUserId, profileData);

                if (result.success) {
                    toast.success("Farcaster profile updated successfully!");
                    // Refresh user data
                    const userResult = await getUserByTurnkeyId(userData.turnkeyUserId);
                    if (userResult.success && userResult.data) {
                        setUserData(userResult.data);
                    }
                } else {
                    toast.error(result.error || "Failed to update Farcaster profile");
                }
            };
            updateProfile();
        }
    }, [isAuthenticated, fid, displayName, custody, userData?.turnkeyUserId]);

    // If user has existing Farcaster details, show those instead of the auth flow
    if (userData?.farcasterFid) {
        console.log(userData)
        return (
            <div className="space-y-4">
                <div>
                    <h3 className="text-sm font-medium text-gray-500">Farcaster Profile</h3>
                    <div className="flex items-center gap-4 mt-2">
                        {userData.farcasterProfilePictureUrl && (
                            <Image
                                src={userData.farcasterProfilePictureUrl}
                                alt={userData.farcasterDisplayName || "Profile"}
                                className="w-12 h-12 rounded-full"
                                width={48}
                                height={48}
                            />
                        )}
                        <div>
                            <p className="text-lg font-medium">{userData.farcasterDisplayName}</p>
                            <p className="text-sm text-gray-500">FID: {userData.farcasterFid}</p>
                            <p className="text-sm text-gray-500">Custody: {truncateAddress(userData.farcasterCustodyAddress || "")}</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // If no Farcaster details exist, show the auth flow
    return (
        <div className="space-y-4">
            {isAuthenticated ? (
                <div className="space-y-4">
                    <div>
                        <h3 className="text-sm font-medium text-gray-500">Farcaster Profile</h3>
                        <div className="flex items-center gap-4 mt-2">
                            {pfpUrl && (
                                <Image
                                    src={pfpUrl}
                                    alt={displayName || "Profile"}
                                    className="w-12 h-12 rounded-full"
                                    width={48}
                                    height={48}
                                />
                            )}
                            <div>
                                <p className="text-lg font-medium">{displayName}</p>
                                <p className="text-sm text-gray-500">FID: {fid}</p>
                                <p className="text-sm text-gray-500">Custody: {truncateAddress(custody as string)}</p>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="space-y-4">
                    <p className="text-sm text-gray-500">Connect your Farcaster account to link it with your profile.</p>
                    <SignInButton />
                </div>
            )}
        </div>
    );
}

export function FarcasterSection({ userData, setUserData }: { userData: User | null; setUserData: (data: User | null) => void }) {
    return (
        <div>
            <h2 className="text-lg sm:text-xl font-medium mb-3 sm:mb-4 text-foreground">Farcaster Account</h2>
            <AuthKitProvider config={farcasterConfig}>
                <FarcasterProfile userData={userData} setUserData={setUserData} />
            </AuthKitProvider>
        </div>
    );
}