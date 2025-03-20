"use client"

import { useMemo } from "react"
import { useWallets } from "@/providers/wallet-provider"
import { formatEther } from "viem"

import { truncateAddress } from "@/lib/utils"
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

import { Icons } from "./icons"

export default function Assets() {
  const { state } = useWallets()
  const { ethPrice } = useTokenPrice()
  const { selectedAccount } = state

  // Memoize the balances calculation
  // const ethAmount = useMemo(() => {
  //   return selectedAccount?.balance?.ethBalance
  //     ? parseFloat(
  //       Number(formatEther(selectedAccount.balance.ethBalance)).toFixed(8)
  //     ).toString()
  //     : "0"
  // }, [selectedAccount?.balance?.ethBalance])

  const baseAmount = useMemo(() => {
    return selectedAccount?.balance?.baseBalance
      ? parseFloat(
        Number(formatEther(selectedAccount.balance.baseBalance)).toFixed(8)
      ).toString()
      : "0"
  }, [selectedAccount?.balance?.baseBalance])

  // Memoize the values calculation
  // const ethValueInUSD = useMemo(() => {
  //   return (
  //     Number(formatEther(selectedAccount?.balance?.ethBalance ?? BigInt(0))) *
  //     (ethPrice || 0)
  //   ).toFixed(2)
  // }, [selectedAccount?.balance?.ethBalance, ethPrice])

  const baseValueInUSD = useMemo(() => {
    return (
      Number(formatEther(selectedAccount?.balance?.baseBalance ?? BigInt(0))) *
      (ethPrice || 0)
    ).toFixed(2)
  }, [selectedAccount?.balance?.baseBalance, ethPrice])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg sm:text-2xl">Assets</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="">
              <TableHead>Asset</TableHead>
              <TableHead className="hidden sm:table-cell">Address</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead className="hidden sm:table-cell">
                Value (USD)
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="p-2 font-medium sm:p-4">
                <div className="flex items-center space-x-2 text-xs sm:text-sm">
                  <Icons.base className="h-6 w-6 rounded-full" />
                  <span>Base (Mainnet)</span>
                </div>
              </TableCell>
              <TableCell className="hidden font-mono text-xs sm:table-cell">
                {selectedAccount?.address &&
                  truncateAddress(selectedAccount?.address)}
              </TableCell>
              <TableCell className="hidden sm:table-cell">{baseAmount}</TableCell>
              <TableCell className="hidden sm:table-cell">
                ${baseValueInUSD}
              </TableCell>
              <TableCell className="p-2 sm:hidden">
                <div className="font-medium">
                  {baseAmount}
                  <span className="ml-1 text-xs text-muted-foreground">
                    ETH
                  </span>
                </div>
                <div className="text-sm text-muted-foreground">
                  ${baseValueInUSD}
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
