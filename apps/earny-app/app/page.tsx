"use client";

// import { getUserByEmail } from "@/actions/user";
import { LoadingButton } from "@/app/components/ui/button.loader";
// import { useUser } from "@/hooks/use-user";
// import { useAuth } from "@/providers/auth-provider";
// import Link from "next/link";
import { useRouter } from "next/navigation";
// import { providerMap } from "@/auth.config";
// import { handleEmailSignIn } from "@/actions/signin/sendVerificationRequest";
import { Suspense, useEffect, useState, useRef } from "react";
// import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Toaster } from "@/app/components/ui/sonner";
import { z } from "zod";
import { Captcha, useLoginWithEmail, useLoginWithPasskey, usePrivy } from "@privy-io/react-auth";
import { createUser, findUserById } from '@/actions/user';
import { Icons } from "./components/sections/icons";
import OrSeparator from "./components/sections/or-separator";

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
          className={`w-12 h-12 sm:w-16 sm:h-16 text-center text-2xl border-2 rounded-xl focus:border-color2 focus:outline-none bg-white/5 text-white transition-all duration-300 ease-in-out ${verificationStatus === "verifying" ? "border-color2 animate-pulse" : verificationStatus === "success" ? "border-secondary-green" : verificationStatus === "error" ? "border-secondary-red" : "border-white/20"}`}
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
  const { ready, authenticated } = usePrivy();
  const [isUserLoggedIn, setIsUserLoggedIn] = useState(true);
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  // const searchParams = useSearchParams()
  const router = useRouter();
  const [email, setEmail] = useState("");
  // const [message, setMessage] = useState<string | null>("We will send you a verification code to your email.")
  const [showVerification, setShowVerification] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<"idle" | "verifying" | "success" | "error">("idle");
  const { loginWithPasskey } = useLoginWithPasskey();
  // const [emailError, setEmailError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);

  useEffect(() => {
    // Get stored username from local storage
    const accountsHistory = localStorage.getItem('default:accounts_history');
    if (accountsHistory) {
      try {
        const parsed = JSON.parse(accountsHistory);
        const usernames = parsed.value || [];
        if (usernames.length > 0) {
          router.push("/welcome-back");
        }
      } catch (e) {
        console.error('Error parsing accounts history:', e);
      }
    }
  }, [router])


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
          // const username = user.email?.address.toString()?.split('@')[0] || '';
          const userId = user.id.split(':').pop() || user.id;

          // Create user in database using server action
          await createUser({
            id: userId,
            email: user.email?.address.toString() || null,
            username: "",
            hasAcceptedTerms: true,
            isGuest: false,
            mfaMethods: [],
          });

          // Redirect to passkey setup page
          router.push("/sign-up/passkeys");
        } else if (ready && !isNewUser) {

          // user is there on the privy db
          const userId = user.id.split(':').pop() || user.id;
          const existingUser = await findUserById(userId);

          if (existingUser) {

            if (existingUser.username) {
              // Case 4: User exists and has username - redirect to home
              router.push("/home");
            } else {
              // Case 3: User exists but no username - stay on page to set username
              router.push("/sign-up/passkeys");
            }
          } else {
            // Case 1 & 2: User doesn't exist in database - create user
            await createUser({
              id: userId,
              email: user.email?.address.toString() || null,
              username: "",
              hasAcceptedTerms: true,
              isGuest: false,
              mfaMethods: [],
            });
            router.push("/sign-up/passkeys");
          }
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

  // useEffect(() => {
  //   const qsError = searchParams.get("error")
  //   if (qsError) {
  //     toast.error(qsError)
  //   }
  // }, [searchParams])

  // useEffect(() => {
  //   if (email) {
  // setMessage("We will send you a verification code to your email.")
  //   }
  // }, [email])

  const validateEmail = (email: string) => {
    setIsValidating(true);
    const result = formSchema.safeParse({ email });
    if (!result.success) {
      toast.error(result.error.errors[0].message);
    }
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
      <div className="min-h-screen flex items-center justify-center bg-base flex-col gap-4 sm:gap-8 px-4 sm:px-0">
        <div className="w-full max-w-xl p-6 sm:p-12 bg-black rounded-[56px] shadow-xl flex flex-col items-center justify-center gap-6 sm:gap-8 border border-white/10">
          {/* Logo */}
          <div className="flex justify-center mb-2 sm:mb-4">
            <Icons.newEarnyLogoWithWhite className="w-32 sm:w-40" />
          </div>
          <div className="w-12 h-12 sm:w-16 sm:h-16 border-4 border-color2/20 border-t-color2 rounded-full animate-spin"></div>
          <p className="text-center text-white/60 font-funnel-sans text-sm sm:text-base">
            Checking authentication...
          </p>
        </div>
      </div>
    );
  }

  if (showVerification) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-base flex-col gap-4 sm:gap-4 px-4 sm:px-0 font-funnel-sans">
        <div className="w-full max-w-xl p-6 sm:p-12 bg-black rounded-[56px] shadow-xl flex flex-col items-center justify-center gap-4 sm:gap-6 border border-white/10">
          {/* Back button */}
          <button
            onClick={() => setShowVerification(false)}
            className="self-start p-2 hover:bg-white/10 rounded-full transition-colors"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15.41 7.41L14 6L8 12L14 18L15.41 16.59L10.83 12L15.41 7.41Z" fill="white" fillOpacity="0.6" />
            </svg>
          </button>

          {/* Logo */}
          <div className="flex justify-center mb-2 text-color2">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true" data-slot="icon" color="var(--privy-color-accent)" height="48px" width="48px"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"></path></svg>
          </div>

          <h2 className="text-2xl font-bold text-center text-white font-funnel-display">Enter confirmation code</h2>
          <p className="text-center text-white/60 text-sm w-[60%] font-funnel-sans">
            Please check <strong className="text-white">{verificationEmail}</strong> for an email from privy.io and enter your code below.
          </p>

          <OTPInput onComplete={handleVerificationComplete} verificationStatus={verificationStatus} />

          {errorMessage && (
            <p className="text-secondary-red text-sm text-center mt-2" role="alert">{errorMessage}</p>
          )}

          {isVerifying && (
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-color2 border-t-transparent rounded-full animate-spin" />
              <span className="text-center text-white/60 text-sm font-funnel-sans">
                {verificationStatus === "verifying" && "Verifying OTP..."}
                {verificationStatus === "success" && "Success! Creating wallet..."}
                {verificationStatus === "error" && "Issue verifying code"}
              </span>
            </div>
          )}

          <button
            onClick={handleResendCode}
            className={`text-color2 text-sm hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed font-funnel-sans ${isResending ? 'opacity-50' : ''}`}
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
    <div className="min-h-screen flex items-center justify-center bg-base flex-col gap-1 sm:gap-4 px-4 sm:px-0">
      <form
        onSubmit={handleSubmit}
        className={`w-full max-w-xl p-6 sm:p-12 bg-black rounded-[56px] shadow-xl flex flex-col gap-4 sm:gap-8 transition-all duration-300 ease-in-out border border-white/10 ${isTransitioning ? 'opacity-50' : ''}`}
        aria-label="Login or sign up form"
        noValidate
      >
        {/* Logo */}
        <div className="flex justify-center mb-2 sm:mb-4">
          <Icons.newEarnyLogoWithWhite className="w-32 sm:w-40" />
        </div>

        {/* Welcome Text */}
        <div className="text-center mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold font-funnel-display text-white mb-2">Welcome to Earny</h1>
          <p className="text-white/40 font-funnel-sans text-sm">Your AI-powered earning assistant</p>
        </div>

        {/* Email Input */}
        <div className="bg-white/5 rounded-full flex gap-2 sm:gap-4 px-4 sm:px-10 py-3 sm:py-5 border border-white/10">
          <label htmlFor="email" className="text-base sm:text-[1.375rem] font-funnel-sans text-white/60 flex items-center justify-center">Email</label>
          <input
            type="email"
            id="email"
            name="email"
            placeholder="email@example.com"
            onChange={(e) => setEmail(e.target.value)}
            className={`w-full bg-transparent outline-none font-funnel-sans text-base sm:text-[1.375rem] ml-2 sm:ml-4 text-white placeholder:text-white/40 focus:outline-none focus:ring-0 focus:bg-none`}
            required
          />
        </div>

        <div>
          <LoadingButton
            type="submit"
            className="flex items-center justify-center gap-2 w-full px-6 sm:px-10 py-3 sm:py-5 bg-color2 font-funnel-sans font-medium text-base sm:text-[1.375rem] text-white rounded-full hover:bg-color3 transition-all duration-300 ease-in-out disabled:opacity-70 h-auto shadow-lg"
            disabled={!email || isValidating}
            loading={loadingAction === "email"}
            aria-label="Submit email for verification"
          >
            Create account
          </LoadingButton>
        </div>

        <OrSeparator />

        <LoadingButton
          type="button"
          onClick={handleLoginWithPasskey}
          className="flex items-center justify-center gap-2 w-full px-6 sm:px-10 py-3 sm:py-5 bg-white/5 border border-white/20 font-funnel-sans font-medium text-base sm:text-[1.375rem] text-white rounded-full hover:bg-white/10 transition-all duration-300 ease-in-out disabled:opacity-70 h-auto"
          loading={loadingAction === "passkey"}
          aria-label="Login with passkey"
        >
          <Icons.passkeyIcon className="w-6 h-6" /> Log in with Passkey
        </LoadingButton>

      </form>
      <Captcha />
      <Toaster />
    </div>
  );
}

// Loading component
const LoadingFallback = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-base">
      <div className="text-center">
        <div className="w-12 h-12 sm:w-16 sm:h-16 border-4 border-color2/20 border-t-color2 rounded-full animate-spin"></div>
      </div>
    </div>
  );
};

export default function page() {
  return <Suspense fallback={<LoadingFallback />}><SignUpPage /></Suspense>
}