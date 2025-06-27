"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
// import { signOut } from "next-auth/react";
import {
    User,
    Settings,
    LogOut,
} from "lucide-react";
// import { useAuth } from "@/providers/auth-provider";
import { useEffect, useState } from "react";
import { findUserById } from "@/actions/user";
// import Image from "next/image";
import { Icons } from "../sections/icons";
// import SidebarChatHistory from "./SidebarChatHistory";
import { usePrivy } from "@privy-io/react-auth";
import { v4 as uuidv4 } from 'uuid';
// import { useState } from "react";

export default function Sidebar() {
    // const { user } = useUser();
    const pathname = usePathname();
    const router = useRouter();
    const { ready, authenticated, user: privyUser, logout } = usePrivy();
    // const [isHovered, setIsHovered] = useState(false);
    const [isOpen, setIsOpen] = useState(true);
    const [isMobile, setIsMobile] = useState(false);
    const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);
    const [username, setUsername] = useState<string>("");
    // const [pfpUrl, setPfpUrl] = useState<string>("");
    // const [userId, setUserId] = useState<string | null>(null);

    useEffect(() => {
        if (ready && authenticated && privyUser) {
            // console.log(privyUser, 'privyUser');
            const userId = privyUser?.id.split(':').pop() || privyUser?.id;
            // console.log(userId, 'userId');
            setUserId(userId);
            const fetchUsername = async () => {
                if (userId) {
                    const result = await findUserById(userId);
                    if (result && result.username) {
                        setUsername(result.username);
                        // console.log(result, 'result');
                    }
                }
            };
            fetchUsername();
        }
    }, [ready, authenticated, privyUser]);

    // Check if device is mobile
    useEffect(() => {
        const checkIfMobile = () => {
            setIsMobile(window.innerWidth < 768);
        };

        checkIfMobile();
        window.addEventListener('resize', checkIfMobile);

        return () => {
            window.removeEventListener('resize', checkIfMobile);
        };
    }, []);

    // Handle sidebar toggle
    // const toggleSidebar = () => {
    //     setIsOpen(!isOpen);
    // };

    // Handle mouse events for desktop only
    // const handleMouseEnter = () => {
    //     if (!isMobile) {
    //         setIsHovered(true);
    //     }
    // };

    // const handleMouseLeave = () => {
    //     if (!isMobile) {
    //         setIsHovered(false);
    //     }
    // };

    // Close sidebar when clicking outside
    const handleOverlayClick = () => {
        setIsOpen(false);
    };

    const isActive = (path: string) => {
        return pathname.includes(path);
    };

    const getLinkStyles = (path: string) => {
        return `flex items-center gap-2 px-0 py-0 rounded-lg transition-colors w-full group font-medium font-funnel-sans
            ${isActive(path)
                ? "text-white [&>svg]:text-white [&>svg>path]:opacity-100 "
                : "text-white/40 hover:text-white"
            }`;
    };

    // Handle logout and close sidebar on mobile
    const handleLogoutClick = () => {
        console.log("logging out");
        logout().then(() => {
            console.log("logged out");
            router.push("/");
            if (isMobile) {
                setIsOpen(false);
            }
        });
        // console.log("logged out");
        // router.push("/");
        // if (isMobile) {
        //     setIsOpen(false);
        // }
    };

    const handleProfileClick = () => {
        setIsProfileMenuOpen(!isProfileMenuOpen);
    };

    // Close profile menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (!target.closest('.profile-menu')) {
                setIsProfileMenuOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);


    const handleNewChat = async () => {

        if (!userId) return;

        const clientGeneratedId = uuidv4();

        // // Store the initial message locally using the generated ID
        // localStorage.setItem(`initialMessage ${clientGeneratedId}`, inputValueNew);

        // Redirect immediately
        router.push(`/chat/${clientGeneratedId}`);

        try {
            // Fire and forget (background) DB creation
            await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    userId: userId,
                    chatId: clientGeneratedId, // important: pass the UUID to backend
                    title: "New Chat",
                }),
            });
        } catch (error) {
            console.error('Error creating new chat:', error);
            // Optional: show a toast or handle background error
        }
    };

    return (
        <div className="relative">

            {/* Main Sidebar */}

            {/* <div className="fixed top-4 left-4 bg-[#f0f0f0] rounded-lg md:hidden z-100">
                <div className="flex flex-col justify-start items-start space-y-6">
                    {isOpen ? <Icons.sidebarOpen onClick={() => toggleSidebar()} className="cursor-pointer" /> : <Icons.sidebarOpenIcon onClick={() => toggleSidebar()} className="cursor-pointer" />}
                </div>
            </div> */}

            <aside
                className={`fixed z-30 left-0 top-0 h-[100dvh] py-[80px] md:h-screen flex flex-col justify-start items-center transition-all duration-300 ease-in-out transform transition-all duration-300 ease-in-out transform gap-[60px] bg-black px-[20px] w-[200px] sm:w-[200px] ${isMobile && !isOpen ? 'hidden' : 'block'} `}
            >
                <div className="flex flex-col w-full justify-between items-start space-y-6">
                    <Icons.earnySmallGrayIcon className="w-8 h-8" />
                </div>
                {/* Main Navigation */}
                <nav className="flex w-full">
                    <div className="w-full flex flex-col gap-[32px]">
                        <Link
                            href="/home"
                            className={getLinkStyles("/home")}
                            onClick={() => {
                                if (isMobile) setIsOpen(false);
                            }}
                        >
                            <Icons.newSidebarHomeMenuIcon className="group-hover:text-white h-8 w-8" />
                            <span className={`absolute left-[54px] whitespace-nowrap transition-all `}>Home</span>
                        </Link>
                        <div
                            className={getLinkStyles("/chat")}
                            onClick={() => {
                                if (isMobile) setIsOpen(false);
                                handleNewChat();
                            }}
                        >
                            <Icons.newSidebarEarnyMenuIcon className="group-hover:text-white h-8 w-8 cursor-pointer" />
                            <span className={`absolute left-[54px] whitespace-nowrap transition-all cursor-pointer`}>Earny</span>

                        </div>
                        <Link
                            href="/wallet"
                            className={getLinkStyles("/wallet")}
                            onClick={() => {
                                if (isMobile) setIsOpen(false);
                            }}
                        >
                            <Icons.newSidebarWalletMenuIcon className="group-hover:text-white h-8 w-8" />
                            <span className={`absolute left-[54px] whitespace-nowrap transition-all`}>Wallet</span>
                        </Link>
                        {/* <span
                            className="flex items-center gap-2 px-0 py-2 rounded-lg transition-colors w-full text-black/40"
                        >
                            <Icons.sidebarChatIcon className="w-8 h-8 min-w-8 min-h-8 md:w-4 md:h-4 bg-black/4 rounded-full p-1 group-hover:bg-black/40 group-hover:fill-white group-hover:text-white font-normal group-hover:font-semibold" />
                            <span className={`absolute left-16 whitespace-nowrap transition-all duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`}>History</span>
                        </span> */}
                    </div>
                </nav>
                {/* <div className="flex-1 w-full overflow-y-auto" onClick={() => toggleSidebar()}>
                    {<SidebarChatHistory
                        userId={userId}
                        isExpanded={isOpen}
                    />}
                </div> */}

                {/* Secondary Navigation */}

                <nav className="flex w-full mt-auto">
                    <div className="w-full">
                        {/* <Link
                            href="https://docs.earnkit.com"
                            target="_blank"
                            className={getLinkStyles("/docs")}
                            onClick={() => isMobile && setIsOpen(false)}
                        >
                            <Icons.sidebarDocIcon className="w-8 h-8 min-w-8 min-h-8 md:w-4 md:h-4 bg-black/4 rounded-full p-1 group-hover:bg-black/40 group-hover:fill-white group-hover:text-white" />
                            <span className={`absolute left-16 whitespace-nowrap transition-all duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`}>Docs</span>
                        </Link> */}
                        <div className="relative profile-menu">

                            {isProfileMenuOpen && (
                                <div className="absolute -top-40 left-0 mt-2 w-56 bg-black border border-white/10 rounded-[24px] shadow-xl py-3 z-50">
                                    <Link
                                        href="/settings"
                                        className="flex items-center gap-3 px-4 py-3 text-sm text-white/80 w-full group font-funnel-sans hover:bg-white/5 transition-colors"
                                        onClick={() => {
                                            if (isMobile) setIsOpen(false);
                                            setIsProfileMenuOpen(false);
                                        }}
                                    >
                                        <div className="w-8 h-8 bg-color2 rounded-full flex items-center justify-center group-hover:bg-color3 transition-colors">
                                            <Settings className="w-4 h-4 text-white" />
                                        </div>
                                        <span className="group-hover:text-white transition-colors font-medium">Settings</span>
                                    </Link>
                                    <button
                                        className="flex items-center gap-3 px-4 py-3 text-sm text-white/80 w-full group font-funnel-sans hover:bg-white/5 transition-colors"
                                        onClick={() => {
                                            handleLogoutClick();
                                            setIsProfileMenuOpen(false);
                                        }}
                                    >
                                        <div className="w-8 h-8 bg-color2 rounded-full flex items-center justify-center group-hover:bg-color3 transition-colors">
                                            <LogOut className="w-4 h-4 text-white" />
                                        </div>
                                        <span className="group-hover:text-white transition-colors font-medium">Log out</span>
                                    </button>
                                </div>
                            )}
                            <div
                                className={getLinkStyles("/user/profile") + " relative cursor-pointer"}
                                onClick={handleProfileClick}
                            >
                                {/* {false ? (
                                    <Image
                                        src={"pfpUrl"}
                                        alt="Profile Picture"
                                        className="w-4 h-4 sm:w-5 sm:h-5 rounded-full"
                                        width={20}
                                        height={20}
                                    />
                                ) : ( */}
                                <User className="w-8 h-8 min-w-8 min-h-8 md:w-4 md:h-4 bg-black/4 rounded-full p-2 text-white/40 group-hover:fill-white group-hover:text-white" />
                                {/* )} */}
                                <span className={`absolute left-10 text-sm text-white/40 max-w-[75%] font-medium whitespace-nowrap text-ellipsis overflow-hidden transition-all group-hover:text-white`}>{username !== "" ? username : "user"}</span>
                                <Icons.arrowDownSidebarUserIcon className="w-4 h-4 absolute right-0 text-white/40 group-hover:text-white" />
                            </div>


                        </div>
                    </div>
                </nav>
            </aside>

            {/* Overlay for mobile */}
            {(isOpen) && (
                <div
                    className="fixed inset-0 bg-transparent z-10 sm:hidden"
                    onClick={handleOverlayClick}
                />
            )}
        </div >
    );
} 