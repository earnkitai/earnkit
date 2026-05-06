'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

interface Chat {
    id: string;
    title: string;
    createdAt: string;
}

interface ChatHistoryProps {
    isOpen: boolean;
    onClose: () => void;
    currentChatId: string | null;
    userId: string | null;
}

export default function ChatHistory({ isOpen, onClose, currentChatId, userId }: ChatHistoryProps) {
    const [chats, setChats] = useState<Chat[]>([]);
    const router = useRouter();

    useEffect(() => {
        const fetchChats = async () => {
            if (!userId) return;
            try {
                const response = await fetch(`/api/chat?userId=${userId}`);
                const data = await response.json();
                if (data.chats) {
                    setChats(data.chats);
                }
            } catch (error) {
                console.error('Error fetching chats:', error);
            }
        };
        fetchChats();
    }, [userId]);

    const handleSelectChat = (chatId: string) => {
        router.push(`/chat/${chatId}`);
        onClose();
    };

    return (
        <Dialog.Root open={isOpen} onOpenChange={onClose}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/20 backdrop-blur-sm" />
                <Dialog.Content className="fixed right-0 top-0 h-full w-[400px] bg-white p-6 shadow-lg">
                    <div className="flex items-center justify-between mb-6">
                        <Dialog.Title className="text-xl font-semibold">Chat History</Dialog.Title>
                        <Dialog.Close className="text-gray-500 hover:text-gray-700">
                            <X className="w-6 h-6" />
                        </Dialog.Close>
                    </div>
                    <div className="space-y-4">
                        {chats.map((chat) => (
                            <button
                                key={chat.id}
                                onClick={() => handleSelectChat(chat.id)}
                                className={`w-full text-left p-4 rounded-lg transition-colors ${currentChatId === chat.id
                                    ? 'bg-black/4 text-black/80'
                                    : 'hover:bg-gray-50'
                                    }`}
                            >
                                <div className="font-medium">{chat.title}</div>
                                <div className="text-sm text-gray-500">
                                    {new Date(chat.createdAt).toLocaleDateString()}
                                </div>
                            </button>
                        ))}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}