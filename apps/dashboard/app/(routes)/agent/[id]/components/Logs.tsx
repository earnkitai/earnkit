"use client";

import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

// Transaction type definition
interface Transaction {
    id: string;
    address: string;
    network: string;
    status: "completed" | "pending";
    date: string;
    time: string;
    amount: string;
}

interface LogsProps {
    agentId: string;
}

export default function Logs({ agentId }: LogsProps) {
    // Mock transaction data
    const transactions: Transaction[] = [
        {
            id: "1",
            address: "0x1234567890abcdef1234567890abcdef12345678",
            network: "Ethereum",
            status: "completed",
            date: "23 July 2025",
            time: "14:30:22",
            amount: "$20.55"
        },
        {
            id: "2",
            address: "0x9876543210fedcba9876543210fedcba98765432",
            network: "Polygon",
            status: "pending",
            date: "23 July 2025",
            time: "14:30:22",
            amount: "$20.55"
        },
        {
            id: "3",
            address: "0xabcdef1234567890abcdef1234567890abcdef12",
            network: "Base",
            status: "completed",
            date: "23 July 2025",
            time: "14:30:22",
            amount: "$20.55"
        },
        {
            id: "4",
            address: "0xijklmnopqrstuvwxijklmnopqrstuvwxijklmn",
            network: "Arbitrum",
            status: "completed",
            date: "23 July 2025",
            time: "14:30:22",
            amount: "$20.55"
        },
        {
            id: "5",
            address: "0xqrstuvwxyzabcdefqrstuvwxyzabcdefqrstuv",
            network: "Solana",
            status: "pending",
            date: "23 July 2025",
            time: "14:30:22",
            amount: "$20.55"
        },
        {
            id: "6",
            address: "0xyzaabbccddeeffgghhiijjkkllmmyzaabbcc",
            network: "Optimism",
            status: "completed",
            date: "23 July 2025",
            time: "14:30:22",
            amount: "$20.55"
        },
        {
            id: "7",
            address: "0xdddddeeeeffffgggghhhhiiiijjjjdddddeeee",
            network: "Ethereum",
            status: "completed",
            date: "23 July 2025",
            time: "14:30:22",
            amount: "$20.55"
        },
        {
            id: "8",
            address: "0xfffffggggghhhhhiiiiijjjjjkkkkkfffffgggg",
            network: "Polygon",
            status: "pending",
            date: "23 July 2025",
            time: "14:30:22",
            amount: "$20.55"
        }
    ];

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

    const handleViewTransaction = (transactionId: string) => {
        console.log("Viewing transaction:", transactionId, "for agent:", agentId);
    };

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
                        {transactions.map((transaction, index) => (
                            <div key={transaction.id}>
                                <div className="grid grid-cols-7 items-center py-4 gap-4">
                                    {/* Address */}
                                    <div className="flex justify-center">
                                        <p className="text-sm font-medium text-black font-funnel-sans">
                                            {truncateAddress(transaction.address)}
                                        </p>
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
                                        <p className="text-sm font-semibold text-secondary-green font-funnel-sans">
                                            {transaction.amount}
                                        </p>
                                    </div>

                                    {/* View Button */}
                                    <div className="flex justify-center">
                                        <Button
                                            type="button"
                                            onClick={() => handleViewTransaction(transaction.id)}
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
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
