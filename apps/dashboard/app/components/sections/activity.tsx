"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useTransactions } from "@/providers/transactions-provider"
import { ExternalLink } from "lucide-react"
import { Account, formatEther } from "viem"

import type { Transaction } from "@/types/web3"
// import { useTokenPrice } from "@/hooks/use-token-price"
import { Card, CardContent } from "@/app/components/ui/card"
import { Skeleton } from "@/app/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/components/ui/table"

import { base } from "viem/chains"
import { useActiveWallet, usePrivy } from "@privy-io/react-auth"
import { Icons } from "./icons"

export default function Activity() {
  const { transactions: allTransactions, loading } = useTransactions()
  // const { ethPrice } = useTokenPrice()
  const { ready, authenticated, user: privyUser } = usePrivy()
  const { wallet: activeWallet } = useActiveWallet()
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);

  const [transactions, setTransactions] = useState<Transaction[]>([])

  useEffect(() => {
    if (ready && authenticated && privyUser) {
      setSelectedAccount(activeWallet ? activeWallet as unknown as Account : privyUser?.wallet as unknown as Account)
    }
  }, [ready, authenticated, privyUser, activeWallet])

  useEffect(() => {
    const fetchTransactions = async () => {
      if (
        selectedAccount?.address &&
        allTransactions[selectedAccount.address]
      ) {
        setTransactions(allTransactions[selectedAccount.address])
      }
    }
    fetchTransactions()
  }, [allTransactions, selectedAccount])

  return (
    <Card className="bg-transparent border-none">
      <CardContent className="p-0">
        <div className="relative">
          <div className="overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-black z-10 font-funnel-sans text-[18px] font-medium ">
                <TableRow className="border-none">
                  <TableHead className="bg-transparent text-color1 pb-4">Action</TableHead>
                  <TableHead className="bg-transparent text-color1 pb-4">Value</TableHead>
                  <TableHead className="bg-transparent text-color1 pb-4">Timestamp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <Skeleton className="h-12 w-full bg-white/10" />
                      <Skeleton className="h-12 w-full bg-white/10 mt-2" />
                      <Skeleton className="h-12 w-full bg-white/10 mt-2" />
                    </TableCell>
                  </TableRow>
                ) : transactions.length > 0 ? (
                  transactions.map((transaction, index) => {
                    // Determine action type and icon
                    let actionLabel = '';
                    let icon = null;
                    let iconColor = '';
                    let valueContent = null;
                    if (transaction.status === 'received') {
                      actionLabel = 'Deposit';
                      icon = <Icons.earnyActivityDownArrowIcon className="w-7 h-7 text-secondary-green" />;
                      iconColor = 'text-white/40 ';
                      valueContent = (
                        <div className="flex items-center gap-2 text-white text-[22px] font-funnel-sans font-semibold">
                          {Number(formatEther(BigInt(transaction.value ?? 0))).toFixed(2)}
                          <span className="ml-2 px-3 py-1 rounded-full bg-black border border-white/10 text-white/80 text-[12px] font-semibold flex items-center gap-1">
                            {/* Token icon if available */}
                            {transaction.asset === 'ETH' && <Icons.ethereum className="w-4 h-4 inline-block mr-1" />}
                            {transaction.asset}
                          </span>
                          <span className="ml-2 text-white/40 text-[14px] font-normal">from</span>
                          <span className="ml-2 px-3 py-1 rounded-full bg-black border border-white/10 text-blue-400 text-[12px] font-semibold">{transaction.from.slice(0, 6)}...{transaction.from.slice(-4)}</span>
                        </div>
                      );
                    } else {
                      actionLabel = 'Send';
                      icon = <Icons.earnyActivityUpArrowIcon className="w-7 h-7 text-white/40" />;
                      iconColor = 'text-white/40 ';
                      valueContent = (
                        <div className="flex items-center gap-2 text-white text-[22px] font-funnel-sans font-semibold">
                          {Number(formatEther(BigInt(transaction.value ?? 0))).toFixed(2)}
                          <span className="ml-2 px-3 py-1 rounded-full bg-black border border-white/10 text-white/80 text-[12px] font-normal flex items-center gap-1">
                            {transaction.asset}
                          </span>
                          <span className="ml-2 text-white/40 text-[16px] font-normal">to</span>
                          <span className="ml-2 px-3 py-1 rounded-full bg-black border border-white/10 text-blue-400 text-[12px] font-normal">{transaction.to ? `${transaction.to.slice(0, 6)}...${transaction.to.slice(-4)}` : 'Unknown'}</span>
                        </div>
                      );
                    }
                    return (
                      <TableRow key={index} className="border-none">
                        <TableCell className="py-8">
                          <div className={`flex items-center gap-3 font-funnel-sans text-[22px] font-semibold ${iconColor}`}>
                            {icon}
                            <span className={iconColor}>{actionLabel}</span>
                          </div>
                        </TableCell>
                        <TableCell className="py-8">{valueContent}</TableCell>
                        <TableCell className="py-8">
                          <div className="flex items-center gap-2 text-white/40 text-[18px] font-funnel-sans">
                            {new Date(transaction.timestamp).toLocaleDateString('en-GB', {
                              day: 'numeric',
                              month: 'long',
                              year: 'numeric',
                            })}
                            <Link href={`${base.blockExplorers.default.url}/tx/${transaction.hash}`} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="w-4 h-4 text-white/40 ml-2" />
                            </Link>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-12">
                      No activity. Send or receive ETH to see transactions here.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
