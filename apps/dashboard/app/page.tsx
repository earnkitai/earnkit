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
import { ConnectedWallet, useActiveWallet, useLoginWithEmail, useLoginWithPasskey, usePrivy } from "@privy-io/react-auth";
import { createUser } from '@/actions/user';

const formSchema = z.object({
  email: z.string().email("Invalid email address"),
})

// Add this new component before SignUpPage
const OTPInput = ({ onComplete, verificationStatus }: { onComplete: (code: string) => void, verificationStatus: "idle" | "verifying" | "success" | "error" }) => {
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
    <div className="flex gap-2 sm:gap-4 justify-center font-funnel-sans transition-all duration-300 ease-in-out" role="group" aria-label="Verification code input">
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
          className={`w-12 h-12 sm:w-16 sm:h-16 text-center text-2xl border-2 rounded-xl focus:border-primary focus:outline-none bg-white transition-all duration-300 ease-in-out ${verificationStatus === "verifying" ? "border-primary animate-pulse" : verificationStatus === "success" ? "border-secondary-green" : verificationStatus === "error" ? "border-secondary-red" : ""}`}
          autoComplete="one-time-code"
          aria-label={`Verification code digit ${idx + 1}`}
          aria-invalid={verificationStatus === "error"}
        />
      ))}
    </div>
  );
};

function SignUpPage() {
  // const { user, isLoading } = useUser()
  const { ready, authenticated, createWallet } = usePrivy();
  const { setActiveWallet } = useActiveWallet();
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
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);

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

          await createWallet({ createAdditional: false }).then((wallet) => {
            setActiveWallet(wallet as unknown as ConnectedWallet)
            toast.success("Wallet created successfully");
            router.push("/home");
          }).catch((error) => {
            console.log("Wallet creation error:", error);
            toast.error("Failed to create wallet");
            // Don't redirect on wallet creation failure
            setVerificationStatus("error");
            setErrorMessage("Account created but wallet creation failed. Please try again later.");
          });
        } else {
          console.log("user already exists")
          console.log(user, "db user details")
          router.push("/home");
        }
      } catch (error) {
        console.log("Error during signup:", error);
        toast.error("Failed to complete signup");
        setVerificationStatus("error");
        setErrorMessage("Failed to complete signup. Please try again.");
      }
    },
    onError: (error) => {
      console.log("Login error:", error);
      toast.error("Failed to login with email");
      setVerificationStatus("error");
      setErrorMessage("Failed to login. Please try again.");
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

  const validateEmail = (email: string) => {
    setIsValidating(true);
    const result = formSchema.safeParse({ email });
    setEmailError(result.success ? null : result.error.errors[0].message);
    setIsValidating(false);
    return result.success;
  };

  const handleEmailLogin = async (email: z.infer<typeof formSchema>['email']) => {
    try {
      setErrorMessage(null);
      setLoadingAction("email");
      await sendCodeEmail({
        email: email,
      });
      setResendCountdown(60); // Start 60 second countdown
      const timer = setInterval(() => {
        setResendCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      setLoadingAction(null);
    } catch (error) {
      console.log(error);
      setErrorMessage("Failed to send verification code. Please try again.");
      setLoadingAction(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateEmail(email)) {
      return;
    }
    setErrorMessage(null)
    try {
      setIsTransitioning(true);
      setLoadingAction("email");
      await sendCodeEmail({ email: email });
      setVerificationEmail(email);
      setShowVerification(true);
      setLoadingAction(null);
    } catch (error) {
      console.error(error);
      toast.error("Failed to process email login");
      setLoadingAction(null);
    } finally {
      setIsTransitioning(false);
    }
  };

  const handleVerificationComplete = async (code: string) => {
    try {
      setIsVerifying(true);
      setVerificationStatus("verifying");
      setErrorMessage(null);
      await loginWithCodeEmail({ code });
      setVerificationStatus("success");
      toast.success("OTP verified successfully");
    } catch (error) {
      console.log(error);
      setVerificationStatus("error");
      setErrorMessage("Invalid verification code. Please try again.");
      toast.error("Invalid verification code");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleLoginWithPasskey = () => {
    setLoadingAction("passkey");
    setErrorMessage(null);
    loginWithPasskey().then(() => {
      console.log("Logged in");
      router.push("/home");
    }).catch((error) => {
      if (error instanceof Error) {
        setErrorMessage(error.message || "Login failed. Please try again.");
        toast.error(error.message || "Login failed");
      } else {
        setErrorMessage("Login failed. Please try again.");
        toast.error("Login failed");
      }
    }).finally(() => {
      setLoadingAction(null);
    });
  };

  const handleResendCode = async () => {
    if (resendCountdown > 0) return;

    try {
      setIsResending(true);
      setErrorMessage(null);
      await handleEmailLogin(verificationEmail);
      toast.success("Verification code resent successfully");
    } catch (error) {
      console.log(error);
      setErrorMessage("Failed to resend code. Please try again.");
    } finally {
      setIsResending(false);
    }
  };

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
      <div className="min-h-screen flex items-center justify-center bg-white flex-col gap-4 sm:gap-4 px-4 sm:px-0 font-funnel-sans">
        <div className="w-full max-w-xl p-6 sm:p-12 bg-black/[4%] rounded-3xl shadow-sm flex flex-col items-center justify-center gap-4 sm:gap-6">
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
          <div className="flex justify-center mb-2 text-primary">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true" data-slot="icon" color="var(--privy-color-accent)" height="48px" width="48px"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"></path></svg>
          </div>

          <h2 className="text-2xl font-bold text-center">Enter confirmation code</h2>
          <p className="text-center text-black/[60%] text-sm w-[60%]">
            Please check <strong>{verificationEmail}</strong> for an email from privy.io and enter your code below.
          </p>

          <OTPInput onComplete={handleVerificationComplete} verificationStatus={verificationStatus} />

          {errorMessage && (
            <p className="text-red-500 text-sm text-center mt-2" role="alert">{errorMessage}</p>
          )}

          {isVerifying && (
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-center text-black/[60%] text-sm">
                {verificationStatus === "verifying" && "Verifying OTP..."}
                {verificationStatus === "success" && "Success! Creating wallet..."}
                {verificationStatus === "error" && "Issue verifying code"}
              </span>
            </div>
          )}

          <button
            onClick={handleResendCode}
            className={`text-primary text-sm hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${isResending ? 'opacity-50' : ''}`}
            disabled={isVerifying || isResending || resendCountdown > 0}
          >
            {resendCountdown > 0 && verificationStatus === "idle"
              ? `Resend code in ${resendCountdown}s`
              : "Didn't get an email? Resend code"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white flex-col gap-1 sm:gap-4 px-4 sm:px-0">
      <h1 className="text-lg sm:text-2xl font-bold font-funnel-sans text-center text-black/40 transition-all duration-300 ease-in-out">Login or Sign up</h1>
      <form
        onSubmit={handleSubmit}
        className={`w-full max-w-xl p-6 sm:p-12 bg-black/[4%] rounded-3xl shadow-sm flex flex-col gap-6 sm:gap-8 transition-all duration-300 ease-in-out ${isTransitioning ? 'opacity-50' : ''}`}
        aria-label="Login or sign up form"
        noValidate
      >
        {/* Logo */}
        <div className="flex justify-center mb-2 sm:mb-4">
          <svg width="100" height="60" className="sm:w-[136.5px] sm:h-[80px]" viewBox="0 0 138 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path fillRule="evenodd" clipRule="evenodd" d="M60.711 16.3597C60.711 11.8335 64.3802 8.16426 68.9064 8.16426C73.4326 8.16426 77.1018 11.8335 77.1018 16.3597H85.266C85.266 7.32447 77.9416 0 68.9064 0C59.8712 0 52.5467 7.32447 52.5467 16.3597H60.711ZM52.4866 24.608C57.042 24.608 60.7349 20.9151 60.7349 16.3597H68.8992C68.8992 25.4241 61.551 32.7723 52.4866 32.7723V24.608ZM77.0779 16.3597C77.0779 20.8766 80.7396 24.5383 85.2565 24.5383V32.7025C76.2306 32.7025 68.9136 25.3856 68.9136 16.3597H77.0779ZM118.389 54.2984C120.252 54.2984 121.762 52.7885 121.762 50.926C121.762 49.0634 120.252 47.5536 118.389 47.5536C116.527 47.5536 115.017 49.0634 115.017 50.926C115.017 52.7885 116.527 54.2984 118.389 54.2984ZM115.017 56.2789V79.7117H121.762V56.2789H115.017ZM131.07 63.4862V68.0609C131.085 70.9894 133.348 73.2421 137.258 73.2552L137.236 80C130.609 79.9778 124.356 75.6384 124.325 68.0826L124.325 68.0687V50.5921H131.07V56.7413H137.246V63.4862H131.07ZM40.8535 79.7117V78.6078C39.3721 79.293 37.7219 79.6754 35.9824 79.6754C29.5671 79.6754 24.3664 74.4747 24.3664 68.0594C24.3664 61.6441 29.5671 56.4434 35.9824 56.4434C37.7219 56.4434 39.3721 56.8258 40.8535 57.511V56.2789H47.5984V68.0416L47.5984 68.0594L47.5984 68.0772V79.7117H40.8535ZM40.8535 68.0709V68.0479C40.8473 65.3629 38.6688 63.1883 35.9824 63.1883C33.2921 63.1883 31.1113 65.3691 31.1113 68.0594C31.1113 70.7496 33.2921 72.9305 35.9824 72.9305C38.6688 72.9305 40.8473 70.7559 40.8535 68.0709ZM70.9101 68.0594C70.9101 65.3692 73.091 63.1883 75.7812 63.1883C78.4715 63.1883 80.6524 65.3692 80.6524 68.0594V79.6643H87.3972V68.0594C87.3972 61.6441 82.1966 56.4435 75.7812 56.4435C69.3659 56.4435 64.1653 61.6441 64.1653 68.0594V79.6643H70.9101V68.0594ZM61.5307 63.2045L62.9188 63.1881L62.8391 56.4437L61.4693 56.4599C55.0901 56.4715 49.8418 61.625 49.8418 68.0594V79.6574H56.5866V68.0594C56.5866 65.3955 58.7742 63.2047 61.4909 63.2047H61.5108L61.5307 63.2045ZM16.2459 48.2961L16.1824 48.2963H16.0361V48.2975C7.43355 48.4098 0.494507 55.4183 0.494507 64.0475C0.494507 72.6767 7.43356 79.6852 16.0361 79.7975V79.7989H16.2282L16.2459 79.7989L22.8061 79.7989L22.8061 73.054L16.2313 73.054C12.4559 73.048 9.22519 70.7191 7.89204 67.42H19.5374L19.5374 60.6752L7.89195 60.6752C9.22111 57.3858 12.4367 55.0607 16.1979 55.0411L22.8061 55.0411L22.8061 48.2963L16.2459 48.2963V48.2961ZM89.4709 79.5832V50.1189H96.2157V79.5832H89.4709ZM98.8409 62.916C103.176 59.7548 105.129 54.579 105.159 50.2283L111.904 50.2748C111.868 55.5061 109.877 61.7175 105.229 66.3125L113.6 79.6689H105.64L97.9704 67.4317L96.3012 64.7682L98.8409 62.916Z" fill="black" fillOpacity="0.4" />
          </svg>
        </div>

        {/* Email Input */}
        <div className="flex flex-col gap-2">
          <div className="bg-black/[10%] rounded-full flex gap-2 sm:gap-4 px-4 sm:px-10 py-3 sm:py-5">
            <label htmlFor="email" className="text-base sm:text-[1.375rem] font-funnel-sans text-black/[40%] flex items-center justify-center">Email</label>
            <input
              type="email"
              id="email"
              name="email"
              placeholder="email@example.com"
              onChange={(e) => setEmail(e.target.value)}
              className={`w-full bg-transparent outline-none font-funnel-sans text-base sm:text-[1.375rem] ml-2 sm:ml-4 text-black focus:outline-none focus:ring-0 focus:bg-none ${emailError ? 'border-red-500' : ''}`}
              aria-invalid={!!emailError}
              aria-describedby={emailError ? "email-error" : undefined}
              required
            />
          </div>
          {emailError && (
            <p id="email-error" className="text-red-500 text-sm ml-4" role="alert">{emailError}</p>
          )}
        </div>

        {errorMessage && (
          <p className="text-red-500 text-sm text-center" role="alert">{errorMessage}</p>
        )}

        <div>
          {message && <p className="text-center text-black/[30%] font-funnel-sans text-xs sm:text-sm mb-2 transition-all duration-300 ease-in-out">{message}</p>}
          <LoadingButton
            type="submit"
            className="flex items-center justify-center gap-2 w-full px-6 sm:px-10 py-3 sm:py-5 bg-primary font-funnel-sans font-medium text-base sm:text-[1.375rem] text-white rounded-full hover:bg-blue-600 transition-all duration-300 ease-in-out disabled:opacity-70 h-auto"
            disabled={!email || isValidating}
            loading={loadingAction === "email"}
            aria-label="Submit email for verification"
          >
            Submit
          </LoadingButton>
        </div>

        <p className="text-center text-black/[40%] font-funnel-sans text-xs sm:text-sm">
          <LoadingButton
            type="button"
            onClick={handleLoginWithPasskey}
            className="text-primary bg-transparent hover:bg-transparent text-sm"
            loading={loadingAction === "passkey"}
            aria-label="Login with passkey"
          >
            I have a passkey
          </LoadingButton>
        </p>
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
        <div className="w-12 h-12 sm:w-16 sm:h-16 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin"></div>
      </div>
    </div>
  );
};

export default function page() {
  return <Suspense fallback={<LoadingFallback />}><SignUpPage /></Suspense>
}