'use client';

import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
// import {
//     DropdownMenu,
//     DropdownMenuContent,
//     DropdownMenuItem,
//     DropdownMenuTrigger,
// } from '@/app/components/ui/dropdown-menu';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { useChat } from '@/providers/chat-provider';

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
    isExpanded?: boolean;
}

export default function SidebarChatHistory({ userId, isExpanded = false }: SidebarChatHistoryProps) {
    const [chats, setChats] = useState<Chat[]>([]);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
    const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
    const [newTitle, setNewTitle] = useState('');
    // const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isRenaming, setIsRenaming] = useState(false);
    const { needToFetchChats, setNeedToFetchChats } = useChat();

    // useEffect(() => {
    //     if (!isExpanded) {
    //         setOpenDropdownId(null);
    //     }
    // }, [isExpanded]);

    const fetchChats = useCallback(async () => {
        // console.log(userId, 'userId');
        if (!userId) return;

        try {
            const response = await fetch(`/api/chat?userId=${userId}`);
            const data = await response.json();
            // console.log(data, 'chats list');
            setChats(data.chats);
        } catch (error) {
            console.error('Error fetching chats:', error);
        }
    }, [userId]);

    useEffect(() => {
        if (userId) {
            fetchChats();
        }
        if (needToFetchChats) {
            fetchChats();
            setNeedToFetchChats(false);
        }
    }, [userId, needToFetchChats, fetchChats, setNeedToFetchChats]);

    const handleDelete = async () => {
        if (!selectedChat) return;
        setIsDeleting(true);

        try {
            const response = await fetch(`/api/chat/${selectedChat.id}`, {
                method: 'DELETE',
            });

            if (response.ok) {
                setChats(chats.filter(chat => chat.id !== selectedChat.id));
                setIsDeleteDialogOpen(false);
                setSelectedChat(null);
            } else {
                console.error('Failed to delete chat');
            }
        } catch (error) {
            console.error('Error deleting chat:', error);
        } finally {
            setIsDeleting(false);
        }
    };

    const handleRename = async () => {
        if (!selectedChat || !newTitle.trim()) return;
        setIsRenaming(true);

        try {
            const response = await fetch(`/api/chat/${selectedChat.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ title: newTitle }),
            });

            if (response.ok) {
                const updatedChat = await response.json();
                setChats(chats.map(chat =>
                    chat.id === selectedChat.id ? { ...chat, title: updatedChat.title } : chat
                ));
                setIsRenameDialogOpen(false);
                setSelectedChat(null);
                setNewTitle('');
            } else {
                console.error('Failed to rename chat');
            }
        } catch (error) {
            console.error('Error renaming chat:', error);
        } finally {
            setIsRenaming(false);
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
        <>
            {isExpanded &&
                <div className="w-full flex flex-col" >
                    <div className="flex-1 rounded-lg py-3">
                        {chats.length === 0 ? (
                            <div className="text-sm text-gray-500 text-left py-2 px-6">
                                No chat history
                            </div>
                        ) : (
                            <div>
                                {Object.entries(groupedChats).map(([group, groupChats]) => (
                                    <div key={group}>
                                        {/* <h3 className="text-xs font-medium text-black/40 px-6 pb-2">{group}</h3> */}
                                        <div className="max-w-full">
                                            {groupChats.map((chat) => (
                                                <div key={chat.id} className="group flex items-center py-1 group">
                                                    <div className="w-3 h-3 rounded-full bg-black/40 group-hover:bg-black/80"></div>
                                                    <Link
                                                        href={`/chat/${chat.id}`}
                                                        className="flex-1 truncate overflow-hidden px-2 rounded-lg text-sm text-medium capitalize transition-colors text-black/40 group-hover:text-black/80"
                                                    >
                                                        {chat.title}
                                                    </Link>
                                                    {/* <DropdownMenu
                                                modal={false}
                                                open={openDropdownId === chat.id}
                                                onOpenChange={(open) => {
                                                    if (open && isExpanded) {
                                                        setOpenDropdownId(chat.id);
                                                    } else {
                                                        setOpenDropdownId(null);
                                                    }
                                                }}
                                            >
                                                <DropdownMenuTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100"
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                        }}
                                                    >
                                                        <MoreVertical className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent
                                                    align="end"
                                                    onCloseAutoFocus={(e) => {
                                                        e.preventDefault();
                                                    }}
                                                    className="bg-white p-2 space-y-2 font-funnel-sans"
                                                >
                                                    <DropdownMenuItem
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            setSelectedChat(chat);
                                                            setNewTitle(chat.title);
                                                            setIsRenameDialogOpen(true);
                                                            setOpenDropdownId(null);
                                                        }}
                                                        className="bg-white hover:bg-gray-100 cursor-pointer font-funnel-sans"
                                                    >
                                                        <Pencil className="h-4 w-4 mr-2" /> Rename
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        className="text-red-600 bg-white hover:bg-gray-100 cursor-pointer font-funnel-sans"
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            setSelectedChat(chat);
                                                            setIsDeleteDialogOpen(true);
                                                            setOpenDropdownId(null);
                                                        }}
                                                    >
                                                        <Trash className="h-4 w-4 mr-2" /> Delete
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu> */}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Delete Confirmation Dialog */}
                    <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                        <DialogContent className="font-funnel-sans">
                            <DialogHeader className="mb-8">
                                <DialogTitle className="text-lg font-medium">Delete chat?</DialogTitle>
                                <DialogDescription className="text-sm mt-6">
                                    This will delete &quot;{selectedChat?.title}&quot; and all associated memories.
                                </DialogDescription>
                            </DialogHeader>
                            <DialogFooter>
                                <Button
                                    variant="outline"
                                    onClick={() => setIsDeleteDialogOpen(false)}
                                    disabled={isDeleting}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    variant="destructive"
                                    onClick={handleDelete}
                                    disabled={isDeleting}
                                >
                                    {isDeleting ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Deleting...
                                        </>
                                    ) : (
                                        'Delete'
                                    )}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* Rename Dialog */}
                    <Dialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
                        <DialogContent className="font-funnel-sans">
                            <DialogHeader>
                                <DialogTitle>Rename chat</DialogTitle>
                            </DialogHeader>
                            <Input
                                value={newTitle}
                                onChange={(e) => setNewTitle(e.target.value)}
                                placeholder="Enter new title"
                                disabled={isRenaming}
                            />
                            <DialogFooter className="font-funnel-sans">
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        setIsRenameDialogOpen(false);
                                        setNewTitle('');
                                    }}
                                    disabled={isRenaming}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    variant={'dark'}
                                    onClick={handleRename}
                                    disabled={!newTitle.trim() || isRenaming}
                                >
                                    {isRenaming ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Renaming...
                                        </>
                                    ) : (
                                        'Save'
                                    )}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>}
        </>
    );
} 