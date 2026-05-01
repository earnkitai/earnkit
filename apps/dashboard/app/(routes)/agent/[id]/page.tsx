"use client";

import { useState, use, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { ToggleSlider } from "@/app/components/ui/toggle-slider";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/app/components/ui/dialog";
import { ChevronRight, Copy, Trash2 } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Logs from "./components/Logs";
import WithdrawModal from "./components/WithdrawModal";
import { TokenConfigPanel } from "@/app/components/TokenConfigPanel";
import { createPublicClient, http, keccak256, encodePacked } from 'viem';
import { base } from 'viem/chains';
import earnkitABI from '@/contract/earnkit_ABI.json';
import { type Abi } from 'viem';

// Contract configuration
const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ADDRESS || '0xCAeB6A62D04C52E1e196E5Bdce63e43f45582aA2';
const CONTRACT_ABI = earnkitABI as unknown as Abi;

// Agent type definition matching the database schema
interface Agent {
    id: string;
    name: string;
    agentId: string;
    status: "ACTIVE" | "PAUSED" | "DELETED";
    feeModel: "FREE_TIER" | "CREDIT_BASED";
    freePromptThreshold: number | null;
    ratePerPrompt: number | null;
    creditsPerPrompt: number | null;
    totalEarnings: number;
    createdAt: string;
    topUpPackages: Array<{
        id: string;
        name: string;
        credits: number;
        price: number;
        isActive: boolean;
    }>;
    transactionLogs: Array<{
        id: string;
        amount: number;
        createdAt: string;
        status: string;
        transactionType: string;
    }>;
    _count: {
        transactionLogs: number;
    };
}

// Token balance interface
interface TokenBalance {
    symbol: string;
    address: string;
    balance: string;
    balanceUsd: number;
}

// Earnings data interface
interface EarningsData {
    totalEarnings: number;
    totalWithdrawals: number;
    availableBalance: number;
    availableBalanceEth: number;
    tokenBalances: TokenBalance[];
    agentEarnings: number;
}

export default function AgentPage({ params }: { params: Promise<{ id: string }> }) {
    const resolvedParams = use(params);
    const { ready, authenticated, user: privyUser } = usePrivy();
    const router = useRouter();
    const [agent, setAgent] = useState<Agent | null>(null);
    const [earningsData, setEarningsData] = useState<EarningsData | null>(null);
    const [freshBalanceData, setFreshBalanceData] = useState<{
        ethBalance: number;
        usdBalance: number;
        ethPrice: number;
    } | null>(null);
    const [loading, setLoading] = useState(true);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [showWithdrawModal, setShowWithdrawModal] = useState(false);

    // Get the authenticated user ID
    useEffect(() => {
        if (ready && authenticated && privyUser) {
            const userId = privyUser?.id.split(':').pop() || privyUser?.id;
            console.log(userId, 'userId');
        } else if (ready && !authenticated) {
            // Redirect to login if not authenticated
            router.push("/welcome-back");
        }
    }, [ready, authenticated, privyUser, router]);

    // Fetch agent data when userId is available
    useEffect(() => {
        const fetchAgent = async () => {
            if (!resolvedParams.id) return;

            try {
                const response = await fetch(`/api/agents/${resolvedParams.id}`);
                if (response.ok) {
                    const data = await response.json();
                    setAgent(data.agent);
                } else {
                    console.error('Failed to fetch agent');
                    toast.error('Failed to load agent details');
                }
            } catch (error) {
                console.error('Error fetching agent:', error);
                toast.error('Error loading agent details');
            } finally {
                setLoading(false);
            }
        };

        fetchAgent();
    }, [resolvedParams.id]);

    // Fetch earnings data
    useEffect(() => {
        const fetchEarnings = async () => {
            if (!resolvedParams.id) return;

            try {
                const response = await fetch(`/api/agents/${resolvedParams.id}/earnings`);
                if (response.ok) {
                    const data = await response.json();
                    setEarningsData(data);
                } else {
                    console.error('Failed to fetch earnings data');
                }
            } catch (error) {
                console.error('Error fetching earnings data:', error);
            }
        };

        fetchEarnings();
    }, [resolvedParams.id]);

    // Fetch fresh contract balance and ETH price
    useEffect(() => {
        const fetchFreshBalance = async () => {
            if (!agent?.agentId) return;

            try {
                // Create public client for contract calls
                const publicClient = createPublicClient({
                    chain: base,
                    transport: http(),
                });

                // Convert agentId to bytes32
                const agentIdBytes32 = keccak256(encodePacked(['string'], [agent.agentId]));

                // Fetch contract balance
                const balance = await publicClient.readContract({
                    address: CONTRACT_ADDRESS as `0x${string}`,
                    abi: CONTRACT_ABI,
                    functionName: 'agentBalance',
                    args: [agentIdBytes32],
                });

                const ethBalance = Number(balance) / 1e18;

                // Fetch fresh ETH price
                const { priceService } = await import('@/lib/priceService');
                const ethPrice = await priceService.getEthPrice();

                // Calculate USD balance
                const usdBalance = ethBalance * ethPrice;

                setFreshBalanceData({
                    ethBalance,
                    usdBalance,
                    ethPrice,
                });

                console.log('Fresh balance data:', {
                    ethBalance,
                    usdBalance,
                    ethPrice,
                    agentId: agent.agentId,
                });
            } catch (error) {
                console.error('Error fetching fresh balance:', error);
                // If the live read fails, leave freshBalanceData unset so the UI
                // falls back to the earnings API values (which already have the
                // contract balance) instead of fabricating a price.
            }
        };

        fetchFreshBalance();
    }, [agent?.agentId, earningsData]);

    const [formData, setFormData] = useState({
        name: "",
        agentId: "",
        feeModel: "free-tier" as "free-tier" | "credit-based",
        freePromptThreshold: "",
        ratePerPrompt: "",
        creditsPerPrompt: "",
        topUpPackages: [] as Array<{ id: string; credits: string; price: string }>,
        isPaused: false
    });

    // Update form data when agent is loaded
    useEffect(() => {
        if (agent) {
            setFormData({
                name: agent.name,
                agentId: agent.agentId,
                feeModel: agent.feeModel === "FREE_TIER" ? "free-tier" : "credit-based",
                freePromptThreshold: agent.freePromptThreshold?.toString() || "",
                ratePerPrompt: agent.ratePerPrompt?.toString() || "",
                creditsPerPrompt: agent.creditsPerPrompt?.toString() || "",
                topUpPackages: agent.topUpPackages.map(pkg => ({
                    id: pkg.id,
                    credits: pkg.credits.toString(),
                    price: pkg.price.toString()
                })),
                isPaused: agent.status === "PAUSED"
            });
        }
    }, [agent]);

    // Update form data when agent is loaded
    useEffect(() => {
        if (agent) {
            setFormData({
                name: agent.name,
                agentId: agent.agentId,
                feeModel: agent.feeModel === "FREE_TIER" ? "free-tier" : "credit-based",
                freePromptThreshold: agent.freePromptThreshold?.toString() || "",
                ratePerPrompt: agent.ratePerPrompt?.toString() || "",
                creditsPerPrompt: agent.creditsPerPrompt?.toString() || "",
                topUpPackages: agent.topUpPackages.map(pkg => ({
                    id: pkg.id,
                    credits: pkg.credits.toString(),
                    price: pkg.price.toString()
                })),
                isPaused: agent.status === "PAUSED"
            });
        }
    }, [agent]);

    const [activeView, setActiveView] = useState<"overview" | "logs">("overview");

    // Generate real chart data from transaction logs
    const generateChartData = () => {
        if (!agent || !agent.transactionLogs.length) {
            return [
                { month: "JAN", value: 0 },
                { month: "FEB", value: 0 },
                { month: "MAR", value: 0 },
                { month: "APR", value: 0 },
                { month: "MAY", value: 0 },
                { month: "JUN", value: 0 }
            ];
        }

        const now = new Date();
        const months = [];
        const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

        // Get last 6 months
        for (let i = 5; i >= 0; i--) {
            const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const monthName = monthNames[date.getMonth()];
            const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
            const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);

            // Filter transactions for this month
            const monthTransactions = agent.transactionLogs.filter(log => {
                const logDate = new Date(log.createdAt);
                return logDate >= startOfMonth && logDate <= endOfMonth;
            });

            // Sum up earnings for this month
            const monthEarnings = monthTransactions.reduce((sum, log) => sum + log.amount, 0);

            months.push({ month: monthName, value: monthEarnings });
        }

        return months;
    };

    const chartData = generateChartData();
    const maxValue = Math.max(...chartData.map(d => d.value), 1);
    const chartHeight = 192;
    const chartWidth = 400;

    const handleInputChange = (field: string, value: string) => {
        setFormData(prev => ({
            ...prev,
            [field]: value
        }));
    };

    const copyAgentId = () => {
        navigator.clipboard.writeText(formData.agentId);
        toast.success("Agent ID copied to clipboard");
    };

    const handleSaveChanges = async () => {
        if (!agent) return;

        const loadingToast = toast.loading("Saving changes...");

        try {
            // Prepare update data based on fee model
            const updateData: {
                name: string;
                freePromptThreshold?: string;
                ratePerPrompt?: string;
                creditsPerPrompt?: string;
                topUpPackages?: Array<{ id: string; credits: string; price: string }>;
            } = {
                name: formData.name,
            };

            // Add fee model specific fields
            if (formData.feeModel === "free-tier") {
                updateData.freePromptThreshold = formData.freePromptThreshold;
                updateData.ratePerPrompt = formData.ratePerPrompt;
            } else if (formData.feeModel === "credit-based") {
                updateData.creditsPerPrompt = formData.creditsPerPrompt;
                updateData.topUpPackages = formData.topUpPackages;
            }

            const response = await fetch(`/api/agents/${agent.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(updateData),
            });

            if (response.ok) {
                const result = await response.json();
                console.log("Agent updated successfully:", result);

                toast.dismiss(loadingToast);
                toast.success("Agent updated successfully!");

                // Refresh agent data
                const refreshResponse = await fetch(`/api/agents/${agent.id}`);
                if (refreshResponse.ok) {
                    const data = await refreshResponse.json();
                    setAgent(data.agent);
                }
            } else {
                const error = await response.json();
                console.error("Error updating agent:", error);
                toast.dismiss(loadingToast);
                toast.error(`Failed to update agent: ${error.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error("Error updating agent:", error);
            toast.dismiss(loadingToast);
            toast.error("An error occurred while updating the agent.");
        }
    };

    const handleCancel = () => {
        if (agent) {
            setFormData({
                name: agent.name,
                agentId: agent.agentId,
                feeModel: agent.feeModel === "FREE_TIER" ? "free-tier" : "credit-based",
                freePromptThreshold: agent.freePromptThreshold?.toString() || "",
                ratePerPrompt: agent.ratePerPrompt?.toString() || "",
                creditsPerPrompt: agent.creditsPerPrompt?.toString() || "",
                topUpPackages: agent.topUpPackages.map(pkg => ({
                    id: pkg.id,
                    credits: pkg.credits.toString(),
                    price: pkg.price.toString()
                })),
                isPaused: agent.status === "PAUSED"
            });
        }
        toast.success("Changes discarded");
    };

    const handlePauseAgent = async () => {
        if (!agent) return;

        const newStatus = agent.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
        const actionText = newStatus === "PAUSED" ? "pausing" : "activating";
        const successText = newStatus === "PAUSED" ? "paused" : "activated";

        const loadingToast = toast.loading(`${actionText.charAt(0).toUpperCase() + actionText.slice(1)} agent...`);

        try {
            const response = await fetch(`/api/agents/${agent.id}/status`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    status: newStatus,
                }),
            });

            if (response.ok) {
                const result = await response.json();
                toast.dismiss(loadingToast);
                toast.success(`Agent ${successText} successfully!`);

                // Update local agent state with new status
                setAgent(prev => prev ? { ...prev, status: result.agent.status } : null);
            } else {
                const error = await response.json();
                console.error("Error updating agent status:", error);
                toast.dismiss(loadingToast);
                toast.error(`Failed to ${actionText} agent: ${error.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error("Error updating agent status:", error);
            toast.dismiss(loadingToast);
            toast.error(`An error occurred while ${actionText} the agent.`);
        }
    };

    const handleDeleteAgent = async () => {
        if (!agent) return;

        const loadingToast = toast.loading("Deleting agent...");

        try {
            const response = await fetch(`/api/agents/${agent.id}`, {
                method: 'DELETE',
            });

            if (response.ok) {
                toast.dismiss(loadingToast);
                toast.success("Agent deleted successfully!");
                setShowDeleteDialog(false);
                router.push('/home');
            } else {
                const error = await response.json();
                console.error("Error deleting agent:", error);
                toast.dismiss(loadingToast);
                toast.error(`Failed to delete agent: ${error.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error("Error deleting agent:", error);
            toast.dismiss(loadingToast);
            toast.error("An error occurred while deleting the agent.");
        }
    };

    // Show loading state while checking authentication or fetching data
    if (!ready || !authenticated || loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin h-8 w-8 border-2 border-black/40 border-t-transparent rounded-full"></div>
                    <p className="mt-4 text-black/40 font-funnel-sans">Loading...</p>
                </div>
            </div>
        );
    }

    // Show error state if agent not found
    if (!agent) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <h2 className="text-2xl font-semibold text-black mb-4">Agent Not Found</h2>
                    <p className="text-black/40 mb-6">The agent you&apos;re looking for doesn&apos;t exist or has been deleted.</p>
                    <Button onClick={() => router.push('/home')} className="bg-secondary-green hover:bg-green-700 text-white">
                        Back to Agents
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen">
            <div className="max-w-7xl">
                {/* Breadcrumb Navigation */}
                <div className="mb-[60px] flex justify-between items-center">
                    <div className="flex items-center gap-2 text-sm">
                        <Link href="/home" className="text-black/40 font-funnel-display font-semibold text-xl hover:text-black/60 transition-colors cursor-pointer">
                            My Agents
                        </Link>
                        <ChevronRight className="w-6 h-6 text-black/20 font-semibold " />
                        <span className="text-color1 font-funnel-display font-semibold text-xl transition-colors">{agent.name}</span>
                        <Badge
                            variant="default"
                            className={`${agent.status === "ACTIVE" ? 'bg-white/80 text-secondary-green border-secondary-green' : 'bg-white/80 text-black/30 border-black/30'} font-funnel-sans text-[12px] font-medium py-0.5 px-4 ml-2`}
                            style={{
                                background: agent.status === "ACTIVE" ? 'linear-gradient(0deg, rgba(52, 199, 89, 0.2), rgba(52, 199, 89, 0.2))' : 'linear-gradient(0deg, rgba(0, 0, 0, 0.04), rgba(0, 0, 0, 0.04))',
                            }}
                        >
                            <div className={`w-1.5 h-1.5 rounded-full mr-1 ${agent.status === "ACTIVE" ? 'bg-secondary-green' : 'bg-black/30'}`}></div>
                            {agent.status === "ACTIVE" ? "Active" : agent.status === "PAUSED" ? "Paused" : "Deleted"}
                        </Badge>
                    </div>

                    {/* Toggle slider for Overview and Logs switching */}
                    <div className="flex items-center">
                        <ToggleSlider
                            options={[
                                { value: "overview", label: "Overview", textColor: "text-black" },
                                { value: "logs", label: "Logs", textColor: "text-black" }
                            ]}
                            value={activeView}
                            onChange={(value) => setActiveView(value as "overview" | "logs")}
                            selectedBgColor="bg-white"
                            unselectedBgColor="bg-transparent"
                            containerClassName="bg-black/10 p-2.5 rounded-full"
                        />
                    </div>

                </div>

                <div className="flex items-start justify-between gap-6">
                    {/* Left Section - Main Content */}
                    <div className="flex-1">
                        {activeView === "overview" ? (
                            <>
                            {/* Main Content Card */}
                            <Card className="rounded-[20px] shadow-none border border-black/10">
                                <CardContent className="p-8">
                                    {/* Header */}
                                    <div className="mb-8">
                                        <h1 className="text-xl font-semibold font-funnel-display text-black mb-2">Monetisation Settings</h1>
                                        <p className="text-black/40 text-sm font-funnel-sans">
                                            Configure how your agent generates revenue. Adjust pricing models, free tier limits, and monetization parameters to optimize earnings while providing value to users.
                                        </p>
                                    </div>

                                    {/* Form */}
                                    <form onSubmit={(e) => { e.preventDefault(); handleSaveChanges(); }}>
                                        <div className="space-y-8">
                                            {/* Agent Name Section */}
                                            <div className="space-y-3">
                                                <label className="block text-sm font-semibold text-black font-funnel-sans px-4">
                                                    Agent Name
                                                </label>
                                                <Input
                                                    type="text"
                                                    placeholder="Enter agent name"
                                                    value={formData.name}
                                                    onChange={(e) => handleInputChange("name", e.target.value)}
                                                    className="w-full p-4 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                                />
                                                <p className="text-xs text-black/40 font-funnel-sans px-4">
                                                    Choose a descriptive name that clearly identifies your agent&apos;s purpose and functionality.
                                                </p>
                                            </div>

                                            {/* Agent ID Section */}
                                            <div className="space-y-3">
                                                <label className="block text-sm font-semibold text-black font-funnel-sans px-4">
                                                    Agent ID
                                                </label>
                                                <div className="flex gap-2">
                                                    <Input
                                                        type="text"
                                                        value={formData.agentId}
                                                        readOnly
                                                        className="flex-1 p-4 border border-gray-200 rounded-lg bg-gray-50"
                                                    />
                                                    <Button
                                                        type="button"
                                                        onClick={copyAgentId}
                                                        className="px-4 py-4 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg"
                                                    >
                                                        <Copy className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                                <p className="text-xs text-black/40 font-funnel-sans px-4">
                                                    Unique identifier for your agent. Use this ID to integrate EarnKit monetization with your agent&apos;s code.
                                                </p>
                                            </div>

                                            {/* Fee Model Section */}
                                            <div className="space-y-3">
                                                <label className="block text-sm font-semibold text-black font-funnel-sans px-4">
                                                    Fee Model
                                                </label>
                                                <ToggleSlider
                                                    options={[
                                                        { value: "free-tier", label: "Free Tier", textColor: "text-secondary-blue" },
                                                        { value: "credit-based", label: "Credit Based", textColor: "text-secondary-purple" }
                                                    ]}
                                                    value={formData.feeModel}
                                                    onChange={() => { }}
                                                    selectedBgColor="bg-white"
                                                    unselectedBgColor="bg-transparent"
                                                    padding="p-2.5"
                                                    height="h-10"
                                                    containerClassName="bg-black/10 p-2.5"
                                                    disabled
                                                />
                                                <p className="text-xs text-black/40 font-funnel-sans px-4">
                                                    Fee model cannot be changed after agent creation. Free Tier: Offer free prompts before charging. Credit Based: Charge immediately per prompt.
                                                </p>
                                            </div>

                                            {/* Free Prompt Threshold Section (only show for Free Tier) */}
                                            {formData.feeModel === "free-tier" && (
                                                <div className="space-y-3">
                                                    <label className="block text-sm font-semibold text-black font-funnel-sans px-4">
                                                        Free Prompt Threshold
                                                    </label>
                                                    <Input
                                                        type="number"
                                                        placeholder="e.g. 10"
                                                        value={formData.freePromptThreshold}
                                                        onChange={(e) => handleInputChange("freePromptThreshold", e.target.value)}
                                                        className="w-full p-4 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                                    />
                                                    <p className="text-xs text-black/40 font-funnel-sans px-4">
                                                        Number of free prompts each user gets before being charged. Helps build trust and allows users to test your agent.
                                                    </p>
                                                </div>
                                            )}

                                            {/* Rate per Prompt Section (only show for Free Tier) */}
                                            {formData.feeModel === "free-tier" && (
                                                <div className="space-y-3">
                                                    <label className="block text-sm font-semibold text-black font-funnel-sans px-4">
                                                        Rate per Prompt (in USD)
                                                    </label>
                                                    <Input
                                                        type="number"
                                                        step="0.01"
                                                        placeholder="e.g. 0.10"
                                                        value={formData.ratePerPrompt}
                                                        onChange={(e) => handleInputChange("ratePerPrompt", e.target.value)}
                                                        className="w-full p-4 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                                    />
                                                    <p className="text-xs text-black/40 font-funnel-sans px-4">
                                                        Price per prompt in USD. Consider your agent&apos;s value and complexity when setting rates. Typical range: $0.01 - $0.50.
                                                    </p>
                                                </div>
                                            )}

                                            {/* Credits per Prompt Section (only show for Credit Based) */}
                                            {formData.feeModel === "credit-based" && (
                                                <div className="space-y-3">
                                                    <label className="block text-sm font-semibold text-black font-funnel-sans px-4">
                                                        Number of Credits per Prompt
                                                    </label>
                                                    <Input
                                                        type="number"
                                                        placeholder="e.g. 5 (Credits deducted from user's balance per prompt)"
                                                        value={formData.creditsPerPrompt}
                                                        onChange={(e) => handleInputChange("creditsPerPrompt", e.target.value)}
                                                        className="w-full p-4 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                                    />
                                                    <p className="text-xs text-black/40 font-funnel-sans px-4">
                                                        Number of credits consumed per prompt.
                                                    </p>
                                                </div>
                                            )}

                                            {/* Top-up Packages Section (only show for Credit Based) */}
                                            {formData.feeModel === "credit-based" && (
                                                <div className="space-y-3">
                                                    <label className="block text-sm font-semibold text-black font-funnel-sans px-4">
                                                        Create Top-up Packages
                                                    </label>
                                                    <div className="bg-black/4 rounded-[20px] p-6 border border-black/10">
                                                        {formData.topUpPackages.map((pkg, index) => (
                                                            <div key={pkg.id} className="bg-white rounded-lg p-4 mb-4 border border-black/10">
                                                                <div className="flex flex-row gap-10 items-end w-full">
                                                                    <div>
                                                                        <label className="block text-sm font-semibold text-black mb-2">
                                                                            Number of Credits
                                                                        </label>
                                                                        <Input
                                                                            type="number"
                                                                            placeholder="e.g. 1000"
                                                                            value={pkg.credits}
                                                                            onChange={(e) => {
                                                                                const newPackages = [...formData.topUpPackages];
                                                                                newPackages[index].credits = e.target.value;
                                                                                setFormData(prev => ({
                                                                                    ...prev,
                                                                                    topUpPackages: newPackages
                                                                                }));
                                                                            }}
                                                                            className="w-full p-3 border border-black/10 rounded-lg bg-black/4"
                                                                        />
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-sm font-semibold text-black mb-2">
                                                                            Package Price (in USD)
                                                                        </label>
                                                                        <div className="flex gap-2">
                                                                            <Input
                                                                                type="number"
                                                                                step="0.01"
                                                                                placeholder="e.g. 0.50"
                                                                                value={pkg.price}
                                                                                onChange={(e) => {
                                                                                    const newPackages = [...formData.topUpPackages];
                                                                                    newPackages[index].price = e.target.value;
                                                                                    setFormData(prev => ({
                                                                                        ...prev,
                                                                                        topUpPackages: newPackages
                                                                                    }));
                                                                                }}
                                                                                className="flex-1 p-3 border border-black/10 rounded-lg bg-black/4"
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                    {formData.topUpPackages.length > 1 && (
                                                                        <Button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                const newPackages = formData.topUpPackages.filter((_, i) => i !== index);
                                                                                setFormData(prev => ({
                                                                                    ...prev,
                                                                                    topUpPackages: newPackages
                                                                                }));
                                                                            }}
                                                                            className="ml-auto px-6 py-4 bg-red-500 hover:bg-red-600 text-white rounded-full font-normal font-funnel-sans"
                                                                        >
                                                                            Remove
                                                                        </Button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                        <Button
                                                            type="button"
                                                            onClick={() => {
                                                                const newPackage = {
                                                                    id: Date.now().toString(),
                                                                    credits: "",
                                                                    price: ""
                                                                };
                                                                setFormData(prev => ({
                                                                    ...prev,
                                                                    topUpPackages: [...prev.topUpPackages, newPackage]
                                                                }));
                                                            }}
                                                            className="bg-secondary-green hover:bg-green-700 text-white px-8 py-6 rounded-full font-normal font-funnel-sans mt-8"
                                                        >
                                                            Add Package
                                                        </Button>
                                                    </div>
                                                    <p className="text-xs text-black/40 font-funnel-sans mt-3 px-4">
                                                        Create different credit packages for users to purchase. Offer bulk discounts to encourage larger purchases.
                                                    </p>
                                                </div>
                                            )}
                                        </div>

                                        {/* Action Buttons */}
                                        <div className="flex gap-4 mt-24">
                                            <Button
                                                type="submit"
                                                className="bg-secondary-green hover:bg-green-700 text-white px-8 py-6 rounded-full font-normal font-funnel-sans"
                                            >
                                                Save Changes
                                            </Button>
                                            <Button
                                                type="button"
                                                onClick={handleCancel}
                                                variant="outline"
                                                className="px-8 py-6 rounded-full border border-black/40 text-black/40"
                                            >
                                                Cancel
                                            </Button>
                                        </div>
                                    </form>

                                    {/* Agent Management Section */}
                                    <div className="mt-24 rounded-[20px] p-6 bg-white "
                                        style={{
                                            background: "linear-gradient(0deg, rgba(255, 59, 48, 0.05), rgba(255, 59, 48, 0.05)), linear-gradient(0deg, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.95))"
                                        }}
                                    >
                                        {/* Pause Agent Section */}
                                        <div className="flex items-start justify-between my-12 mx-4">
                                            <div className="flex-1">
                                                <h3 className="font-semibold text-secondary-red font-funnel-sans text-lg mb-2">Pause Agent</h3>
                                                <p className="text-black/40 text-sm font-funnel-sans">
                                                    Temporarily disable your agent from accepting new prompts. Users won&apos;t be charged and existing sessions will complete. You can reactivate anytime.
                                                </p>
                                            </div>
                                            <div className="flex items-center ml-4">
                                                <button
                                                    type="button"
                                                    onClick={handlePauseAgent}
                                                    disabled={loading}
                                                    className={`relative inline-block w-12 h-6 transition-colors duration-200 ease-in-out rounded-full cursor-pointer ${agent.status === "PAUSED"
                                                        ? 'bg-secondary-green'
                                                        : 'bg-gray-300'
                                                        }`}
                                                >
                                                    <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform duration-200 ease-in-out ${agent.status === "PAUSED" ? 'translate-x-6 bg-secondary-green' : 'translate-x-0'
                                                        }`}></div>
                                                </button>
                                            </div>
                                        </div>

                                        {/* Delete Agent Section */}
                                        <div className="flex items-start justify-between my-12 mx-4">
                                            <div className="flex-1">
                                                <h3 className="font-semibold text-secondary-red font-funnel-sans text-lg mb-2">Delete Agent</h3>
                                                <p className="text-black/40 text-sm font-funnel-sans">
                                                    Permanently remove this agent and all its data. This action cannot be undone. Withdraw any remaining earnings first.
                                                </p>
                                            </div>
                                            <Button
                                                type="button"
                                                onClick={() => setShowDeleteDialog(true)}
                                                variant="outline"
                                                className="px-4 py-2 border border-black/40 text-black/40 bg-transparent rounded-full font-normal font-funnel-sans ml-4 hover:bg-secondary-red hover:text-white hover:border-secondary-red h-9"
                                            >
                                                Delete
                                                <Trash2 className="w-4 h-4 ml-2" />
                                            </Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Token Configuration Panel */}
                            <div className="mt-6">
                                <TokenConfigPanel
                                    agentId={agent.agentId}
                                />
                            </div>
                            </>
                        ) : (
                            <Logs agentId={resolvedParams.id} />
                        )}
                    </div>

                    {/* Right Section - Sidebar */}
                    <div className="w-[30%] space-y-6">
                        {/* Area Chart Card */}
                        <Card className="rounded-[20px] shadow-none border border-black/10">
                            <CardContent className="p-6">
                                <h3 className="font-semibold text-black font-funnel-sans text-lg mb-4">Earnings Overview</h3>

                                {/* Chart Container */}
                                <div className="relative h-48 mb-4">
                                    {/* Y-axis labels */}
                                    <div className="absolute left-0 top-0 h-full flex flex-col justify-between text-xs text-black/40 font-funnel-sans">
                                        <span>${maxValue.toFixed(0)}</span>
                                        <span>${(maxValue * 0.75).toFixed(0)}</span>
                                        <span>${(maxValue * 0.5).toFixed(0)}</span>
                                        <span>${(maxValue * 0.25).toFixed(0)}</span>
                                        <span>$0</span>
                                    </div>

                                    {/* Chart Area */}
                                    <div className="ml-8 h-full relative">
                                        {/* SVG Chart */}
                                        <svg width="100%" height="100%" viewBox="0 0 400 192" className="absolute inset-0">
                                            {/* Area fill */}
                                            <defs>
                                                <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                                                    <stop offset="0%" stopColor="rgba(52, 199, 89, 0.2)" />
                                                    <stop offset="100%" stopColor="rgba(52, 199, 89, 0.1)" />
                                                </linearGradient>
                                            </defs>

                                            {/* Area path */}
                                            <path
                                                d={`M 0 ${chartHeight - (chartData[0].value / maxValue) * chartHeight} ${chartData.map((point, index) => {
                                                    const x = (index / (chartData.length - 1)) * chartWidth;
                                                    const y = chartHeight - (point.value / maxValue) * chartHeight;
                                                    return `L ${x} ${y}`;
                                                }).join(' ')} L ${chartWidth} ${chartHeight} L 0 ${chartHeight} Z`}
                                                fill="url(#areaGradient)"
                                            />

                                            {/* Line path */}
                                            <path
                                                d={`M 0 ${chartHeight - (chartData[0].value / maxValue) * chartHeight} ${chartData.map((point, index) => {
                                                    const x = (index / (chartData.length - 1)) * chartWidth;
                                                    const y = chartHeight - (point.value / maxValue) * chartHeight;
                                                    return `L ${x} ${y}`;
                                                }).join(' ')}`}
                                                stroke="#34C759"
                                                strokeWidth="2"
                                                fill="none"
                                            />

                                            {/* Data points */}
                                            {chartData.map((point, index) => {
                                                const x = (index / (chartData.length - 1)) * chartWidth;
                                                const y = chartHeight - (point.value / maxValue) * chartHeight;
                                                return (
                                                    <circle
                                                        key={index}
                                                        cx={x}
                                                        cy={y}
                                                        r={index === chartData.length - 1 ? "4" : "0"}
                                                        fill="#34C759"
                                                    />
                                                );
                                            })}
                                        </svg>

                                        {/* X-axis labels */}
                                        <div className="absolute bottom-0 left-0 right-0 flex justify-between text-xs text-black/40 font-funnel-sans">
                                            {chartData.map((point, index) => (
                                                <span key={index} className="text-center">
                                                    {point.month}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Financial Metrics Cards */}
                        <div className="space-y-6">
                            {/* Total Earnings */}
                            <Card className="rounded-[20px] shadow-none border border-black/10">
                                <CardContent className="p-4">
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <p className="text-sm text-black/40 font-funnel-sans mb-1">Total Earnings</p>
                                            <p className="text-lg font-semibold text-secondary-green font-funnel-sans">
                                                ${earningsData?.totalEarnings.toFixed(2) || '0.00'}
                                            </p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Total Withdraws */}
                            <Card className="rounded-[20px] shadow-none border border-black/10">
                                <CardContent className="p-4">
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <p className="text-sm text-black/40 font-funnel-sans mb-1">Total Withdraws</p>
                                            <p className="text-lg font-semibold text-black/60 font-funnel-sans">
                                                ${earningsData?.totalWithdrawals.toFixed(2) || '0.00'}
                                            </p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Available Balance */}
                            <Card className="rounded-[20px] shadow-none border border-black/10">
                                <CardContent className="p-4">
                                    <div className="flex justify-between items-center">
                                        <div className="flex-1">
                                            <p className="text-sm text-black/40 font-funnel-sans mb-1">Available Balance</p>
                                            <p className="text-lg font-semibold text-black/60 font-funnel-sans">
                                                ${freshBalanceData?.usdBalance.toFixed(2) || earningsData?.availableBalance.toFixed(2) || '0.00'}
                                            </p>
                                            {/* Show ETH balance */}
                                            <p className="text-xs text-black/40 font-funnel-sans mt-1">
                                                {(freshBalanceData?.ethBalance || earningsData?.availableBalanceEth || 0).toFixed(6)} ETH
                                            </p>
                                            {/* Show token balances */}
                                            {earningsData?.tokenBalances && earningsData.tokenBalances.length > 0 && (
                                                <div className="mt-2 pt-2 border-t border-black/5">
                                                    {earningsData.tokenBalances.map((token) => (
                                                        <p key={token.address} className="text-xs text-black/40 font-funnel-sans">
                                                            {parseFloat(token.balance).toFixed(2)} {token.symbol}
                                                            {token.balanceUsd > 0 && (
                                                                <span className="ml-1">(≈ ${token.balanceUsd.toFixed(2)})</span>
                                                            )}
                                                        </p>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <Button
                                            onClick={() => setShowWithdrawModal(true)}
                                            className="bg-secondary-green hover:bg-green-700 text-white px-4 py-2 rounded-full font-normal font-funnel-sans"
                                        >
                                            Withdraw
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </div>
            </div>

            {/* Delete Confirmation Dialog */}
            <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <DialogContent className="sm:max-w-md p-8 font-funnel-sans">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-semibold text-black">
                            Delete Agent
                        </DialogTitle>
                        <DialogDescription className="text-black/60">
                            Are you sure you want to delete this agent? This action cannot be undone.
                            Please withdraw any remaining earnings first.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="flex gap-3">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setShowDeleteDialog(false)}
                            className="flex-1 border border-black/20 text-black/60 hover:bg-gray-50 rounded-full"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            onClick={handleDeleteAgent}
                            className="flex-1 bg-secondary-red hover:bg-red-700 text-white rounded-full"
                        >
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Withdraw Modal */}
            <WithdrawModal
                isOpen={showWithdrawModal}
                onClose={() => setShowWithdrawModal(false)}
                agentDbId={resolvedParams.id}
                agentId={agent?.agentId || ''}
                availableBalance={freshBalanceData?.usdBalance || earningsData?.availableBalance || 0}
                availableBalanceEth={freshBalanceData?.ethBalance || earningsData?.availableBalanceEth || 0}
                tokenBalances={earningsData?.tokenBalances || []}
                onWithdrawSuccess={() => {
                    // Refresh both earnings data and fresh balance after successful withdrawal
                    const refreshData = async () => {
                        try {
                            // Refresh earnings data
                            const earningsResponse = await fetch(`/api/agents/${resolvedParams.id}/earnings`);
                            if (earningsResponse.ok) {
                                const data = await earningsResponse.json();
                                setEarningsData(data);
                            }

                            // Refresh fresh balance data
                            if (agent?.agentId) {
                                const publicClient = createPublicClient({
                                    chain: base,
                                    transport: http(),
                                });

                                const agentIdBytes32 = keccak256(encodePacked(['string'], [agent.agentId]));
                                const balance = await publicClient.readContract({
                                    address: CONTRACT_ADDRESS as `0x${string}`,
                                    abi: CONTRACT_ABI,
                                    functionName: 'agentBalance',
                                    args: [agentIdBytes32],
                                });

                                const ethBalance = Number(balance) / 1e18;
                                const { priceService } = await import('@/lib/priceService');
                                const ethPrice = await priceService.getEthPrice();
                                const usdBalance = ethBalance * ethPrice;

                                setFreshBalanceData({
                                    ethBalance,
                                    usdBalance,
                                    ethPrice,
                                });
                            }
                        } catch (error) {
                            console.error('Error refreshing data after withdrawal:', error);
                        }
                    };
                    refreshData();
                }}
            />
        </div>
    );
}
