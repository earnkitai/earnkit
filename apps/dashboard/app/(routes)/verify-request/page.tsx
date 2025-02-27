"use client";

import Link from "next/link";

export default function VerifyRequest() {
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
                    <h1 className="text-2xl font-funnel-sans font-bold mb-4">Check your email</h1>
                    <p className="text-gray-600 mb-6">
                        A sign in link has been sent to your email address.
                    </p>
                    <p className="text-gray-600">
                        If you don&apos;t see it, check your spam folder.
                    </p>
                </div>

                <Link
                    href="/login"
                    className="w-full px-10 py-5 bg-primary font-funnel-sans font-medium text-[1.375rem] text-white rounded-full hover:bg-blue-600 transition-colors text-center"
                >
                    Back to Login
                </Link>
            </div>
        </div>
    );
}