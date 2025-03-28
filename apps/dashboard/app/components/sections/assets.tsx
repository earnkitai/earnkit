"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useWallets } from "@/providers/wallet-provider"
import { formatEther } from "viem"
import { useTokenPrice } from "@/hooks/use-token-price"
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/components/ui/table"
import { getTokenBalances } from "@/actions/web3"
import Image from "next/image"
import { Icons } from "./icons"

interface TokenBalance {
  contractAddress: string;
  rawBalance: string;
  decimals: number;
  balance: string;
  logo?: string | undefined;
  name?: string | undefined;
  symbol?: string | undefined;
  metadata: {
    imageUrl: string;
    name: string;
    symbol: string;
    decimals: number;
    priceUsd: number;
  };
}

interface AssetsProps {
  onTotalValueChange?: (value: number) => void;
}

export default function Assets({ onTotalValueChange }: AssetsProps) {
  const { state } = useWallets()
  const { ethPrice } = useTokenPrice()
  const { selectedAccount } = state
  const [tokens, setTokens] = useState<TokenBalance[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const previousAddressRef = useRef<string | undefined>(null)
  const fetchTimeoutRef = useRef<NodeJS.Timeout>(null)

  const fetchTokens = useCallback(async (address: string) => {
    if (!selectedAccount?.address) {
      return
    }
    if (previousAddressRef.current === address && tokens.length > 0) {
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const tokenData = await getTokenBalances(selectedAccount?.address, "base")
      // Filter out any tokens with null balance or error
      console.log(tokenData, 'token data');
      const validTokens = tokenData.filter(token =>
        token.balance !== null &&
        !token.error
      ) as TokenBalance[]
      setTokens(validTokens)
      previousAddressRef.current = address
    } catch (error) {
      console.error("Failed to fetch tokens:", error)
      setError("Failed to load token balances. Please try again later.")
    } finally {
      setIsLoading(false)
    }
  }, [tokens.length, selectedAccount?.address])

  useEffect(() => {
    if (!selectedAccount?.address) {
      setTokens([])
      previousAddressRef.current = undefined
      return
    }

    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current)
    }

    fetchTimeoutRef.current = setTimeout(() => {
      fetchTokens(selectedAccount.address!)
    }, 500)

    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current)
      }
    }
  }, [selectedAccount?.address, fetchTokens])

  const formatTokenAmount = (balance: string, decimals: number) => {
    const amount = BigInt(balance)
    return (Number(amount) / Math.pow(10, decimals)).toFixed(2)
  }

  const ethBalance = selectedAccount?.balance?.baseBalance
    ? parseFloat(Number(formatEther(selectedAccount.balance.baseBalance)).toFixed(8))
    : 0

  const ethValueInUSD = ethPrice ? (ethBalance * ethPrice).toFixed(2) : 'N/A'

  useEffect(() => {
    // Calculate total value including ETH and tokens
    const ethValue = ethPrice ? ethBalance * ethPrice : 0;
    const tokenValues = tokens.reduce((sum, token) => {
      const amount = Number(token.balance);
      if (token.metadata.priceUsd && token.balance !== '0') {
        return sum + (amount * token.metadata.priceUsd);
      }
      return sum;
    }, 0);
    const totalValue = ethValue + tokenValues;
    onTotalValueChange?.(totalValue);
  }, [tokens, ethBalance, ethPrice, onTotalValueChange]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg sm:text-2xl">Tokens</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <div className="overflow-auto max-h-[500px]">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="bg-background">Asset</TableHead>
                  <TableHead className="hidden sm:table-cell bg-background">Symbol</TableHead>
                  <TableHead className="bg-background">Amount</TableHead>
                  <TableHead className="hidden sm:table-cell bg-background">Value (USD)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center">
                      Loading assets...
                    </TableCell>
                  </TableRow>
                ) : error ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-red-500">
                      {error}
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {/* ETH Balance Row */}
                    <TableRow>
                      <TableCell className="p-2 font-medium sm:p-4">
                        <div className="flex items-center space-x-2 text-xs sm:text-sm">
                          <Icons.ethereum className="w-6 h-6" />
                          <span>Ethereum</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs sm:table-cell">
                        ETH
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {ethBalance.toFixed(4)}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        ${ethValueInUSD}
                      </TableCell>
                      <TableCell className="p-2 sm:hidden">
                        <div className="font-medium">
                          {ethBalance.toFixed(4)}
                          <span className="ml-1 text-xs text-muted-foreground">
                            ETH
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          ${ethValueInUSD}
                        </div>
                      </TableCell>
                    </TableRow>

                    {/* Other Tokens */}
                    {tokens.map((token) => (
                      <TableRow key={token.contractAddress}>
                        <TableCell className="p-2 font-medium sm:p-4">
                          <div className="flex items-center space-x-2 text-xs sm:text-sm">
                            {token.metadata.imageUrl ? (
                              <Image
                                src={token.metadata.imageUrl}
                                alt={token.metadata.name}
                                className="h-6 w-6 rounded-full"
                                width={24}
                                height={24}
                              />
                            ) : (
                              <Icons.basetokenImage className="w-6 h-6" />
                            )}
                            <span>{token.name || token.metadata.name || 'N/A'}</span>
                          </div>
                        </TableCell>
                        <TableCell className="hidden font-mono text-xs sm:table-cell">
                          {token.symbol || token.metadata?.symbol || 'N/A'}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {formatTokenAmount(token.rawBalance, token.decimals)}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {token.metadata.priceUsd && token.balance !== '0'
                            ? (Number(formatTokenAmount(token.rawBalance, token.metadata.decimals)) * token.metadata.priceUsd).toFixed(2)
                            : '-'}
                        </TableCell>
                        <TableCell className="p-2 sm:hidden">
                          <div className="font-medium">
                            {formatTokenAmount(token.rawBalance, token.metadata.decimals)}
                            <span className="ml-1 text-xs text-muted-foreground">
                              {token.metadata.symbol}
                            </span>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            ${(Number(formatTokenAmount(token.rawBalance, token.metadata.decimals)) * token.metadata.priceUsd).toFixed(2)}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
