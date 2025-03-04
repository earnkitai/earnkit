interface AgentCardProps {
    name: string;
    owner: string;
    color: string;
    type: "local" | "farcaster";
}

export default function AgentCard({ name, owner, color, type }: AgentCardProps) {
    const colorMap: Record<string, string> = {
        teal: "bg-teal-400",
        purple: "bg-purple-400",
        yellow: "bg-yellow-400",
        orange: "bg-orange-400",
        green: "bg-green-400",
    };

    return (
        <div className="bg-gray-50 p-6 rounded-xl">
            <div className={`${colorMap[color]} w-20 h-20 rounded-full mb-4`}></div>
            <h3 className="text-lg font-medium mb-1">{name}</h3>
            <div className="flex items-center gap-2 mb-3">
                <span className="text-sm text-gray-500">By</span>
                <div className="flex items-center gap-1">
                    <div className="w-5 h-5 rounded-full bg-gray-300"></div>
                    <span className="text-sm">{owner}</span>
                </div>
            </div>
            <p className="text-sm text-gray-500 mb-4">
                Lorem ipsum dolor sit amet, consectetur adipiscing elit,
                sed do eiusmod tempor incididunt ut labore
            </p>
            <div>
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${type === "farcaster"
                    ? "bg-purple-100 text-purple-800"
                    : "bg-gray-200 text-gray-800"
                    }`}>
                    {type === "farcaster" ? "FARCASTER ↗" : "LOCAL"}
                </span>
            </div>
        </div>
    );
} 