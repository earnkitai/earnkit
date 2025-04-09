"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
// import { signOut } from "next-auth/react";
import {
    User,
    Wallet,
    Home,
    FileText,
    Settings,
    LogOut
} from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { useEffect, useState } from "react";
import { useUser } from "@/hooks/use-user";
import { getUsernameByUserId } from "@/actions/user";
import Image from "next/image";
import { Icons } from "../sections/icons";
import SidebarChatHistory from "./SidebarChatHistory";
// import { useState } from "react";

export default function Sidebar() {
    const { user } = useUser();
    const pathname = usePathname();
    const { logout } = useAuth();
    const [isHovered, setIsHovered] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [isMobile, setIsMobile] = useState(false);

    const [username, setUsername] = useState<string>("");
    const [pfpUrl, setPfpUrl] = useState<string>("");

    useEffect(() => {
        const fetchUsername = async () => {
            if (user?.userId) {
                const result = await getUsernameByUserId(user.userId);
                if (result.success && result.username) {
                    setUsername(result.username);
                    setPfpUrl(result.pfpUrl || "");
                }
            }
        };
        fetchUsername();
    }, [user]);

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
    const toggleSidebar = () => {
        setIsOpen(!isOpen);
    };

    // Handle mouse events for desktop only
    const handleMouseEnter = () => {
        if (!isMobile) {
            setIsHovered(true);
        }
    };

    const handleMouseLeave = () => {
        if (!isMobile) {
            setIsHovered(false);
        }
    };

    // Close sidebar when clicking outside
    const handleOverlayClick = () => {
        setIsOpen(false);
    };

    const isActive = (path: string) => {
        return pathname === path;
    };

    const getLinkStyles = (path: string) => {
        return `flex items-center gap-2 px-6 py-3 rounded-lg transition-colors w-full
            ${isActive(path)
                ? "text-black hover:bg-gray-100"
                : "text-black/40 hover:text-black hover:bg-gray-100"
            }`;
    };

    // Handle logout and close sidebar on mobile
    const handleLogoutClick = () => {
        logout();
        if (isMobile) {
            setIsOpen(false);
        }
    };

    return (
        <div className="relative">
            {/* PanelRight Icon Container */}
            <div
                className={`fixed z-20 left-0 top-0 h-[100dvh] md:h-screen w-[40px] sm:w-[60px] flex items-start justify-center rounded-r-2xl transition-opacity duration-300 ${isHovered || isOpen ? 'opacity-0' : 'opacity-100'}`}
                onMouseEnter={handleMouseEnter}
                onClick={toggleSidebar}
            >
                <Icons.sidebarOpen className="w-5 h-5 sm:w-6 sm:h-6 mt-4" />
            </div>

            {/* Overlay for mobile */}
            {(isOpen || isHovered) && (
                <div
                    className="fixed inset-0 bg-black/20 z-10 sm:hidden"
                    onClick={handleOverlayClick}
                />
            )}

            {/* Main Sidebar */}
            <aside
                className={`fixed z-30 left-0 top-0 h-[100dvh] md:h-screen bg-[#F8F8F8] flex flex-col justify-between items-center rounded-r-2xl transition-all duration-300 ease-in-out transform shadow-2xl ${isHovered || isOpen ? 'translate-x-0 w-[250px] sm:w-[300px]' : '-translate-x-full w-[250px] sm:w-[300px]'}`}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                {/* Main Navigation */}
                <nav className="flex w-full p-4 sm:p-6">
                    <div className="space-y-2 sm:space-y-4 w-full">
                        <Link
                            href="/home"
                            className={getLinkStyles("/home")}
                            onClick={() => isMobile && setIsOpen(false)}
                        >
                            <Home className="w-4 h-4 sm:w-5 sm:h-5 min-w-4 sm:min-w-5" />
                            <span className="text-sm sm:text-base font-medium">Home</span>
                        </Link>
                        <Link
                            href="/wallet"
                            className={getLinkStyles("/wallet")}
                            onClick={() => isMobile && setIsOpen(false)}
                        >
                            <Wallet className="w-4 h-4 sm:w-5 sm:h-5" />
                            <span className="text-sm sm:text-base font-medium">Wallet</span>
                        </Link>


                    </div>
                </nav>
                <div className="w-full px-4 sm:px-6">
                    <span
                        className="flex items-center gap-2 px-6 py-3 rounded-lg transition-colors w-full text-black/40"
                    >
                        <span className="text-sm sm:text-base font-medium text-ellipsis overflow-hidden whitespace-nowrap">Chat History</span>
                    </span>
                </div>
                <div className="flex-1 w-full px-4 sm:px-6 overflow-y-auto">
                    <SidebarChatHistory
                        userId={user?.userId}
                        isExpanded={isHovered || isOpen}
                    />
                </div>
                {/* Secondary Navigation */}
                <nav className="flex w-full p-4 sm:p-6 ">
                    <div className="space-y-2 sm:space-y-4 w-full">
                        <span
                            // href="/dashboard/user/profile"
                            className={getLinkStyles("/user/profile")}
                        >
                            {pfpUrl ? (
                                <Image
                                    src={pfpUrl}
                                    alt="Profile Picture"
                                    className="w-4 h-4 sm:w-5 sm:h-5 rounded-full"
                                    width={20}
                                    height={20}
                                />
                            ) : (
                                <User className="w-4 h-4 sm:w-5 sm:h-5" />
                            )}
                            <span className="text-sm sm:text-base font-medium text-ellipsis overflow-hidden whitespace-nowrap">{username !== "" ? username : "user"}</span>

                        </span>
                        <Link
                            href="https://docs.earnkit.com"
                            target="_blank"
                            className={getLinkStyles("/docs")}
                            onClick={() => isMobile && setIsOpen(false)}
                        >
                            <FileText className="w-4 h-4 sm:w-5 sm:h-5" />
                            <span className="text-sm sm:text-base font-medium">Docs</span>
                        </Link>

                        <Link
                            href="/settings"
                            className={getLinkStyles("/settings")}
                            onClick={() => isMobile && setIsOpen(false)}
                        >
                            <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
                            <span className="text-sm sm:text-base font-medium">Settings</span>
                        </Link>

                        <button
                            // onClick={() => signOut({ callbackUrl: "/signin" })}
                            className={getLinkStyles("/logout")}
                            onClick={handleLogoutClick}
                        >
                            <LogOut className="w-4 h-4 sm:w-5 sm:h-5" />
                            <span className="text-sm sm:text-base font-medium">Log out</span>
                        </button>
                    </div>
                </nav>
            </aside>
        </div>
    );
} 