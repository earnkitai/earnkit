import { useEffect, useRef, useState } from "react"
import { getTokenPrice } from "@/actions/web3"
// import { env } from "@/env.mjs"

export const useTokenPrice = () => {
  const [ethPrice, setEthPrice] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const lastValidPrice = useRef<number | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    const fetchEthPrice = async () => {
      setLoading(true)
      setError(null)
      try {
        const price = await getTokenPrice("ethereum")
        if (!cancelled) {
          setEthPrice(price)
          lastValidPrice.current = price
        }
      } catch {
        if (!cancelled) {
          setError("Failed to fetch ETH price")
          setEthPrice(lastValidPrice.current)

        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchEthPrice()
    return () => { cancelled = true }
  }, [])

  return { ethPrice, loading, error }
}
