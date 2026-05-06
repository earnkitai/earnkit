"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Action {
    id: number;
    title: string;
    description: string;
    tags: { id: number; text: string; color: string; }[];
}

interface AgentActionsProps {
    onComplete: () => void;
}

export default function AgentActions({ onComplete }: AgentActionsProps) {
    // const [selectedActions, setSelectedActions] = useState<Action[]>([]);
    const [actionCount, setActionCount] = useState(0);

    // Sample tags with different colors
    const tagColors = {
        1: "border-blue-200 bg-blue-50 text-blue-600",
        2: "border-green-200 bg-green-50 text-green-600",
        3: "border-purple-200 bg-purple-50 text-purple-600",
        4: "border-orange-200 bg-orange-50 text-orange-600"
    };

    // Sample actions data
    const sampleActions: Action[] = [
        {
            id: 1,
            title: "Action 1",
            description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod",
            tags: [
                { id: 1, text: "TAG 1", color: tagColors[1] },
                { id: 2, text: "TAG 2", color: tagColors[2] },
                { id: 3, text: "TAG 3", color: tagColors[3] },
                { id: 4, text: "TAG 4", color: tagColors[4] }
            ]
        },
        // Add more sample actions as needed
    ];

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <button className="p-1 hover:bg-gray-100 rounded">
                            <ChevronLeft className="w-5 h-5 text-gray-500" />
                        </button>
                        <button className="p-1 hover:bg-gray-100 rounded">
                            <ChevronRight className="w-5 h-5 text-gray-500" />
                        </button>
                    </div>
                    <h2 className="text-xl font-semibold">Actions</h2>
                </div>
                <div className="flex items-center gap-2">
                    <div className="bg-gray-100 px-3 py-1 rounded-lg text-sm">
                        {String(actionCount).padStart(2, '0')}
                    </div>
                    <span className="text-gray-500 text-sm">Added</span>
                </div>
            </div>

            {/* Action Options */}
            <div className="grid grid-cols-2 gap-4">
                <button className="p-4 bg-white rounded-xl border border-gray-200 hover:border-blue-500 transition-colors text-left">
                    <span className="font-medium">Add from Actions library</span>
                </button>
                <button className="p-4 bg-gray-50 rounded-xl border border-gray-200 hover:border-blue-500 transition-colors text-left">
                    <span className="text-gray-500">Create Custom Action</span>
                </button>
            </div>

            {/* Actions List */}
            <div className="space-y-4">
                {sampleActions.map((action) => (
                    <div
                        key={action.id}
                        className="p-4 bg-white rounded-xl border border-gray-100"
                        onClick={() => setActionCount(actionCount + 1)}
                    >
                        <div className="flex gap-4">
                            <div className="w-16 h-16 bg-gray-100 rounded-lg flex-shrink-0"></div>
                            <div className="flex-1">
                                <h3 className="font-medium mb-1">{action.title}</h3>
                                <p className="text-gray-500 text-sm mb-3">{action.description}</p>
                                <div className="flex flex-wrap gap-2">
                                    {action.tags.map((tag) => (
                                        <span
                                            key={tag.id}
                                            className={`px-2 py-1 text-xs border rounded-full ${tag.color}`}
                                        >
                                            {tag.text}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Continue Button */}
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