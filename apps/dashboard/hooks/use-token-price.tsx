import { useEffect, useState } from "react"
import { getTokenPrice } from "@/actions/web3"

export const useTokenPrice = () => {
  const [ethPrice, setEthPrice] = useState<number | undefined>(undefined)
  const [basePrice, setBasePrice] = useState<number | undefined>(undefined)

  useEffect(() => {
    const fetchEthPrice = async () => {
      const ethPrice = await getTokenPrice("ethereum")
      const basePrice = await getTokenPrice("base")
      setEthPrice(ethPrice)
      setBasePrice(basePrice)
    }
    fetchEthPrice()
  }, [])

  return { getTokenPrice, ethPrice, basePrice }
}
