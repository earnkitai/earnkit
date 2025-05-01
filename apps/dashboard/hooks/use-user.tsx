import { useState, useEffect } from "react"
// import { useRouter } from "next/navigation"
import { usePrivy } from "@privy-io/react-auth"
import { User } from "@/types/user"

export const useUser = () => {
  const { ready, authenticated, user: privyUser } = usePrivy()
  // const router = useRouter()
  const [user, setUser] = useState<User | undefined>(undefined)
  const [isLoading, setIsLoading] = useState<boolean>(true)

  useEffect(() => {
    if (ready) {
      if (!authenticated) {
        // Redirect to login if not authenticated
        // router.push("/login")
        setIsLoading(false)
        return
      }

      if (authenticated && privyUser) {
        // Set the user data when authenticated
        setUser({
          id: privyUser.id,
          email: privyUser.email?.address,
          username: "",
          hasAcceptedTerms: false,
          isGuest: false,
          createdAt: privyUser.createdAt.toISOString(),
          linkedAccounts: [],
          mfaMethods: [],
        })
        setIsLoading(false)
      }
    }
  }, [ready, authenticated, privyUser])

  return { user, isLoading }
}
