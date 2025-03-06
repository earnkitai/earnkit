"use client";

// import { useSession } from "next-auth/react";
// import { useRouter } from "next/navigation";
// import { useEffect } from "react";
import AgentCard from "@/app/components/dashboard/AgentCard";
import Header from "@/app/components/dashboard/Header";

export default function Dashboard() {
    // const { data: session, status } = useSession();
    // const router = useRouter();

    // console.log(session, "session");

    return (
        <div className="relative p-10">
            <Header />
            <div className="text-center mb-12">
                <h1 className="text-4xl font-bold mb-4">Agents</h1>
                <p className="text-gray-600 max-w-2xl mx-auto">
                    Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do
                    eiusmod tempor incididunt ut labore et dolore magna aliqua
                </p>
            </div>

            {/* Your Agents Section */}
            <section className="mb-12">
                <h2 className="text-xl font-semibold mb-6">Your Agents</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <AgentCard
                        name="Super Agent"
                        owner="Jenil"
                        color="teal"
                        type="local"
                    />
                    <AgentCard
                        name="Super Agent"
                        owner="Jenil"
                        color="purple"
                        type="local"
                    />
                    <AgentCard
                        name="Super Agent"
                        owner="Jenil"
                        color="yellow"
                        type="farcaster"
                    />
                </div>
            </section>

            {/* Trending Section */}
            <section>
                <h2 className="text-xl font-semibold mb-6">Trending</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <AgentCard
                        name="Super Agent"
                        owner="EarnKit"
                        color="orange"
                        type="local"
                    />
                    <AgentCard
                        name="Super Agent"
                        owner="EarnKit"
                        color="purple"
                        type="local"
                    />
                    <AgentCard
                        name="Super Agent"
                        owner="EarnKit"
                        color="green"
                        type="local"
                    />
                </div>
            </section>
        </div>
    );
}  