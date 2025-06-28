interface AgentCardProps {
    name: string;
    owner: string;
    color: string;
    type: "local" | "farcaster";
}

export default function AgentCard({ name, owner, color, type }: AgentCardProps) {
    const colorMap: Record<string, string> = {
        teal: "bg-teal-400 dark:bg-teal-500",
        purple: "bg-purple-400 dark:bg-purple-500",
        yellow: "bg-yellow-400 dark:bg-yellow-500",
        orange: "bg-orange-400 dark:bg-orange-500",
        green: "bg-green-400 dark:bg-green-500",
    };

    return (
        <div className="bg-card p-6 rounded-xl border shadow-sm">
            <div className={`${colorMap[color]} w-20 h-20 rounded-full mb-4`}></div>
            <h3 className="text-lg font-medium mb-1 text-foreground">{name}</h3>
            <div className="flex items-center gap-2 mb-3">
                <span className="text-sm text-muted-foreground">By</span>
                <div className="flex items-center gap-1">
                    <div className="w-5 h-5 rounded-full bg-muted"></div>
                    <span className="text-sm text-foreground">{owner}</span>
                </div>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
                Lorem ipsum dolor sit amet, consectetur adipiscing elit,
                sed do eiusmod tempor incididunt ut labore
            </p>
            <div>
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${type === "farcaster"
                    ? "bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-100"
                    : "bg-muted text-muted-foreground"
                    }`}>
                    {type === "farcaster" ? "FARCASTER ↗" : "LOCAL"}
                </span>
            </div>
        </div>
    );
} 