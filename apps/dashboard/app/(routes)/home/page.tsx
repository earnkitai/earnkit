"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
// import { Icons } from "@/app/components/sections/icons";
import { usePrivy, useConnectWallet, useWallets } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { hasApiKey, createApiKey, getApiKey } from "@/actions/user";
import { PrerequisiteModal } from "@/app/components/PrerequisiteModal";
import { toast } from "sonner";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Eye, EyeOff, Copy, Key, Wallet } from "lucide-react";

// Agent type definition matching the comprehensive earnings API
interface Agent {
    id: string;
    name: string;
    agentId: string;
    status: "ACTIVE" | "PAUSED" | "DELETED";
    feeModel: "FREE_TIER" | "CREDIT_BASED";
    totalEarnings: number;
    transactionLogEarnings: number;
    topUpEarnings: number;
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

// Update type definition
// interface Update {
//     id: string;
//     title: string;
//     description: string;
// }

export default function HomePage() {
    const { ready, authenticated, user: privyUser } = usePrivy();
    const router = useRouter();
    const [agents, setAgents] = useState<Agent[]>([]);
    const [loading, setLoading] = useState(true);
    const [userId, setUserId] = useState<string | null>(null);
    const [showPrerequisiteModal, setShowPrerequisiteModal] = useState(false);
    const [missingPrerequisites, setMissingPrerequisites] = useState({
        apiKey: false,
        wallet: false
    });
    const { wallets } = useWallets();
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

    // Function to handle Add Agent click and check prerequisites
    const handleAddAgentClick = async (e: React.MouseEvent) => {
        e.preventDefault();

        if (!userId) {
            router.push("/welcome-back");
            return;
        }

        try {
            const [apiKeyExists] = await Promise.all([
                hasApiKey(userId)
            ]);

            const walletExists = wallets.find((wallet) => wallet.connectorType === "injected");
            console.log(walletExists, 'walletExists')
            if (!apiKeyExists || !walletExists) {
                setMissingPrerequisites({
                    apiKey: !apiKeyExists,
                    wallet: !walletExists
                });
                setShowPrerequisiteModal(true);
            } else {
                // All prerequisites met, navigate to new-agent page
                router.push("/new-agent");
            }
        } catch (error) {
            console.error("Error checking prerequisites:", error);
            // On error, still allow navigation to new-agent page
            router.push("/new-agent");
        }
    };

    // Fetch agents when userId is available
    useEffect(() => {
        const fetchAgents = async () => {
            if (!userId) return;

            try {
                const response = await fetch(`/api/agents/earnings?userId=${userId}`);
                if (response.ok) {
                    const data = await response.json();
                    setAgents(data.agents || []);
                } else {
                    console.error('Failed to fetch agents');
                }
            } catch (error) {
                console.error('Error fetching agents:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchAgents();
    }, [userId]);

    // Mock data for updates
    // const [updates] = useState<Update[]>([
    //     {
    //         id: "1",
    //         title: "Lorem ipsum dolor sit amet",
    //         description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua."
    //     },
    //     {
    //         id: "2",
    //         title: "Lorem ipsum dolor sit amet",
    //         description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua."
    //     },
    //     {
    //         id: "3",
    //         title: "Lorem ipsum dolor sit amet",
    //         description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua."
    //     }
    // ]);


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

    return (
        <div className="min-h-screen">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-6 flex justify-between items-start">
                    <div>
                        <h1 className="text-3xl font-semibold font-funnel-display text-color2 mb-2">My Agents</h1>
                        <p className="text-black/40 text-sm font-funnel-sans">Track & Manage your agent monetizations</p>
                    </div>
                    {/* API Key Section */}
                    <div className="space-y-6 w-[30%]">
                        <Card className="border border-black/10 rounded-[20px] shadow-none">
                            <CardContent className="p-6">
                                <div className="mb-4">
                                    <h2 className="text-lg font-bold font-funnel-display text-color2 mb-2">API Key</h2>
                                </div>
                                <SimplifiedApiKeySection />
                            </CardContent>
                        </Card>
                    </div>
                </div>
                <div className="flex items-start justify-between gap-8">
                    {/* Left Section - Main Content */}
                    <div className="flex-1 mr-24">


                        {/* Agent Cards Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-32">
                            {/* Agent Cards */}
                            {agents.map((agent) => (
                                <AgentCard key={agent.id} agent={agent} />
                            ))}

                            {/* Add Agent Card */}
                            <AddAgentCard onClick={handleAddAgentClick} />
                        </div>

                        {/* Get Started Faster Section */}
                        <div className="mb-32">
                            <div className="mb-[60px]">
                                <h2 className="text-3xl font-semibold font-funnel-display text-color2 mb-2">Get Started Faster</h2>
                                <p className="text-black/40 text-sm font-funnel-sans">Quick actions and resources to help you maximize your agents</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Quickstart Guide Card */}
                                <Link href="#">
                                    <Card className="border-2 border-black/10 rounded-[28px] hover:border-black/20 transition-colors cursor-pointer">
                                        <CardContent className="p-6 text-center">
                                            <div className="w-16 h-16 bg-color1 rounded-xl flex items-center justify-center mb-8 mx-auto">
                                                <svg width="45" height="45" viewBox="0 0 45 45" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                    <path d="M22.5 32.6709C20.5408 31.5398 18.3185 30.9443 16.0563 30.9443C13.794 30.9443 11.5717 31.5398 9.61255 32.6709V14.0557C11.5717 12.9246 13.794 12.3291 16.0563 12.3291C18.3185 12.3291 20.5408 12.9246 22.5 14.0557M22.5 32.6709C24.4591 31.5398 26.6815 30.9443 28.9437 30.9443C31.2059 30.9443 33.4283 31.5398 35.3874 32.6709V14.0557C33.4283 12.9246 31.2059 12.3291 28.9437 12.3291C26.6815 12.3291 24.4591 12.9246 22.5 14.0557M22.5 32.6709V14.0557" stroke="white" strokeWidth="2.0625" strokeLinecap="round" strokeLinejoin="round" />
                                                </svg>
                                            </div>
                                            <h3 className="font-semibold text-black font-funnel-sans text-lg mb-2">Quickstart Guide</h3>
                                            <p className="text-black/40 text-sm font-funnel-sans">Get up and running with EarnKit&apos;s core documentation and tutorials</p>
                                        </CardContent>
                                    </Card>
                                </Link>

                                {/* EarnKit Templates Card */}
                                <Link href="#">
                                    <Card className="border-2 border-black/10 rounded-[28px] hover:border-black/20 transition-colors cursor-pointer">
                                        <CardContent className="p-6 text-center">
                                            <div className="w-16 h-16 bg-color1 rounded-xl flex items-center justify-center mx-auto mb-8">
                                                <svg width="45" height="45" viewBox="0 0 45 45" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                    <path d="M35.481 28.272C35.5836 28.4483 35.6121 28.6581 35.5601 28.8554C35.5082 29.0526 35.38 29.2212 35.2039 29.324L22.8878 36.5084C22.7707 36.576 22.638 36.6116 22.5029 36.6116C22.3678 36.6116 22.235 36.576 22.118 36.5084L9.80187 29.324C9.64014 29.215 9.52584 29.0486 9.48207 28.8585C9.4383 28.6684 9.46833 28.4688 9.56609 28.3C9.66385 28.1312 9.82205 28.0058 10.0087 27.9492C10.1954 27.8925 10.3966 27.9089 10.5716 27.9949L22.5029 34.9522L34.4341 27.9949C34.6099 27.8939 34.8185 27.8663 35.0145 27.9182C35.2105 27.9701 35.3782 28.0973 35.481 28.272ZM34.4316 21.8343L22.5003 28.7916L10.5691 21.8343C10.394 21.7483 10.1928 21.7319 10.0061 21.7886C9.81948 21.8452 9.66128 21.9706 9.56353 22.1394C9.46577 22.3082 9.43574 22.5078 9.47951 22.6979C9.52327 22.888 9.63758 23.0543 9.79931 23.1634L22.1154 30.3478C22.2325 30.4154 22.3652 30.4509 22.5003 30.4509C22.6354 30.4509 22.7682 30.4154 22.8852 30.3478L35.2013 23.1634C35.363 23.0543 35.4774 22.888 35.5211 22.6979C35.5649 22.5078 35.5349 22.3082 35.4371 22.1394C35.3393 21.9706 35.1811 21.8452 34.9945 21.7886C34.8078 21.7319 34.6066 21.7483 34.4316 21.8343ZM9.41443 16.3408C9.41479 16.206 9.45053 16.0737 9.51807 15.9571C9.58562 15.8404 9.68259 15.7436 9.79931 15.6762L22.1154 8.4918C22.2325 8.42424 22.3652 8.38867 22.5003 8.38867C22.6354 8.38867 22.7682 8.42424 22.8852 8.4918L35.2013 15.6762C35.3174 15.744 35.4136 15.8411 35.4805 15.9577C35.5474 16.0743 35.5826 16.2063 35.5826 16.3408C35.5826 16.4752 35.5474 16.6073 35.4805 16.7239C35.4136 16.8404 35.3174 16.9375 35.2013 17.0053L22.8852 24.1897C22.7682 24.2573 22.6354 24.2929 22.5003 24.2929C22.3652 24.2929 22.2325 24.2573 22.1154 24.1897L9.79931 17.0053C9.68259 16.9379 9.58562 16.8411 9.51807 16.7245C9.45053 16.6078 9.41479 16.4755 9.41443 16.3408ZM11.7122 16.3408L22.5003 22.6335L33.2885 16.3408L22.5003 10.0544L11.7122 16.3408Z" fill="white" stroke="white" strokeWidth="0.5" />
                                                </svg>
                                            </div>
                                            <h3 className="font-semibold text-black font-funnel-sans text-lg mb-2">EarnKit Templates</h3>
                                            <p className="text-black/40 text-sm font-funnel-sans">Explore trading bots, LLM agents, and other common use cases</p>
                                        </CardContent>
                                    </Card>
                                </Link>
                            </div>
                        </div>

                        {/* FAQs Section */}
                        <div className="mb-8 mt-[60px]">
                            <div className="mb-[60px]">
                                <h2 className="text-3xl font-semibold font-funnel-display text-color2 mb-2">FAQs</h2>
                                <p className="text-black/40 text-sm font-funnel-sans">Quick actions and resources to help you maximize your agents</p>
                            </div>

                            <div className="space-y-8">
                                {/* FAQ 1 */}
                                <div>
                                    <h3 className="font-semibold text-black font-funnel-sans text-lg mb-3">How do I set up monetization for my crypto trading agent?</h3>
                                    <p className="text-black/40 text-sm font-funnel-sans leading-relaxed">
                                        Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.
                                    </p>
                                </div>

                                {/* FAQ 2 */}
                                <div>
                                    <h3 className="font-semibold text-black font-funnel-sans text-lg mb-3">What fees model does EarnKit support for agent monetization?</h3>
                                    <p className="text-black/40 text-sm font-funnel-sans leading-relaxed">
                                        Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit.
                                    </p>
                                </div>

                                {/* FAQ 3 */}
                                <div>
                                    <h3 className="font-semibold text-black font-funnel-sans text-lg mb-3">How do I receive payments from my monetized crypto agents?</h3>
                                    <p className="text-black/40 text-sm font-funnel-sans leading-relaxed">
                                        Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt. Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit.
                                    </p>
                                </div>

                                {/* FAQ 4 */}
                                <div>
                                    <h3 className="font-semibold text-black font-funnel-sans text-lg mb-3">Can I customize the pricing and limits for different types of users?</h3>
                                    <p className="text-black/40 text-sm font-funnel-sans leading-relaxed">
                                        At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident, similique sunt in culpa qui officia deserunt mollitia animi.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Right Section - Sidebar */}
                    <div className="w-[30%] space-y-6">
                        {/* Wallet Connection Section */}
                        <Card className="border border-black/10 rounded-[20px] shadow-none">
                            <CardContent className="p-6">
                                <div className="mb-4">
                                    <h2 className="text-lg font-bold font-funnel-display text-color2 mb-2">Wallet Connection</h2>
                                </div>
                                <SimplifiedWalletSection />
                            </CardContent>
                        </Card>

                        {/* Earnkit Updates */}
                        {/* <Card className="rounded-[28px]">
                            <CardContent className="p-6">
                                <div className="flex items-center gap-2 mb-6">

                                    <Icons.newEarnkitSmallIcon />

                                    <h3 className="font-semibold text-black/80 font-funnel-sans">Earnkit Updates</h3>
                                </div>

                                <div className="space-y-8">
                                    {updates.map((update) => (
                                        <UpdateItem key={update.id} update={update} />
                                    ))}
                                </div>
                            </CardContent>
                        </Card> */}
                    </div>
                </div>
            </div>

            {/* Prerequisite Modal */}
            <PrerequisiteModal
                isOpen={showPrerequisiteModal}
                onClose={() => setShowPrerequisiteModal(false)}
                missingPrerequisites={missingPrerequisites}
            />
        </div >
    );
}

// Agent Card Component
function AgentCard({ agent }: { agent: Agent }) {
    const isActive = agent.status === "ACTIVE";

    // Generate real graph data from transaction logs
    const generateRealGraphData = () => {
        const data = [];
        const now = new Date();

        // Get last 8 days of data
        for (let i = 7; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
            const endOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);

            // Filter transactions for this day
            const dayTransactions = agent.transactionLogs?.filter(log => {
                const logDate = new Date(log.createdAt);
                return logDate >= startOfDay && logDate < endOfDay;
            }) || [];

            // Sum up earnings for this day
            const dayEarnings = dayTransactions.reduce((sum, log) => sum + log.amount, 0);

            // Convert to a percentage of the max daily earnings (for visualization)
            // If no transactions, use 0, otherwise scale relative to max earnings
            const transactionAmounts = agent.transactionLogs?.map(log => log.amount) || [];
            const maxEarnings = transactionAmounts.length > 0 ? Math.max(...transactionAmounts) : 1;
            const percentage = dayEarnings > 0 ? (dayEarnings / maxEarnings) * 100 : 0;

            data.push(Math.max(percentage, 5)); // Minimum 5% height for visibility
        }

        return data;
    };

    const graphData = generateRealGraphData();

    return (
        <Link href={`/agent/${agent.id}`}>
            <Card className="bg-white outline-2 outline-black/10 rounded-[28px] shadow-[inset_0_0_0_0px_#00000033] hover:shadow-[inset_0_0_0_4px_#00000033] focus:outline-color1 focus:shadow-[inset_0_0_0_4px_#2E70EA] active:outline-color1 active:shadow-[inset_0_0_0_4px_#2E70EA] transition-shadow duration-300 cursor-pointer">
                <CardContent className="p-6">
                    <div className="mb-4">
                        <h3 className="font-semibold text-black/80 font-funnel-sans text-lg mb-2">{agent.name}</h3>
                        <Badge
                            variant={isActive ? "default" : "secondary"}
                            className={`${isActive ? 'bg-white/80 text-secondary-green border-secondary-green' : 'bg-white/80 text-black/30 border-black/30'} font-funnel-sans text-[12px] font-medium py-0.5 px-4`}
                            style={{
                                background: isActive ? 'linear-gradient(0deg, rgba(52, 199, 89, 0.2), rgba(52, 199, 89, 0.2))' : 'linear-gradient(0deg, rgba(0, 0, 0, 0.04), rgba(0, 0, 0, 0.04))',
                            }}
                        >
                            <div className={`w-1.5 h-1.5 rounded-full mr-1 ${isActive ? 'bg-secondary-green' : 'bg-black/30'}`}></div>
                            {agent.status === "ACTIVE" ? "Active" : "Paused"}
                        </Badge>
                    </div>

                    <div className="flex justify-between items-end">
                        <div>
                            <p className={`text-[18px] font-semibold font-funnel-sans ${isActive ? 'text-secondary-green' : 'text-black/40'}`}>
                                ${agent.totalEarnings.toFixed(2)}
                            </p>
                            <p className="text-black/40 text-[12px] font-funnel-sans">Total Earnings</p>
                        </div>

                        {/* Mini Graph */}
                        <div className="w-16 h-12 flex items-end gap-0.5">
                            {graphData.map((value, index) => (
                                <div
                                    key={index}
                                    className={`flex-1 rounded-sm ${isActive
                                        ? 'bg-green-200'
                                        : 'bg-gray-200'
                                        }`}
                                    style={{ height: `${(value / 40) * 100}%` }}
                                />
                            ))}
                        </div>
                    </div>
                </CardContent>
            </Card>
        </Link>
    );
}

// Add Agent Card Component
function AddAgentCard({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
    return (
        <Card
            onClick={onClick}
            className="bg-white outline-2 outline-black/10 rounded-[28px] shadow-[inset_0_0_0_0px_#00000033] hover:shadow-[inset_0_0_0_4px_#00000033] focus:outline-color1 focus:shadow-[inset_0_0_0_4px_#2E70EA] active:outline-color1 active:shadow-[inset_0_0_0_4px_#2E70EA] transition-shadow duration-300 cursor-pointer"
        >
            <CardContent className="p-8">
                <div className="flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 bg-color1 rounded-xl flex items-center justify-center mb-6">
                        <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                    </div>
                    <h3 className="font-semibold text-black/80 font-funnel-sans text-[16px]">Add Agent</h3>
                </div>
            </CardContent>
        </Card>
    );
}

// Update Item Component
// function UpdateItem({ update }: { update: Update }) {
//     return (
//         <div className="relative">
//             <div className="flex gap-4 ">
//                 {/* Blue line */}
//                 <div className="flex-shrink-0">
//                     <div className="w-1 h-full bg-blue-500"></div>
//                 </div>

//                 {/* Content */}
//                 <div className="flex-1">
//                     <h4 className="font-medium text-gray-800 text-sm mb-1">{update.title}</h4>
//                     <p className="text-gray-500 text-xs leading-relaxed">{update.description}</p>
//                 </div>
//             </div>

//         </div>
//     );
// }

// Simplified API Key Section Component (without delete/regenerate)
function SimplifiedApiKeySection() {
    const { ready, authenticated, user } = usePrivy();
    const [apiKey, setApiKey] = useState<string | null>(null);
    const [showApiKey, setShowApiKey] = useState(false);
    const [isCreating, setIsCreating] = useState(false);

    const fetchApiKey = useCallback(async () => {
        if (!user?.id) return;

        try {
            const userId = user.id.split(':').pop() || user.id;
            const key = await getApiKey(userId);
            setApiKey(key);
        } catch (error) {
            console.error("Error fetching API key:", error);
        }
    }, [user?.id]);

    useEffect(() => {
        if (ready && authenticated && user?.id) {
            fetchApiKey();
        }
    }, [ready, authenticated, user, fetchApiKey]);

    const handleCreateApiKey = async () => {
        if (!user?.id) return;

        setIsCreating(true);
        try {
            const userId = user.id.split(':').pop() || user.id;
            const newApiKey = await createApiKey(userId);
            setApiKey(newApiKey);
            setShowApiKey(true);
            toast.success("API key created successfully");
        } catch (error) {
            console.error("Error creating API key:", error);
            toast.error("Failed to create API key");
        } finally {
            setIsCreating(false);
        }
    };

    const handleCopyApiKey = async () => {
        if (!apiKey) return;

        try {
            await navigator.clipboard.writeText(apiKey);
            toast.success("API key copied to clipboard");
        } catch (error) {
            console.error("Error copying API key:", error);
            toast.error("Failed to copy API key");
        }
    };

    const maskedApiKey = apiKey ? `${apiKey.slice(0, 8)}${'•'.repeat(apiKey.length - 12)}${apiKey.slice(-4)}` : '';

    return (
        <div className="space-y-4 font-funnel-sans">
            {apiKey ? (
                <div className="space-y-3">
                    <p className="text-sm text-black/60">
                        Your API key allows you to authenticate with our services programmatically.
                    </p>
                    <div className="flex items-center gap-2">
                        <Input
                            type={showApiKey ? "text" : "password"}
                            value={showApiKey ? apiKey : maskedApiKey}
                            readOnly
                            className="flex-1 bg-white/5 border-black/20 text-black font-mono text-sm rounded-full px-4 py-3"
                        />
                        <Button
                            onClick={() => setShowApiKey(!showApiKey)}
                            variant="outline"
                            size="sm"
                            className="border-black/20 bg-transparent text-black/80 hover:bg-black/5 rounded-full px-3 py-3"
                        >
                            {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </Button>
                        <Button
                            onClick={handleCopyApiKey}
                            variant="outline"
                            size="sm"
                            className="border-black/20 bg-transparent text-black/80 hover:bg-black/5 rounded-full px-3 py-3"
                        >
                            <Copy className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    <p className="text-sm text-black/60">
                        Create an API key to authenticate with our services programmatically.
                    </p>
                    <Button
                        onClick={handleCreateApiKey}
                        disabled={isCreating}
                        className="bg-color2 hover:bg-color3 text-white font-funnel-display font-semibold rounded-full px-6 py-3 transition-all duration-200 hover:scale-105 shadow-lg flex items-center gap-2"
                    >
                        <Key className="w-4 h-4" />
                        {isCreating ? "Creating..." : "Create API Key"}
                    </Button>
                </div>
            )}
        </div>
    );
}

// Simplified Wallet Section Component
function SimplifiedWalletSection() {
    const { connectWallet } = useConnectWallet({
        onSuccess: ({ wallet }) => {
            const walletAddress = wallet.address;
            const connectedWallet = wallets.find((wallet) => wallet.address === walletAddress);
            if (connectedWallet) {
                connectedWallet.loginOrLink();
                toast.success("Wallet connected successfully");
            } else {
                toast.error("Failed to connect wallet");
            }
            console.log(wallet);
            toast.success("Wallet connected successfully");
        },
        onError: (error) => {
            console.log(error);
            toast.error("Failed to connect wallet");
        },
    });
    const { wallets } = useWallets();
    // const { unlinkWallet } = usePrivy();
    // const [isDisconnecting, setIsDisconnecting] = useState(false);
    console.log(wallets, 'wallets');

    const handleConnectWallet = async () => {
        await connectWallet();
    };

    // const handleDisconnectWallet = async () => {
    //     const injectedWallet = wallets.find(wallet => wallet.connectorType === "injected");
    //     if (injectedWallet) {
    //         setIsDisconnecting(true);
    //         try {
    //             await unlinkWallet(injectedWallet.address);
    //             // toast.success("Wallet disconnected successfully");
    //         } catch (error) {
    //             console.error("Error disconnecting wallet:", error);
    //             toast.error("Failed to disconnect wallet");
    //         } finally {
    //             setIsDisconnecting(false);
    //         }
    //     }
    // };

    const formatAddress = (address: string) => {
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    };

    // Check if there's an injected wallet
    const injectedWallet = wallets.find(wallet => wallet.connectorType === "injected");
    const hasInjectedWallet = injectedWallet !== undefined;

    return (
        <div className="space-y-4 font-funnel-sans">
            {hasInjectedWallet ? (
                <div className="space-y-3">
                    <p className="text-sm text-black/60">
                        Your connected wallet allows you to interact with EarnKit services.
                    </p>
                    <div className="flex items-center gap-2">
                        <Input
                            type="text"
                            value={formatAddress(injectedWallet.address)}
                            readOnly
                            className="flex-1 bg-white/5 border-black/20 text-black font-mono text-sm rounded-full px-4 py-3"
                        />
                        {/* <Button
                            onClick={handleDisconnectWallet}
                            disabled={isDisconnecting}
                            variant="outline"
                            size="sm"
                            className="border-black/20 bg-transparent text-black/80 hover:bg-black/5 rounded-full px-3 py-3"
                        >
                            {isDisconnecting ? "Disconnecting..." : "Disconnect"}
                        </Button> */}
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    <p className="text-sm text-black/60">
                        Connect your wallet to start using EarnKit services.
                    </p>
                    <Button
                        onClick={handleConnectWallet}
                        className="bg-color2 hover:bg-color3 text-white font-funnel-display font-semibold rounded-full px-6 py-3 transition-all duration-200 hover:scale-105 shadow-lg flex items-center gap-2"
                    >
                        <Wallet className="w-4 h-4" />
                        Connect Wallet
                    </Button>
                </div>
            )}
        </div>
    );
}