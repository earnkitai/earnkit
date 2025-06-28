"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from 'react';

// Create a client component for the error content
const ErrorContent = () => {
    const searchParams = useSearchParams();
    const error = searchParams.get("error");

    let errorMessage = "An error occurred during authentication";

    if (error === "Verification") {
        errorMessage = "The verification link has expired or is invalid";
    } else if (error === "OAuthSignin") {
        errorMessage = "Error signing in with OAuth provider";
    } else if (error === "OAuthCallback") {
        errorMessage = "Error during OAuth callback";
    } else if (error === "OAuthCreateAccount") {
        errorMessage = "Error creating OAuth account";
    } else if (error === "EmailCreateAccount") {
        errorMessage = "Error creating email account";
    } else if (error === "Callback") {
        errorMessage = "Error during callback processing";
    } else if (error === "OAuthAccountNotLinked") {
        errorMessage = "Email already in use with different provider";
    } else if (error === "EmailSignin") {
        errorMessage = "Error sending verification email";
    } else if (error === "CredentialsSignin") {
        errorMessage = "Invalid credentials";
    } else if (error === "SessionRequired") {
        errorMessage = "Authentication required to access this page";
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-white">
            <div className="w-full max-w-xl p-8 bg-black/[4%] rounded-3xl shadow-sm flex flex-col gap-8 p-14">
                {/* Logo */}
                <div className="flex justify-center">
                    <svg width="136.5" height="80" viewBox="0 0 138 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                        {/* Your SVG path here */}
                    </svg>
                </div>

                <div className="text-center">
                    <h1 className="text-2xl font-funnel-sans font-bold mb-4 text-red-600">Authentication Error</h1>
                    <p className="text-gray-600 mb-6">
                        {errorMessage}
                    </p>
                </div>

                <Link
                    href="/signin"
                    className="w-full px-10 py-5 bg-primary font-funnel-sans font-medium text-[1.375rem] text-white rounded-full hover:bg-blue-600 transition-colors text-center"
                >
                    Back to Login
                </Link>
            </div>
        </div>
    );
};

// Loading component
const LoadingFallback = () => {
    return (
        <div className="min-h-screen flex items-center justify-center bg-white">
            <div className="w-full max-w-xl p-8 bg-black/[4%] rounded-3xl shadow-sm flex flex-col gap-8 p-14">
                <div className="text-center">
                    <h1 className="text-2xl font-funnel-sans font-bold mb-4">Loading...</h1>
                </div>
            </div>
        </div>
    );
};

// Main page component
export default function ErrorPage() {
    return (
        <Suspense fallback={<LoadingFallback />}>
            <ErrorContent />
        </Suspense>
    );
}