'use client';

// import { MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Chat {
    id: string;
    title: string;
    createdAt: string;
    messages: Array<{
        content: string;
        responseFrom: string;
        toolName?: string;
    }>;
}

interface SidebarChatHistoryProps {
    userId?: string | null;
}

export default function SidebarChatHistory({ userId }: SidebarChatHistoryProps) {
    const [chats, setChats] = useState<Chat[]>([]);
    // const [isExpanded, setIsExpanded] = useState(false);

    useEffect(() => {
        if (userId) {
            fetchChats();
        }
    }, [userId]);

    const fetchChats = async () => {
        if (!userId) return;

        try {
            const response = await fetch(`/api/chat?userId=${userId}`);
            const data = await response.json();
            console.log(data, "chats")
            setChats(data.chats);
        } catch (error) {
            console.error('Error fetching chats:', error);
        }
    };

    const getTimeGroup = (date: Date): string => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const chatDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const diffTime = Math.abs(today.getTime() - chatDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return 'Today';
        if (diffDays <= 7) return 'Previous 7 days';
        if (diffDays <= 30) return 'Previous 30 days';
        return date.toLocaleString('default', { month: 'long', year: 'numeric' });
    };

    const groupChatsByTime = (chats: Chat[]) => {
        return chats.reduce((groups: { [key: string]: Chat[] }, chat) => {
            const date = new Date(chat.createdAt);
            const group = getTimeGroup(date);
            if (!groups[group]) {
                groups[group] = [];
            }
            groups[group].push(chat);
            return groups;
        }, {});
    };

    const groupedChats = groupChatsByTime(chats);

    return (
        <div className="w-full flex flex-col">
            <span className="flex items-center gap-2 px-6 py-2 rounded-lg transition-colors w-full text-black/40">
                <span className="text-md font-medium">Chat History</span>
            </span>
            <div className="flex-1 overflow-y-scroll max-h-[40vh] rounded-lg py-3">
                {chats.length === 0 ? (
                    <div className="text-sm text-gray-500 text-center py-2">
                        No chat history
                    </div>
                ) : (
                    <div className="space-y-4 ">
                        {Object.entries(groupedChats).map(([group, groupChats]) => (
                            <div key={group} className="space-y-2">
                                <h3 className="text-xs font-medium text-black/40 px-6 pb-2">{group}</h3>
                                <div className="space-y-1 max-w-full pb-8">
                                    {groupChats.map((chat) => (
                                        <Link
                                            key={chat.id}
                                            href={`/chat/${chat.id}`}
                                            className={"block text-left px-6 py-1 truncate overflow-hidden rounded-lg text-[0.975rem] text-medium capitalize transition-colors text-black/40 hover:text-black hover:bg-gray-100"}
                                        >
                                            {chat.title}
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
} 