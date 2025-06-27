"use client"

import { useEffect } from "react"
import { Card, CardContent } from "@/app/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/components/ui/table"
import Image from "next/image"
import { Icons } from "./icons"
import { Skeleton } from "@/app/components/ui/skeleton"
import { Alert, AlertDescription } from "@/app/components/ui/alert"
import { AlertCircle } from "lucide-react"

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
  tokens: TokenBalance[];
  ethBalance: number | null;
  isLoading: boolean;
  error: string | null;
  ethPrice: number;
}

export default function Assets({ onTotalValueChange, tokens, ethBalance, isLoading, error, ethPrice }: AssetsProps) {
  const formatTokenAmount = (balance: string, decimals: number) => {
    const amount = BigInt(balance)
    return (Number(amount) / Math.pow(10, decimals ?? 18)).toFixed(2)
  }

  const ethValueInUSD = () => {
    return ethPrice && ethBalance ? (ethBalance * ethPrice).toFixed(2) : '0'
  }

  useEffect(() => {
    const ethValue = ethPrice && ethBalance ? ethBalance * ethPrice : 0
    const tokenValues = tokens.reduce((sum, token) => {
      const amount = Number(token.balance)
      if (token.metadata.priceUsd && token.balance !== '0' && (amount * token.metadata.priceUsd) > 0.05) {
        return sum + (amount * token.metadata.priceUsd)
      }
      return sum
    }, 0)
    const totalValue = ethValue + tokenValues
    onTotalValueChange?.(totalValue)
  }, [tokens, ethBalance, ethPrice, onTotalValueChange])

  // Add a utility to calculate portfolio percentages
  const getPortfolioPercentages = (ethValue: number, tokens: TokenBalance[], totalValue: number) => {
    const percentages: { [key: string]: number } = {};
    if (totalValue === 0) return percentages;
    if (ethValue > 0) {
      percentages['ETH'] = (ethValue / totalValue) * 100;
    }
    tokens.forEach(token => {
      const amount = Number(token.balance);
      const value = token.metadata.priceUsd && token.balance !== '0' ? amount * token.metadata.priceUsd : 0;
      if (value > 0) {
        percentages[token.contractAddress] = (value / totalValue) * 100;
      }
    });
    return percentages;
  };

  // Calculate values for portfolio percentages
  const ethValue = ethPrice && ethBalance ? ethBalance * ethPrice : 0;
  const tokenValues = tokens.map(token => {
    const amount = Number(token.balance);
    return token.metadata.priceUsd && token.balance !== '0' ? amount * token.metadata.priceUsd : 0;
  });
  const totalValue = ethValue + tokenValues.reduce((a, b) => a + b, 0);
  const portfolioPercentages = getPortfolioPercentages(ethValue, tokens, totalValue);

  const renderLoadingState = () => (
    <TableRow>
      <TableCell colSpan={4} className="p-2">
        <div className="space-y-2">
          <Skeleton className="h-12 w-full bg-white/10" />
          <Skeleton className="h-12 w-full bg-white/10" />
          <Skeleton className="h-12 w-full bg-white/10" />
          <Skeleton className="h-12 w-full bg-white/10" />
          <Skeleton className="h-12 w-full bg-white/10" />
          <Skeleton className="h-12 w-full bg-white/10" />
        </div>
      </TableCell>
    </TableRow>
  )

  const renderErrorState = () => (
    <TableRow>
      <TableCell colSpan={4} className="p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </TableCell>
    </TableRow>
  )

  const renderEmptyState = () => (
    <TableRow>
      <TableCell colSpan={4} className="p-4 text-center text-muted-foreground">
        No tokens found in this wallet
      </TableCell>
    </TableRow>
  )

  return (
    <Card className="bg-transparent border-none">
      <CardContent className="p-0">
        <div className="relative">
          <div className="overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-black z-10 font-funnel-sans text-[18px] font-medium ">
                <TableRow className="border-none">
                  <TableHead className="bg-transparent text-color1 pb-4">Asset</TableHead>
                  <TableHead className="hidden sm:table-cell bg-transparent text-color1 pb-4">Balance</TableHead>
                  <TableHead className="bg-transparent text-color1 pb-4">Portfolio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? renderLoadingState() :
                  error ? renderErrorState() :
                    tokens.length === 0 && !ethBalance ? renderEmptyState() :
                      (
                        <>
                          {/* ETH Balance Row */}
                          {ethBalance && ethBalance > 0 && (
                            <TableRow className="border-none">
                              <TableCell className="p-2 font-medium sm:p-4">
                                <div className="flex items-center space-x-2 text-xs sm:text-sm gap-1">
                                  <div className="relative w-8 h-8 flex items-center justify-center rounded-full">
                                    <Icons.ethereum className="w-8 h-8" />
                                    <Icons.baseIcon className="w-[14px] h-[14px] absolute top-[-2px] left-[-2px]" />
                                  </div>
                                  <div className="flex flex-col items-start text-white/40 font-funnel-sans text-[18px]">
                                    <span className="font-semibold">Ethereum</span>
                                    <span className="font-normal text-[14px]">ETH</span>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="hidden sm:table-cell">
                                <div className="text-[20px] font-semibold text-white font-funnel-sans">${ethValueInUSD()}</div>
                                <div className="text-[14px] text-white/40 font-funnel-sans">{ethBalance ? ethBalance.toFixed(4) : 'N/A'}</div>
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-col items-start gap-2 w-40">
                                  <div className="w-full h-3 rounded-full bg-white/10 overflow-hidden">
                                    <div
                                      className="h-full rounded-full bg-white/40 transition-all duration-300"
                                      style={{ width: `${portfolioPercentages['ETH']}%` }}
                                    />
                                  </div>
                                  <span className="text-white/40 font-funnel-sans text-left">{(portfolioPercentages['ETH'] || 0).toFixed(2)}%</span>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                          {/* Other Tokens */}
                          {tokens.map((token) => {
                            const percent = portfolioPercentages[token.contractAddress] || 0;
                            return (
                              <TableRow key={token.contractAddress} className="border-none">
                                <TableCell className="p-2 font-medium sm:p-4">
                                  <div className="flex items-center space-x-2 text-xs sm:text-sm gap-1">
                                    <div className="relative w-8 h-8 flex items-center justify-center rounded-full border-none">
                                      {token.metadata.imageUrl ? (
                                        <>
                                          <Image
                                            src={token.metadata.imageUrl}
                                            alt={token.metadata.name}
                                            className="h-8 w-8 rounded-full"
                                            width={32}
                                            height={32}
                                          />
                                          <Icons.baseIcon className="w-[14px] h-[14px] absolute top-[-2px] left-[-2px]" />
                                        </>
                                      ) : (
                                        <>
                                          <Icons.basetokenImage className="w-8 h-8" />
                                          <Icons.baseIcon className="w-[14px] h-[14px] absolute top-[-2px] left-[-2px]" />
                                        </>
                                      )}
                                    </div>
                                    <div className="flex flex-col items-start text-white/40 font-funnel-sans text-[18px]">
                                      <span className="font-semibold">{token.name || token.metadata.name || 'N/A'}</span>
                                      <span className="font-normal text-[14px]">{token.symbol || token.metadata.symbol}</span>
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell className="hidden sm:table-cell">
                                  <div className="text-[20px] font-semibold text-white font-funnel-sans">${(Number(formatTokenAmount(token.rawBalance, token.metadata.decimals ?? 18)) * token.metadata.priceUsd).toFixed(2)}</div>
                                  <div className="text-[14px] text-white/40 font-funnel-sans">{formatTokenAmount(token.rawBalance, token.decimals ?? 18)}</div>
                                </TableCell>
                                <TableCell className="py-8">
                                  <div className="flex flex-col items-start gap-2 w-40">
                                    <div className="w-full h-3 rounded-full bg-white/10 overflow-hidden">
                                      <div
                                        className="h-full rounded-full bg-white/40 transition-all duration-300"
                                        style={{ width: `${percent}%` }}
                                      />
                                    </div>
                                    <span className="text-white/40 font-funnel-sans text-left">{percent.toFixed(2)}%</span>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
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
