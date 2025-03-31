"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, MessageSquare, Settings, Palette, Zap, Plus, User, Bot, ArrowRight } from "lucide-react";

// Step components
import AgentDetails from "../../../components/dashboard/create-agent/AgentDetails";
import AgentActions from "../../../components/dashboard/create-agent/AgentActions";
import CharacterTone from "../../../components/dashboard/create-agent/CharacterTone";
import ResponseCustomization from "../../../components/dashboard/create-agent/ResponseCustomization";
import TokenSection from "../../../components/dashboard/create-agent/TokenSection";

export default function CreateAgentPage() {
    const router = useRouter();
    const [activeSection, setActiveSection] = useState<string | null>(null);
    const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant', content: string }>>([]);

    const sections = [
        {
            id: 'details',
            title: "Agent Details",
            component: AgentDetails,
            icon: Settings,
            description: "Configure basic agent settings and profile"
        },
        {
            id: 'actions',
            title: "Actions",
            component: AgentActions,
            icon: Zap,
            description: "Define what your agent can do"
        },
        {
            id: 'character',
            title: "Character & Tone",
            component: CharacterTone,
            icon: Palette,
            description: "Set your agent's personality and communication style"
        },
        {
            id: 'response',
            title: "Response",
            component: ResponseCustomization,
            icon: MessageSquare,
            description: "Customize how your agent responds"
        },
        {
            id: 'token',
            title: "Token",
            component: TokenSection,
            icon: Plus,
            description: "Configure API tokens and integrations",
            optional: true
        },
    ];

    // Function to generate gradient based on agent name
    const getGradient = (name?: string) => {
        if (!name) return 'bg-gradient-to-r from-blue-600 to-purple-600';
        // Generate consistent gradient based on name
        const hue1 = name.length * 20 % 360;
        const hue2 = (hue1 + 60) % 360;
        return `bg-gradient-to-r from-[hsl(${hue1},70%,50%)] to-[hsl(${hue2},70%,50%)]`;
    };

    return (
        <div className="flex min-h-screen relative">
            {/* Left Section - Agent Creation */}
            <div className="w-full h-screen overflow-y-auto py-10 px-6">
                {activeSection ? (
                    // Show active section content
                    <div>
                        <button
                            onClick={() => setActiveSection(null)}
                            className="flex items-center gap-2 text-gray-600 mb-6 hover:text-gray-900"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back to sections
                        </button>

                        <div className="mb-6">
                            <h2 className="text-2xl font-semibold mb-2">
                                {sections.find(s => s.id === activeSection)?.title}
                            </h2>
                            <p className="text-gray-600">
                                {sections.find(s => s.id === activeSection)?.description}
                            </p>
                        </div>

                        <div className="bg-white rounded-xl p-6">
                            {sections.find(s => s.id === activeSection)?.component({
                                onComplete: () => setActiveSection(null)
                            })}
                        </div>
                    </div>
                ) : (
                    // Show sections list
                    <div>
                        <h1 className="text-2xl font-semibold mb-6 bg-black/4 p-8 my-10 flex items-center justify-center gap-4 rounded-xl">
                            <Bot className="w-6 h-6" />Create Agent
                        </h1>
                        <div className="space-y-4 mt-16">
                            {sections.map((section) => {
                                const Icon = section.icon;
                                return (
                                    <button
                                        key={section.id}
                                        onClick={() => setActiveSection(section.id)}
                                        className="w-full bg-white p-4 rounded-xl border border-gray-200 hover:border-blue-500 transition-colors text-left group"
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className="p-2 bg-gray-50 rounded-lg group-hover:bg-blue-50">
                                                <Icon className="w-6 h-6 text-gray-600 group-hover:text-blue-500" />
                                            </div>
                                            <div>
                                                <h3 className="font-medium mb-1 flex items-center gap-2">
                                                    {section.title}
                                                    {section.optional && (
                                                        <span className="text-xs text-gray-500 px-2 py-0.5 bg-gray-100 rounded-full">
                                                            OPTIONAL
                                                        </span>
                                                    )}
                                                </h3>
                                                <p className="text-sm text-gray-600">{section.description}</p>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        <button
                            onClick={() => router.push("/home")}
                            className="w-full mt-8 bg-blue-500 flex items-center justify-center gap-2 text-white py-4 rounded-full hover:bg-blue-600 transition-colors"
                        >
                            Create Agent
                            <ArrowRight className="w-4 h-4" />
                        </button>
                    </div>
                )}
            </div>

            {/* Right Section - Chat Module */}
            <div className="w-2/4 top-0 right-0 h-screen flex flex-col bg-white border-l border-gray-200">
                {/* Header */}
                <div className={`${getGradient()} p-6 text-white`}>
                    <div className="space-y-4">
                        <h2 className="text-2xl font-semibold">
                            {activeSection ? sections.find(s => s.id === activeSection)?.title : "New Agent"}
                        </h2>
                        <div className="flex items-center gap-2 text-white/80">
                            <User className="w-4 h-4" />
                        </div>
                    </div>
                </div>

                {/* Chat Messages */}
                <div className="flex-1 overflow-y-auto bg-gray-50">
                    <div className="p-6 space-y-6">
                        {messages.length === 0 ? (
                            <div className="h-full min-h-[300px] flex items-center justify-center text-center">
                                <div className="max-w-sm">
                                    <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <MessageSquare className="w-8 h-8 text-blue-500" />
                                    </div>
                                    <h3 className="text-lg font-medium mb-2">Test Your Agent</h3>
                                    <p className="text-gray-600 text-sm">
                                        As you configure your agent, test its responses here to ensure it meets your requirements.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            messages.map((message, index) => (
                                <div
                                    key={index}
                                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                                >
                                    <div
                                        className={`max-w-[80%] rounded-lg p-4 ${message.role === 'user'
                                            ? `${getGradient()} text-white`
                                            : 'bg-white border border-gray-200'
                                            }`}
                                    >
                                        {message.content}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Chat Input */}
                <div className="border-t border-gray-200 bg-white p-4">
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            const input = e.currentTarget.elements.namedItem('message') as HTMLInputElement;
                            if (input.value.trim()) {
                                setMessages([...messages, { role: 'user', content: input.value }]);
                                setTimeout(() => {
                                    setMessages(prev => [...prev, {
                                        role: 'assistant',
                                        content: `This is a test response to: "${input.value}"`
                                    }]);
                                }, 1000);
                                input.value = '';
                            }
                        }}
                        className="flex gap-2"
                    >
                        <input
                            type="text"
                            name="message"
                            placeholder="Test your agent's responses..."
                            className="flex-1 px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                            type="submit"
                            className={`px-6 py-3 text-white rounded-lg transition-colors ${getGradient()} hover:opacity-90`}
                        >
                            Send
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
} 