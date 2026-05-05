"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { ToggleSlider } from "@/app/components/ui/toggle-slider";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Icons } from "@/app/components/sections/icons";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { hasApiKey } from "@/actions/user";
import { v4 as uuidv4 } from 'uuid';

interface AgentFormData {
    agentName: string;
    feeModel: "free-tier" | "credit-based";
    freePromptThreshold: string;
    ratePerPrompt: string;
    creditsPerPrompt: string;
    topUpPackages: Array<{
        id: string;
        credits: string;
        price: string;
    }>;
    buybackAddress: string;
    buybackPercent: string;
}

export default function NewAgentPage() {
    const { ready, authenticated, user: privyUser } = usePrivy();
    const router = useRouter();
    const [userId, setUserId] = useState<string | null>(null);
    const { wallets } = useWallets();

    const [formData, setFormData] = useState<AgentFormData>({
        agentName: "",
        feeModel: "free-tier",
        freePromptThreshold: "",
        ratePerPrompt: "",
        creditsPerPrompt: "",
        topUpPackages: [
            { id: "1", credits: "100", price: "25" },
            { id: "2", credits: "200", price: "50" },
        ],
        buybackAddress: "",
        buybackPercent: "",
    });

    // Get the authenticated user ID
    useEffect(() => {
        if (ready && authenticated && privyUser) {
            const userId = privyUser?.id.split(':').pop() || privyUser?.id;
            setUserId(userId);
        } else if (ready && !authenticated) {
            // Redirect to login if not authenticated
            router.push("/welcome-back");
        }
    }, [ready, authenticated, privyUser, router]);

    const handleInputChange = (field: keyof AgentFormData, value: string) => {
        setFormData(prev => ({
            ...prev,
            [field]: value
        }));
    };

    const handleFeeModelChange = (model: string) => {
        setFormData(prev => ({
            ...prev,
            feeModel: model as "free-tier" | "credit-based"
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!userId) {
            toast.error("Please log in to create an agent.");
            return;
        }

        // Check prerequisites before submission
        try {
            const [apiKeyExists] = await Promise.all([
                hasApiKey(userId),

            ]);

            const walletExists = wallets.find((wallet) => wallet.connectorType === "injected");
            console.log(walletExists, 'walletExists')


            if (!apiKeyExists || !walletExists) {
                toast.error("Prerequisites Required", {
                    description: "You must complete the required setup before creating an agent. Connect your wallet to continue.",
                    action: {
                        label: "Go to Settings",
                        onClick: () => router.push("/settings")
                    }
                });
                return;
            }
        } catch (error) {
            console.error("Error checking prerequisites:", error);
            toast.error("Error checking prerequisites. Please try again.");
            return;
        }

        // Validate required fields
        if (!formData.agentName.trim()) {
            toast.error("Please enter an agent name.");
            return;
        }

        // Validate fee model specific fields
        if (formData.feeModel === "free-tier") {
            if (!formData.freePromptThreshold || parseInt(formData.freePromptThreshold) < 0) {
                toast.error("Please enter a valid free prompt threshold (must be 0 or greater).");
                return;
            }
            if (!formData.ratePerPrompt || parseFloat(formData.ratePerPrompt) <= 0) {
                toast.error("Please enter a valid rate per prompt (must be greater than 0).");
                return;
            }
        }

        if (formData.feeModel === "credit-based") {
            if (!formData.creditsPerPrompt || parseInt(formData.creditsPerPrompt) <= 0) {
                toast.error("Please enter a valid number of credits per prompt (must be greater than 0).");
                return;
            }

            // Validate top-up packages
            const validPackages = formData.topUpPackages.filter(pkg =>
                pkg.credits && pkg.price &&
                parseInt(pkg.credits) > 0 &&
                parseFloat(pkg.price) > 0
            );

            if (validPackages.length === 0) {
                toast.error("Please add at least one valid top-up package with credits and price greater than 0.");
                return;
            }
        }

        const agentId = uuidv4();
        const injectedWallet = wallets.find(w => w.connectorType === "injected");
        const developerWalletAddress = injectedWallet?.address;

        const loadingToast = toast.loading("Deploying payment split and creating agent...");

        try {
            const response = await fetch('/api/agents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...formData,
                    userId,
                    agentId,
                    developerWalletAddress,
                    buybackAddress: formData.buybackAddress || undefined,
                    buybackPercent: formData.buybackPercent ? Number(formData.buybackPercent) : undefined,
                }),
            });

            toast.dismiss(loadingToast);

            if (response.ok) {
                toast.success("Agent created successfully!");
                router.push('/home');
            } else {
                const error = await response.json();
                toast.error(`Failed to create agent: ${error.error || 'Unknown error'}`);
            }
        } catch (error) {
            toast.dismiss(loadingToast);
            console.error("Error creating agent:", error);
            toast.error("An error occurred while creating the agent. Please try again.");
        }
    };

    const handleCancel = () => {
        // Navigate back to home page
        router.push('/home');
    };


    // Show loading state while checking authentication
    if (!ready || !authenticated) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-black/40 mx-auto"></div>
                    <p className="mt-4 text-black/40">Loading...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen">
            <div className="max-w-7xl">
                {/* Breadcrumb Navigation */}
                <div className="mb-[60px]">
                    <div className="flex items-center gap-2 text-sm">
                        <Link href="/home" className="text-black/40 font-funnel-display font-semibold text-xl hover:text-black/60 transition-colors cursor-pointer">
                            My Agents
                        </Link>
                        <ChevronRight className="w-6 h-6 text-black/20 font-semibold " />
                        <div className="flex items-center gap-2">
                            <span className="text-color1 font-funnel-display font-semibold text-xl hover:text-black/60 transition-colors cursor-pointer" >Add Agent</span>
                            <Icons.breadcrumbAddAgentIcon className="w-5 h-5" />
                        </div>
                    </div>
                </div>

                <div className="flex items-start justify-between gap-0">
                    {/* Left Section - Main Content */}
                    <div className="flex-1">
                        {/* Main Form Card */}
                        <Card className="bg-white shadow-sm rounded-[20px]">
                            <CardContent className="p-8">
                                <form onSubmit={handleSubmit} className="space-y-12">
                                    {/* Agent Name Section */}
                                    <div className="space-y-3">
                                        <label className="block text-sm font-semibold text-black font-funnel-sans px-4">
                                            Agent Name
                                        </label>
                                        <Input
                                            type="text"
                                            placeholder="E.g. Whale Watcher, Trading Signal Bot"
                                            value={formData.agentName}
                                            onChange={(e) => handleInputChange("agentName", e.target.value)}
                                            className="w-full p-4 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        />
                                        <p className="text-xs text-black/40 font-funnel-sans px-4">
                                            Choose a descriptive name that clearly identifies your agent&apos;s purpose and functionality.
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
                                            onChange={handleFeeModelChange}
                                            selectedBgColor="bg-white"
                                            unselectedBgColor="bg-transparent"
                                            padding="p-2.5"
                                            height="h-10"
                                            containerClassName="p-2.5"
                                        />
                                        <p className="text-xs text-black/40 font-funnel-sans px-4">
                                            Free Tier: Offer free prompts before charging. Credit Based: Charge immediately per prompt.
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
                                                                    className="w-full p-3 border border-black/10 rounded-lg  bg-black/4"
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
                                                                        className="flex-1 p-3 border border-black/10 rounded-lg  bg-black/4"
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

                                    {/* Revenue Split Section */}
                                    <div className="space-y-3">
                                        <label className="block text-sm font-semibold text-black font-funnel-sans px-4">
                                            Buyback Address <span className="text-black/40 font-normal">(optional)</span>
                                        </label>
                                        <Input
                                            type="text"
                                            placeholder="0x... — receives your buyback percentage"
                                            value={formData.buybackAddress}
                                            onChange={(e) => handleInputChange("buybackAddress", e.target.value)}
                                            className="w-full p-4 border border-gray-200 rounded-lg"
                                        />
                                        <p className="text-xs text-black/40 font-funnel-sans px-4">
                                            Platform fee: 5%. If you set a buyback address, specify what % of payments it receives (max 95%).
                                        </p>
                                        <p className="text-xs text-secondary-purple font-funnel-sans px-4">
                                            Want auto-swap into your token + burn? Enable Auto Buyback on the agent page after creation — set a token address, threshold (min $5, recommended $10+), and slippage. Funds accumulate in a Turnkey-managed wallet until the threshold is crossed.
                                        </p>
                                        {formData.buybackAddress && (
                                            <div className="space-y-2 mt-2">
                                                <label className="block text-sm font-semibold text-black font-funnel-sans px-4">
                                                    Buyback Percent
                                                </label>
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    max="95"
                                                    placeholder="e.g. 10"
                                                    value={formData.buybackPercent}
                                                    onChange={(e) => handleInputChange("buybackPercent", e.target.value)}
                                                    className="w-full p-4 border border-gray-200 rounded-lg"
                                                />
                                                {formData.buybackPercent && (
                                                    <p className="text-xs text-black/40 px-4">
                                                        Split: {95 - Number(formData.buybackPercent)}% to your wallet · {formData.buybackPercent}% to buyback · 5% platform fee
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex gap-4 pt-6">
                                        <Button
                                            type="submit"
                                            className="bg-secondary-green hover:bg-green-700 text-white px-8 py-6 rounded-full font-normal font-funnel-sans"
                                        >
                                            Add Agent
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
                            </CardContent>
                        </Card>
                    </div>

                    {/* Right Section - Sidebar */}
                    <div className="w-[30%]"></div>
                </div>
            </div>

        </div>
    );
}
