"use client";

import { getUserEmailByUsername } from "@/actions/user";
import { LoadingButton } from "@/app/components/ui/button.loader";
import { useAuth } from "@/providers/auth-provider";
import { Email } from "@/types/turnkey";
import Link from "next/link";
// import { useSearchParams } from "next/navigation";
// import { providerMap } from "@/auth.config";
// import { handleEmailSignIn } from "@/actions/signin/sendVerificationRequest";
import { Suspense, useState } from "react";
// import { useForm } from "react-hook-form";
import { Toaster } from "@/app/components/ui/sonner";
import { toast } from "sonner";
import { z } from "zod";
import { useTurnkey } from "@turnkey/sdk-react";

const formSchema = z.object({
    username: z.string().min(1, "Username is required"),
})

function LoginPage() {
    const { loginWithPasskey } = useAuth()
    const { passkeyClient } = useTurnkey()
    const [loadingAction, setLoadingAction] = useState<string | null>(null)
    // const searchParams = useSearchParams()
    const [username, setUsername] = useState("");

    // const form = useForm<z.infer<typeof formSchema>>({
    //   resolver: zodResolver(formSchema),
    //   defaultValues: {
    //     email: "",
    //   },
    // })

    // useEffect(() => {
    //     const qsError = searchParams.get("error")
    //     if (qsError) {
    //         toast.error(qsError)
    //     }
    // }, [searchParams])

    const handlePasskeyLogin = async (username: string) => {
        if (!passkeyClient) {
            setLoadingAction(null)
            return
        }
        setLoadingAction("username")
        // fetch user email from database using username
        const result = await getUserEmailByUsername(username);

        if (!result.success || !result.email) {
            console.log("result", result)
            toast.error("User not found");
            setLoadingAction(null)
            return;
        }
        console.log("result", result)
        console.log("result.email", result.email)
        const email = result.email as Email;
        await loginWithPasskey(email);
        setLoadingAction(null)
    }

    const handleSubmit = async (e: React.FormEvent) => {

        e.preventDefault();
        try {
            // Validate email using zod schema
            const result = formSchema.safeParse({ username });
            console.log("username", username)
            if (!result.success) {
                // Show error toast if validation fails
                toast.error(result.error.errors[0].message);
                return;
            }

            await handlePasskeyLogin(username);
        } catch (error) {
            console.error(error);
            toast.error("Failed to process email login");
        }
    }


    return (
        <div className="min-h-screen flex items-center justify-center bg-white flex-col gap-4 sm:gap-8 px-4 sm:px-0">
            <h1 className="text-3xl sm:text-4xl font-bold font-funnel-sans text-center">Log In</h1>
            <form
                onSubmit={handleSubmit}
                className="w-full max-w-xl p-6 sm:p-12 bg-black/[4%] rounded-3xl shadow-sm flex flex-col gap-6 sm:gap-8">
                {/* Logo */}
                <div className="flex justify-center mb-2 sm:mb-4">
                    <svg width="120" height="70" viewBox="0 0 138 80" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-[100px] sm:w-[136.5px] h-auto">
                        <path fillRule="evenodd" clipRule="evenodd" d="M60.711 16.3597C60.711 11.8335 64.3802 8.16426 68.9064 8.16426C73.4326 8.16426 77.1018 11.8335 77.1018 16.3597H85.266C85.266 7.32447 77.9416 0 68.9064 0C59.8712 0 52.5467 7.32447 52.5467 16.3597H60.711ZM52.4866 24.608C57.042 24.608 60.7349 20.9151 60.7349 16.3597H68.8992C68.8992 25.4241 61.551 32.7723 52.4866 32.7723V24.608ZM77.0779 16.3597C77.0779 20.8766 80.7396 24.5383 85.2565 24.5383V32.7025C76.2306 32.7025 68.9136 25.3856 68.9136 16.3597H77.0779ZM118.389 54.2984C120.252 54.2984 121.762 52.7885 121.762 50.926C121.762 49.0634 120.252 47.5536 118.389 47.5536C116.527 47.5536 115.017 49.0634 115.017 50.926C115.017 52.7885 116.527 54.2984 118.389 54.2984ZM115.017 56.2789V79.7117H121.762V56.2789H115.017ZM131.07 63.4862V68.0609C131.085 70.9894 133.348 73.2421 137.258 73.2552L137.236 80C130.609 79.9778 124.356 75.6384 124.325 68.0826L124.325 68.0687V50.5921H131.07V56.7413H137.246V63.4862H131.07ZM40.8535 79.7117V78.6078C39.3721 79.293 37.7219 79.6754 35.9824 79.6754C29.5671 79.6754 24.3664 74.4747 24.3664 68.0594C24.3664 61.6441 29.5671 56.4434 35.9824 56.4434C37.7219 56.4434 39.3721 56.8258 40.8535 57.511V56.2789H47.5984V68.0416L47.5984 68.0594L47.5984 68.0772V79.7117H40.8535ZM40.8535 68.0709V68.0479C40.8473 65.3629 38.6688 63.1883 35.9824 63.1883C33.2921 63.1883 31.1113 65.3691 31.1113 68.0594C31.1113 70.7496 33.2921 72.9305 35.9824 72.9305C38.6688 72.9305 40.8473 70.7559 40.8535 68.0709ZM70.9101 68.0594C70.9101 65.3692 73.091 63.1883 75.7812 63.1883C78.4715 63.1883 80.6524 65.3692 80.6524 68.0594V79.6643H87.3972V68.0594C87.3972 61.6441 82.1966 56.4435 75.7812 56.4435C69.3659 56.4435 64.1653 61.6441 64.1653 68.0594V79.6643H70.9101V68.0594ZM61.5307 63.2045L62.9188 63.1881L62.8391 56.4437L61.4693 56.4599C55.0901 56.4715 49.8418 61.625 49.8418 68.0594V79.6574H56.5866V68.0594C56.5866 65.3955 58.7742 63.2047 61.4909 63.2047H61.5108L61.5307 63.2045ZM16.2459 48.2961L16.1824 48.2963H16.0361V48.2975C7.43355 48.4098 0.494507 55.4183 0.494507 64.0475C0.494507 72.6767 7.43356 79.6852 16.0361 79.7975V79.7989H16.2282L16.2459 79.7989L22.8061 79.7989L22.8061 73.054L16.2313 73.054C12.4559 73.048 9.22519 70.7191 7.89204 67.42H19.5374L19.5374 60.6752L7.89195 60.6752C9.22111 57.3858 12.4367 55.0607 16.1979 55.0411L22.8061 55.0411L22.8061 48.2963L16.2459 48.2963V48.2961ZM89.4709 79.5832V50.1189H96.2157V79.5832H89.4709ZM98.8409 62.916C103.176 59.7548 105.129 54.579 105.159 50.2283L111.904 50.2748C111.868 55.5061 109.877 61.7175 105.229 66.3125L113.6 79.6689H105.64L97.9704 67.4317L96.3012 64.7682L98.8409 62.916Z" fill="black" fillOpacity="0.4" />
                    </svg>
                </div>


                {/* Email Input */}
                <div className="bg-black/[10%] rounded-full flex gap-2 sm:gap-4 px-4 sm:px-10 py-3 sm:py-5">
                    <label htmlFor="username" className="text-base sm:text-[1.375rem] font-funnel-sans text-black/[40%] flex items-center justify-center">Username</label>
                    <input
                        type="text"
                        id="username"
                        name="username"
                        required
                        placeholder="Enter your username"
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full bg-transparent outline-none font-funnel-sans text-base sm:text-[1.375rem] ml-2 sm:ml-4 text-black"
                    />
                </div>
                {/* Submit Button */}
                <LoadingButton
                    type="submit"
                    className="flex items-center justify-center gap-2 w-full px-6 sm:px-10 py-3 sm:py-5 bg-primary font-funnel-sans font-medium text-base sm:text-[1.375rem] text-white rounded-full hover:bg-blue-600 transition-colors disabled:opacity-70 h-auto"
                    disabled={!username}
                    loading={loadingAction === "username"}
                >
                    Continue with Passkey
                </LoadingButton>

                <p className="text-center text-black/[40%] font-funnel-sans text-xs sm:text-sm">Don&apos;t have an account? <Link href="/" className="text-primary">Sign up</Link></p>
            </form>
            <Toaster />
        </div>
    );
}

// Loading component
const LoadingFallback = () => {
    return (
        <div className="min-h-screen flex items-center justify-center bg-white">
            <div className="text-center">
                <div className="w-12 sm:w-16 h-12 sm:h-16 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin"></div>
            </div>
        </div>
    );
};
export default function page() {
    return (
        <Suspense fallback={<LoadingFallback />}
        ><LoginPage />
        </Suspense>
    )
}