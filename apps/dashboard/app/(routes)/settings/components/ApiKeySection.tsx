"use client";

import { useState, useEffect, useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { toast } from "sonner";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { createApiKey, getApiKey, regenerateApiKey, deleteApiKey } from "@/actions/user";
import { Eye, EyeOff, Copy, Key, Trash2, RefreshCw } from "lucide-react";

export function ApiKeySection() {
    const { ready, authenticated, user } = usePrivy();
    const [apiKey, setApiKey] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
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

    const handleRegenerateApiKey = async () => {
        if (!user?.id) return;

        setIsLoading(true);
        try {
            const userId = user.id.split(':').pop() || user.id;
            const newApiKey = await regenerateApiKey(userId);
            setApiKey(newApiKey);
            setShowApiKey(true);
            toast.success("API key regenerated successfully");
        } catch (error) {
            console.error("Error regenerating API key:", error);
            toast.error("Failed to regenerate API key");
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteApiKey = async () => {
        if (!user?.id) return;

        setIsLoading(true);
        try {
            const userId = user.id.split(':').pop() || user.id;
            await deleteApiKey(userId);
            setApiKey(null);
            setShowApiKey(false);
            toast.success("API key deleted successfully");
        } catch (error) {
            console.error("Error deleting API key:", error);
            toast.error("Failed to delete API key");
        } finally {
            setIsLoading(false);
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
        <div className="space-y-6 font-funnel-sans">
            <div className="space-y-4">


                {apiKey ? (
                    <div className="space-y-4">
                        <div className="space-y-2">
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

                        <div className="flex items-center gap-3">
                            <Button
                                onClick={handleRegenerateApiKey}
                                disabled={isLoading}
                                className="bg-color2 hover:bg-color3 text-white font-funnel-display font-semibold rounded-full px-6 py-3 transition-all duration-200 hover:scale-105 shadow-lg flex items-center gap-2"
                            >
                                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                                Regenerate
                            </Button>
                            <Button
                                onClick={handleDeleteApiKey}
                                disabled={isLoading}
                                variant="outline"
                                className="border-red-200 bg-transparent text-red-600 hover:bg-red-50 rounded-full px-6 py-3 transition-all duration-200 hover:scale-105 flex items-center gap-2"
                            >
                                <Trash2 className="w-4 h-4" />
                                Delete
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <p className="text-sm text-black/60">
                            Create an API key to authenticate with our services programmatically.
                        </p>
                        <Button
                            onClick={handleCreateApiKey}
                            disabled={isCreating}
                            className="bg-color2 hover:bg-color3 text-white font-funnel-display font-semibold rounded-full px-8 py-4 transition-all duration-200 hover:scale-105 shadow-lg flex items-center gap-2"
                        >
                            <Key className="w-4 h-4" />
                            {isCreating ? "Creating..." : "Create API Key"}
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
