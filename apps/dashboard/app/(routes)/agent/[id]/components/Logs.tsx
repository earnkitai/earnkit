"use client";

import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";

// Transaction type definition
interface Transaction {
    id: string;
    address: string;
    network: string;
    status: "completed" | "pending";
    date: string;
    time: string;
    amount: string;
    transactionHash?: string;
    transactionType: string;
    description?: string;
    toAddress?: string;
}

interface LogsProps {
    agentId: string;
}

export default function Logs({ agentId }: LogsProps) {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);

    // Fetch real transaction data
    useEffect(() => {
        const fetchTransactions = async () => {
            try {
                console.log('Fetching transactions for agent:', agentId);
                const response = await fetch(`/api/agents/${agentId}/transactions`);
                console.log('Response status:', response.status);

                if (response.ok) {
                    const data = await response.json();
                    console.log('Fetched transactions data:', data);
                    setTransactions(data.transactions || []);
                } else {
                    const errorData = await response.json();
                    console.error('Failed to fetch transactions:', errorData);
                }
            } catch (error) {
                console.error('Error fetching transactions:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchTransactions();
    }, [agentId]);

    // Function to truncate address
    const truncateAddress = (address: string) => {
        if (address.length <= 10) return address;
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    };

    const getNetworkBadgeStyle = (network: string) => {
        const styles = {
            "Ethereum": "bg-blue-100 text-blue-700 border-blue-200",
            "Polygon": "bg-purple-100 text-purple-700 border-purple-200",
            "Base": "bg-blue-100 text-blue-700 border-blue-200",
            "Arbitrum": "bg-orange-100 text-orange-700 border-orange-200",
            "Solana": "bg-purple-100 text-purple-700 border-purple-200",
            "Optimism": "bg-red-100 text-red-700 border-red-200"
        };
        return styles[network as keyof typeof styles] || "bg-gray-100 text-gray-700 border-gray-200";
    };

    const getStatusBadgeStyle = (status: string) => {
        if (status === "completed") {
            return "bg-white/80 text-secondary-green border-secondary-green";
        } else {
            return "bg-white/80 text-secondary-orange border-secondary-orange";
        }
    };

    const handleViewTransaction = (transaction: Transaction) => {
        if (transaction.transactionHash) {
            // Open transaction in Base explorer
            window.open(`https://basescan.org/tx/${transaction.transactionHash}`, '_blank');
        } else {
            console.log("No transaction hash available for:", transaction.id);
        }
    };

    if (loading) {
        return (
            <div className="flex-1">
                <Card className="rounded-[20px] shadow-none border border-black/10">
                    <CardContent className="p-8">
                        <div className="flex items-center justify-center py-12">
                            <div className="text-center">
                                <div className="animate-spin h-8 w-8 border-2 border-black/40 border-t-transparent rounded-full mx-auto"></div>
                                <p className="mt-4 text-black/40 font-funnel-sans">Loading transactions...</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="flex-1">
            <Card className="rounded-[20px] shadow-none border border-black/10">
                <CardContent className="p-8">
                    {/* Header */}
                    <div className="mb-8">
                        <h1 className="text-xl font-semibold font-funnel-display text-black mb-2">Transaction History</h1>
                        <p className="text-black/40 text-sm font-funnel-sans">
                            Recent payment transactions collected by your agent
                        </p>
                    </div>

                    {/* Transaction List */}
                    <div className="space-y-0">
                        {transactions.length === 0 ? (
                            <div className="flex items-center justify-center py-12">
                                <div className="text-center">
                                    <p className="text-black/40 font-funnel-sans">No transactions found</p>
                                    <p className="text-xs text-black/20 font-funnel-sans mt-2">
                                        Agent ID: {agentId}
                                    </p>
                                </div>
                            </div>
                        ) : (
                            transactions.map((transaction, index) => (
                                <div key={transaction.id}>
                                    <div className="grid grid-cols-7 items-center py-4 gap-4">
                                        {/* Address */}
                                        <div className="flex justify-center">
                                            <div className="text-center">
                                                <p className="text-sm font-medium text-black font-funnel-sans">
                                                    {truncateAddress(transaction.address)}
                                                </p>
                                                {/* <p className="text-xs text-black/40 font-funnel-sans mt-1">
                                                    {transaction.transactionType}
                                                </p> */}
                                            </div>
                                        </div>

                                        {/* Network Badge */}
                                        <div className="flex justify-center">
                                            <Badge
                                                variant="outline"
                                                className={`text-xs font-medium py-1 px-3 border ${getNetworkBadgeStyle(transaction.network)}`}
                                            >
                                                {transaction.network}
                                            </Badge>
                                        </div>

                                        {/* Status Badge */}
                                        <div className="flex justify-center">
                                            <Badge
                                                variant="outline"
                                                className={cn(
                                                    "font-funnel-sans text-[10px] font-medium py-1 px-3",
                                                    getStatusBadgeStyle(transaction.status)
                                                )}
                                                style={{
                                                    background: transaction.status === "completed"
                                                        ? 'linear-gradient(0deg, rgba(52, 199, 89, 0.2), rgba(52, 199, 89, 0.2))'
                                                        : 'linear-gradient(0deg, rgba(255, 149, 0, 0.2), rgba(255, 149, 0, 0.2))',
                                                }}
                                            >

                                                {transaction.status === "completed" ? "Completed" : "Pending"}
                                            </Badge>
                                        </div>

                                        {/* Date */}
                                        <div className="flex justify-center">
                                            <p className="text-sm text-black/60 font-funnel-sans">
                                                {transaction.date}
                                            </p>
                                        </div>

                                        {/* Time */}
                                        <div className="flex justify-center">
                                            <p className="text-sm text-black/60 font-funnel-sans">
                                                {transaction.time}
                                            </p>
                                        </div>

                                        {/* Amount */}
                                        <div className="flex justify-center">
                                            <p className={`text-sm font-semibold font-funnel-sans ${transaction.amount.startsWith('+')
                                                ? 'text-secondary-green'
                                                : transaction.amount.startsWith('-')
                                                    ? 'text-red-500'
                                                    : 'text-secondary-green'
                                                }`}>
                                                {transaction.amount}
                                            </p>
                                        </div>

                                        {/* View Button */}
                                        <div className="flex justify-center">
                                            <Button
                                                type="button"
                                                onClick={() => handleViewTransaction(transaction)}
                                                variant="outline"
                                                className="flex justify-center items-center px-3 py-0 border border-black/20 text-secondary-blue bg-transparent rounded-full text-xs font-normal font-funnel-sans hover:bg-gray-50"
                                            >
                                                View
                                                <ExternalLink className="w-3 h-3 ml-1" />
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Divider */}
                                    {index < transactions.length - 1 && (
                                        <div className="border-b border-gray-200"></div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
