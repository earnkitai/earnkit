"use client";

// import { getUserByEmail } from "@/actions/user";
import { LoadingButton } from "@/app/components/ui/button.loader";
// import { useUser } from "@/hooks/use-user";
// import { useAuth } from "@/providers/auth-provider";
// import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
// import { providerMap } from "@/auth.config";
// import { handleEmailSignIn } from "@/actions/signin/sendVerificationRequest";
import { Suspense, useEffect, useState, useRef } from "react";
// import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Toaster } from "@/app/components/ui/sonner";
import { z } from "zod";
import { useLoginWithEmail, useLoginWithPasskey, usePrivy } from "@privy-io/react-auth";
import { createUser } from '@/actions/user';

const formSchema = z.object({
  email: z.string().email("Invalid email address"),
})

// Add this new component before SignUpPage
const OTPInput = ({ onComplete }: { onComplete: (code: string) => void }) => {
  const [otp, setOtp] = useState<string[]>(new Array(6).fill(""));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    // Focus the first input on mount
    if (inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, []);

  const handleChange = (element: HTMLInputElement, index: number) => {
    const value = element.value;
    if (isNaN(Number(value))) return;

    const newOtp = [...otp];
    // Allow only one input
    newOtp[index] = value.substring(value.length - 1);
    setOtp(newOtp);

    // Handle paste
    if (element.value.length > 1) {
      const pastedValue = element.value.split('').slice(0, 6);
      const filledOtp = [...pastedValue, ...new Array(6 - pastedValue.length).fill("")];
      setOtp(filledOtp);
      if (inputRefs.current[5]) {
        inputRefs.current[5].focus();
      }
      if (pastedValue.length === 6) {
        onComplete(pastedValue.join(''));
      }
      return;
    }

    // Move to next input if current field is filled
    if (value && index < 5) {
      const nextInput = inputRefs.current[index + 1];
      if (nextInput) {
        nextInput.focus();
      }
    }

    // Call onComplete when all fields are filled
    const completedOtp = newOtp.join('');
    if (completedOtp.length === 6) {
      onComplete(completedOtp);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      const prevInput = inputRefs.current[index - 1];
      if (prevInput) {
        prevInput.focus();
      }
    }
  };

  return (
    <div className="flex gap-2 sm:gap-4 justify-center font-funnel-sans">
      {otp.map((digit, idx) => (
        <input
          key={idx}
          type="text"
          inputMode="numeric"
          maxLength={6}
          ref={(el) => { inputRefs.current[idx] = el }}
          value={digit}
          onChange={(e) => handleChange(e.target, idx)}
          onKeyDown={(e) => handleKeyDown(e, idx)}
          className="w-12 h-12 sm:w-16 sm:h-16 text-center text-2xl border-2 rounded-xl focus:border-primary focus:outline-none bg-white"
          autoComplete="one-time-code"
        />
      ))}
    </div>
  );
};

function SignUpPage() {
  // const { user, isLoading } = useUser()
  const { ready, authenticated, createWallet } = usePrivy();
  const [isUserLoggedIn, setIsUserLoggedIn] = useState(true);
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const searchParams = useSearchParams()
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>("We will send you a verification code to your email.")
  const [showVerification, setShowVerification] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<"idle" | "verifying" | "success" | "error">("idle");
  const { loginWithPasskey } = useLoginWithPasskey();

  const {
    sendCode: sendCodeEmail,
    loginWithCode: loginWithCodeEmail,
  } = useLoginWithEmail({
    onComplete: async ({ user, isNewUser, wasAlreadyAuthenticated, loginMethod }) => {
      console.log('🔑 ✅ User successfully logged in with email', {
        user,
        isNewUser,
        wasAlreadyAuthenticated,
        loginMethod,
      });

      try {
        if (ready && isNewUser) {
          console.log(user, "db user details")
          const username = user.email?.address.toString()?.split('@')[0] || '';
          const userId = user.id.split(':').pop() || user.id;

          // Create user in database using server action
          await createUser({
            id: userId,
            email: user.email?.address.toString() || null,
            username: username,
            hasAcceptedTerms: true,
            isGuest: false,
            mfaMethods: [],
          });

          await createWallet({ createAdditional: false }).then(() => {
            toast.success("Wallet created successfully");
            router.push("/home");
          }).catch((error) => {
            console.error("Wallet creation error:", error);
            toast.error("Failed to create wallet");
          });
        } else {
          console.log("user already exists")
          console.log(user, "db user details")
          router.push("/home");
        }
      } catch (error) {
        console.error("Error during signup:", error);
        toast.error("Failed to complete signup");
      }
    },
    onError: (error) => {
      console.log(error);
      toast.error("Failed to login with email");
    },
  });

  useEffect(() => {
    if (ready && authenticated) {
      router.push("/home")
    }
    else {
      setIsUserLoggedIn(false)
    }
  }, [router, authenticated, ready])

  useEffect(() => {
    const qsError = searchParams.get("error")
    if (qsError) {
      toast.error(qsError)
    }
  }, [searchParams])

  useEffect(() => {
    if (email) {
      setMessage("We will send you a verification code to your email.")
    }
  }, [email])

  const handleEmailLogin = async (email: z.infer<typeof formSchema>['email']) => {
    setLoadingAction("email")
    await sendCodeEmail({
      email: email,
    })
    setLoadingAction(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = formSchema.safeParse({ email });
      if (!result.success) {
        toast.error(result.error.errors[0].message);
        return;
      }
      setLoadingAction("email");
      await sendCodeEmail({ email: email });
      setVerificationEmail(email);
      setShowVerification(true);
      setLoadingAction(null);
    } catch (error) {
      console.error(error);
      toast.error("Failed to process email login");
      setLoadingAction(null);
    }
  };

  const handleVerificationComplete = async (code: string) => {
    try {
      setIsVerifying(true);
      setVerificationStatus("verifying");
      await loginWithCodeEmail({ code });
      setVerificationStatus("success");
      toast.success("OTP verified successfully");
    } catch (error) {
      console.error(error);
      setVerificationStatus("error");
      toast.error("Invalid verification code");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleLoginWithPasskey = () => {
    setLoadingAction("passkey")
    loginWithPasskey().then(() => {
      console.log("Logged in");
      router.push("/home");
    }).catch((error) => {
      if (error instanceof Error) {
        toast.error(error.message || "Login failed");
      } else {
        toast.error("Login failed");
      }
    }).finally(() => {
      setLoadingAction(null)
    })
  }

  // Show loading state while checking authentication
  if (isUserLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white flex-col gap-4 sm:gap-8 px-4 sm:px-0">
        <div className="w-full max-w-xl p-6 sm:p-12 bg-black/[4%] rounded-3xl shadow-sm flex flex-col items-center justify-center gap-6 sm:gap-8">
          {/* Logo */}
          <div className="flex justify-center mb-2 sm:mb-4">
            <svg width="100" height="60" className="sm:w-[136.5px] sm:h-[80px]" viewBox="0 0 138 80" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path fillRule="evenodd" clipRule="evenodd" d="M60.711 16.3597C60.711 11.8335 64.3802 8.16426 68.9064 8.16426C73.4326 8.16426 77.1018 11.8335 77.1018 16.3597H85.266C85.266 7.32447 77.9416 0 68.9064 0C59.8712 0 52.5467 7.32447 52.5467 16.3597H60.711ZM52.4866 24.608C57.042 24.608 60.7349 20.9151 60.7349 16.3597H68.8992C68.8992 25.4241 61.551 32.7723 52.4866 32.7723V24.608ZM77.0779 16.3597C77.0779 20.8766 80.7396 24.5383 85.2565 24.5383V32.7025C76.2306 32.7025 68.9136 25.3856 68.9136 16.3597H77.0779ZM118.389 54.2984C120.252 54.2984 121.762 52.7885 121.762 50.926C121.762 49.0634 120.252 47.5536 118.389 47.5536C116.527 47.5536 115.017 49.0634 115.017 50.926C115.017 52.7885 116.527 54.2984 118.389 54.2984ZM115.017 56.2789V79.7117H121.762V56.2789H115.017ZM131.07 63.4862V68.0609C131.085 70.9894 133.348 73.2421 137.258 73.2552L137.236 80C130.609 79.9778 124.356 75.6384 124.325 68.0826L124.325 68.0687V50.5921H131.07V56.7413H137.246V63.4862H131.07ZM40.8535 79.7117V78.6078C39.3721 79.293 37.7219 79.6754 35.9824 79.6754C29.5671 79.6754 24.3664 74.4747 24.3664 68.0594C24.3664 61.6441 29.5671 56.4434 35.9824 56.4434C37.7219 56.4434 39.3721 56.8258 40.8535 57.511V56.2789H47.5984V68.0416L47.5984 68.0594L47.5984 68.0772V79.7117H40.8535ZM40.8535 68.0709V68.0479C40.8473 65.3629 38.6688 63.1883 35.9824 63.1883C33.2921 63.1883 31.1113 65.3691 31.1113 68.0594C31.1113 70.7496 33.2921 72.9305 35.9824 72.9305C38.6688 72.9305 40.8473 70.7559 40.8535 68.0709ZM70.9101 68.0594C70.9101 65.3692 73.091 63.1883 75.7812 63.1883C78.4715 63.1883 80.6524 65.3692 80.6524 68.0594V79.6643H87.3972V68.0594C87.3972 61.6441 82.1966 56.4435 75.7812 56.4435C69.3659 56.4435 64.1653 61.6441 64.1653 68.0594V79.6643H70.9101V68.0594ZM61.5307 63.2045L62.9188 63.1881L62.8391 56.4437L61.4693 56.4599C55.0901 56.4715 49.8418 61.625 49.8418 68.0594V79.6574H56.5866V68.0594C56.5866 65.3955 58.7742 63.2047 61.4909 63.2047H61.5108L61.5307 63.2045ZM16.2459 48.2961L16.1824 48.2963H16.0361V48.2975C7.43355 48.4098 0.494507 55.4183 0.494507 64.0475C0.494507 72.6767 7.43356 79.6852 16.0361 79.7975V79.7989H16.2282L16.2459 79.7989L22.8061 79.7989L22.8061 73.054L16.2313 73.054C12.4559 73.048 9.22519 70.7191 7.89204 67.42H19.5374L19.5374 60.6752L7.89195 60.6752C9.22111 57.3858 12.4367 55.0607 16.1979 55.0411L22.8061 55.0411L22.8061 48.2963L16.2459 48.2963V48.2961ZM89.4709 79.5832V50.1189H96.2157V79.5832H89.4709ZM98.8409 62.916C103.176 59.7548 105.129 54.579 105.159 50.2283L111.904 50.2748C111.868 55.5061 109.877 61.7175 105.229 66.3125L113.6 79.6689H105.64L97.9704 67.4317L96.3012 64.7682L98.8409 62.916Z" fill="black" fillOpacity="0.4" />
            </svg>
          </div>
          <div className="w-12 h-12 sm:w-16 sm:h-16 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin"></div>
          <p className="text-center text-black/[40%] font-funnel-sans text-sm sm:text-base">
            Checking authentication...
          </p>
        </div>
      </div>
    );
  }

  if (showVerification) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white flex-col gap-4 sm:gap-8 px-4 sm:px-0">
        <div className="w-full max-w-xl p-6 sm:p-12 bg-black/[4%] rounded-3xl shadow-sm flex flex-col items-center justify-center gap-6 sm:gap-8">
          {/* Back button */}
          <button
            onClick={() => setShowVerification(false)}
            className="self-start p-2 hover:bg-black/[8%] rounded-full transition-colors"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15.41 7.41L14 6L8 12L14 18L15.41 16.59L10.83 12L15.41 7.41Z" fill="black" fillOpacity="0.4" />
            </svg>
          </button>

          {/* Logo */}
          <div className="flex justify-center mb-2">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M20 4H4C2.9 4 2.01 4.9 2.01 6L2 18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V6C22 4.9 21.1 4 20 4ZM20 8L12 13L4 8V6L12 11L20 6V8Z" fill="#6366F1" />
            </svg>
          </div>

          <h2 className="text-2xl font-bold text-center">Enter confirmation code</h2>
          <p className="text-center text-black/[60%] text-sm">
            Please check {verificationEmail} for an email from privy.io and enter your code below.
          </p>

          <OTPInput onComplete={handleVerificationComplete} />

          {isVerifying && (
            <div className="flex flex-col items-center gap-4">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-center text-black/[60%] text-sm">
                {verificationStatus === "verifying" && "Verifying OTP..."}
                {verificationStatus === "success" && "OTP verified successfully! Creating wallet..."}
                {verificationStatus === "error" && "Verification failed. Please try again."}
              </p>
            </div>
          )}

          <button
            onClick={() => handleEmailLogin(verificationEmail)}
            className="text-primary text-sm hover:underline"
            disabled={isVerifying}
          >
            Didn&apos;t get an email? Resend code
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white flex-col gap-4 sm:gap-8 px-4 sm:px-0">
      <h1 className="text-xl sm:text-3xl font-bold font-funnel-sans text-center">Login or Sign up</h1>
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-xl p-6 sm:p-12 bg-black/[4%] rounded-3xl shadow-sm flex flex-col gap-6 sm:gap-8">
        {/* Logo */}
        <div className="flex justify-center mb-2 sm:mb-4">
          <svg width="100" height="60" className="sm:w-[136.5px] sm:h-[80px]" viewBox="0 0 138 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path fillRule="evenodd" clipRule="evenodd" d="M60.711 16.3597C60.711 11.8335 64.3802 8.16426 68.9064 8.16426C73.4326 8.16426 77.1018 11.8335 77.1018 16.3597H85.266C85.266 7.32447 77.9416 0 68.9064 0C59.8712 0 52.5467 7.32447 52.5467 16.3597H60.711ZM52.4866 24.608C57.042 24.608 60.7349 20.9151 60.7349 16.3597H68.8992C68.8992 25.4241 61.551 32.7723 52.4866 32.7723V24.608ZM77.0779 16.3597C77.0779 20.8766 80.7396 24.5383 85.2565 24.5383V32.7025C76.2306 32.7025 68.9136 25.3856 68.9136 16.3597H77.0779ZM118.389 54.2984C120.252 54.2984 121.762 52.7885 121.762 50.926C121.762 49.0634 120.252 47.5536 118.389 47.5536C116.527 47.5536 115.017 49.0634 115.017 50.926C115.017 52.7885 116.527 54.2984 118.389 54.2984ZM115.017 56.2789V79.7117H121.762V56.2789H115.017ZM131.07 63.4862V68.0609C131.085 70.9894 133.348 73.2421 137.258 73.2552L137.236 80C130.609 79.9778 124.356 75.6384 124.325 68.0826L124.325 68.0687V50.5921H131.07V56.7413H137.246V63.4862H131.07ZM40.8535 79.7117V78.6078C39.3721 79.293 37.7219 79.6754 35.9824 79.6754C29.5671 79.6754 24.3664 74.4747 24.3664 68.0594C24.3664 61.6441 29.5671 56.4434 35.9824 56.4434C37.7219 56.4434 39.3721 56.8258 40.8535 57.511V56.2789H47.5984V68.0416L47.5984 68.0594L47.5984 68.0772V79.7117H40.8535ZM40.8535 68.0709V68.0479C40.8473 65.3629 38.6688 63.1883 35.9824 63.1883C33.2921 63.1883 31.1113 65.3691 31.1113 68.0594C31.1113 70.7496 33.2921 72.9305 35.9824 72.9305C38.6688 72.9305 40.8473 70.7559 40.8535 68.0709ZM70.9101 68.0594C70.9101 65.3692 73.091 63.1883 75.7812 63.1883C78.4715 63.1883 80.6524 65.3692 80.6524 68.0594V79.6643H87.3972V68.0594C87.3972 61.6441 82.1966 56.4435 75.7812 56.4435C69.3659 56.4435 64.1653 61.6441 64.1653 68.0594V79.6643H70.9101V68.0594ZM61.5307 63.2045L62.9188 63.1881L62.8391 56.4437L61.4693 56.4599C55.0901 56.4715 49.8418 61.625 49.8418 68.0594V79.6574H56.5866V68.0594C56.5866 65.3955 58.7742 63.2047 61.4909 63.2047H61.5108L61.5307 63.2045ZM16.2459 48.2961L16.1824 48.2963H16.0361V48.2975C7.43355 48.4098 0.494507 55.4183 0.494507 64.0475C0.494507 72.6767 7.43356 79.6852 16.0361 79.7975V79.7989H16.2282L16.2459 79.7989L22.8061 79.7989L22.8061 73.054L16.2313 73.054C12.4559 73.048 9.22519 70.7191 7.89204 67.42H19.5374L19.5374 60.6752L7.89195 60.6752C9.22111 57.3858 12.4367 55.0607 16.1979 55.0411L22.8061 55.0411L22.8061 48.2963L16.2459 48.2963V48.2961ZM89.4709 79.5832V50.1189H96.2157V79.5832H89.4709ZM98.8409 62.916C103.176 59.7548 105.129 54.579 105.159 50.2283L111.904 50.2748C111.868 55.5061 109.877 61.7175 105.229 66.3125L113.6 79.6689H105.64L97.9704 67.4317L96.3012 64.7682L98.8409 62.916Z" fill="black" fillOpacity="0.4" />
          </svg>
        </div>


        {/* Email Input */}
        <div className="bg-black/[10%] rounded-full flex gap-2 sm:gap-4 px-4 sm:px-10 py-3 sm:py-5">
          <label htmlFor="email" className="text-base sm:text-[1.375rem] font-funnel-sans text-black/[40%] flex items-center justify-center">Email</label>
          <input
            type="email"
            id="email"
            name="email"
            placeholder="email@example.com"
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-transparent outline-none font-funnel-sans text-base sm:text-[1.375rem] ml-2 sm:ml-4 text-black"
          />
        </div>

        {message && <p className="text-center text-black/[40%] font-funnel-sans text-xs sm:text-sm">{message}</p>}
        {/* Submit Button */}
        <LoadingButton
          type="submit"
          className="flex items-center justify-center gap-2 w-full px-6 sm:px-10 py-3 sm:py-5 bg-primary font-funnel-sans font-medium text-base sm:text-[1.375rem] text-white rounded-full hover:bg-blue-600 transition-colors disabled:opacity-70 h-auto"
          disabled={!email}
          loading={loadingAction === "email"}
        >
          Submit
        </LoadingButton>

        <p className="text-center text-black/[40%] font-funnel-sans text-xs sm:text-sm">
          <LoadingButton
            type="button"
            onClick={handleLoginWithPasskey}
            className="text-black/[40%] hover:text-black bg-transparent hover:bg-transparent text-sm hover:underline "
            loading={loadingAction === "passkey"}
          >
            I have a passkey
          </LoadingButton>
        </p>
      </form>
      <Toaster />
    </div >
  );
}
// Loading component
const LoadingFallback = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-center">
        <div className="w-12 h-12 sm:w-16 sm:h-16 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin"></div>
      </div>
    </div>
  );
};

export default function page() {
  return <Suspense fallback={<LoadingFallback />}><SignUpPage /></Suspense>
}