"use server";
import { signIn } from "@/auth.config";

export const handleEmailSignIn = async (email: string) => {
    try {
        await signIn("nodemailer", {
            email,
            callbackUrl: "/dashboard",
            redirectTo: "/dashboard", // URL to redirect after successful sign-in
            redirect: false, // Prevent default redirect behavior
        });
    } catch (error) {
        console.error(error);
    }
};