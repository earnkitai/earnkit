import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useTurnkey } from "@turnkey/sdk-react"

import { Email, User } from "@/types/turnkey"

export const useUser = () => {
  const { turnkey } = useTurnkey()
  const router = useRouter()
  const [user, setUser] = useState<User | undefined>(undefined)
  const [isLoading, setIsLoading] = useState<boolean>(true)

  useEffect(() => {
    const fetchUser = async () => {
      try {
        // Try and get the current user
        const currentUser = await turnkey?.getCurrentUser()

        console.log(currentUser, "currentUser")

        // If the user is not found, we assume the user is not logged in
        if (!currentUser) {
          router.push("/")
          setIsLoading(false)
          return
        }

        // Use our read-only session to get the user's email
        const client = await turnkey?.currentUserSession()

        let userData: User = currentUser

        // Get the user's email
        const { user } =
          (await client?.getUser({
            organizationId: currentUser?.organization?.organizationId,
            userId: currentUser?.userId,
          })) || {}

        // Set the user's email in the userData object
        userData = {
          ...currentUser,
          email: user?.userEmail as Email,
        }
        setUser(userData)
      } catch (error) {
        console.error("Error fetching user:", error)
      } finally {
        setIsLoading(false)
      }
    }
    if (turnkey) {
      fetchUser()
    }
  }, [turnkey, router])

  return { user, isLoading }
}
