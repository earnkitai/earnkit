"use client";

interface AgentDetailsProps {
    onComplete: () => void;
}

export default function AgentDetails({ onComplete }: AgentDetailsProps) {
    return (
        <div className="space-y-6">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    Agent Name
                </label>
                <input
                    type="text"
                    className="w-full p-3 border border-gray-200 rounded-lg"
                    placeholder="Enter agent name"
                />
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    Description
                </label>
                <textarea
                    className="w-full p-3 border border-gray-200 rounded-lg min-h-[100px]"
                    placeholder="Describe your agent"
                />
            </div>

            <div className="flex justify-end">
                <button
                    onClick={onComplete}
                    className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                    Continue
                </button>
            </div>
        </div>
    );
} 