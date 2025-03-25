'use client';

import { X, MessageSquare } from 'lucide-react';
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

interface GroupedChats {
    [key: string]: Chat[];
}

interface ChatHistoryProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectChat: (chatId: string) => void;
    currentChatId: string | null;
    userId?: string | null;
}

export default function ChatHistory({ isOpen, onClose, onSelectChat, currentChatId, userId }: ChatHistoryProps) {
    const [chats, setChats] = useState<Chat[]>([]);

    // Fetch chats when the component is opened
    useEffect(() => {
        if (isOpen && userId) {
            fetchChats();
        }
    }, [isOpen, userId]);

    const fetchChats = async () => {
        if (!userId) return;

        try {
            const response = await fetch(`/api/chat?userId=${userId}`);
            const data = await response.json();
            setChats(data.chats);
        } catch (error) {
            console.error('Error fetching chats:', error);
        }
    };

    // Add event listener for ESC key
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    // Add class to prevent body scroll when panel is open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [isOpen]);

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

    const groupChatsByTime = (chats: Chat[]): GroupedChats => {
        return chats.reduce((groups: GroupedChats, chat) => {
            const date = new Date(chat.createdAt);
            const group = getTimeGroup(date);
            if (!groups[group]) {
                groups[group] = [];
            }
            groups[group].push(chat);
            return groups;
        }, {});
    };

    // const getChatPreview = (messages: Chat['messages']) => {
    //     const lastMessage = messages[messages.length - 1];
    //     if (!lastMessage) return 'New Chat';
    //     return lastMessage.content.length > 100
    //         ? lastMessage.content.substring(0, 100) + '...'
    //         : lastMessage.content;
    // };

    const groupedChats = groupChatsByTime(chats);

    return (
        <>
            {/* Backdrop */}
            <div
                className={`fixed inset-0 bg-black/25 backdrop-blur-sm transition-opacity duration-300 z-40
          ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                onClick={onClose}
            />

            {/* Panel */}
            <div
                className={`fixed inset-y-0 right-0 w-[400px] bg-white shadow-2xl z-50 
          transform transition-transform duration-300 ease-out
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
            >
                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b">
                        <h2 className="text-lg font-semibold">Chat History</h2>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                            aria-label="Close chat history"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-4">
                        {chats.length === 0 ? (
                            <div className="h-full flex items-center justify-center text-center">
                                <div className="max-w-sm">
                                    <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <MessageSquare className="w-8 h-8 text-blue-500" />
                                    </div>
                                    <h3 className="text-lg font-medium mb-2">No Chat History</h3>
                                    <p className="text-gray-600 text-sm">
                                        Start a new chat to begin your conversation. Your chat history will appear here.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {Object.entries(groupedChats).map(([group, groupChats]) => (
                                    <div key={group} className="space-y-4">
                                        <h3 className="text-sm font-medium text-gray-500 px-2">{group}</h3>
                                        <div className="space-y-1">
                                            {groupChats.map((chat) => (
                                                <div
                                                    key={chat.id}
                                                    onClick={() => {
                                                        onSelectChat(chat.id);
                                                        onClose();
                                                    }}
                                                    className={`px-2 py-1 rounded-lg transition-colors cursor-pointer
                                                        ${currentChatId === chat.id
                                                            ? 'bg-blue-50 border border-blue-200'
                                                            : 'hover:bg-gray-100'
                                                        }`}
                                                >
                                                    <p className="font-medium mb-1">{chat.title}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}