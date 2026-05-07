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
    const [isSupportMenuOpen, setIsSupportMenuOpen] = useState(false);
    const [username, setUsername] = useState<string>("");
    // const [pfpUrl, setPfpUrl] = useState<string>("");
    // const [userId, setUserId] = useState<string | null>(null);

    useEffect(() => {
        if (ready && authenticated && privyUser) {
            // console.log(privyUser, 'privyUser');
            const userId = privyUser?.id.split(':').pop() || privyUser?.id;
            // console.log(userId, 'userId');
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
                ? "text-black [&>svg]:text-black [&>svg>path]:opacity-100 "
                : "text-black/40 hover:text-black"
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

    const handleSupportClick = () => {
        setIsSupportMenuOpen(!isSupportMenuOpen);
    };

    // Close profile menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (!target.closest('.profile-menu')) {
                setIsProfileMenuOpen(false);
            }
            if (!target.closest('.support-menu')) {
                setIsSupportMenuOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    return (
        <div className="relative">

            {/* Main Sidebar */}

            {/* <div className="fixed top-4 left-4 bg-[#f0f0f0] rounded-lg md:hidden z-100">
                <div className="flex flex-col justify-start items-start space-y-6">
                    {isOpen ? <Icons.sidebarOpen onClick={() => toggleSidebar()} className="cursor-pointer" /> : <Icons.sidebarOpenIcon onClick={() => toggleSidebar()} className="cursor-pointer" />}
                </div>
            </div> */}

            <aside
                className={`fixed z-30 left-0 top-0 h-[100dvh] py-8 md:h-screen flex flex-col justify-start items-center transition-all duration-300 ease-in-out gap-8 px-[20px] w-[200px] sm:w-[200px] ${isMobile && !isOpen ? 'hidden' : 'block'}`}
                style={{
                    background: 'linear-gradient(0deg, rgba(0, 0, 0, 0.04), rgba(0, 0, 0, 0.04))'
                }}
            >
                <div className="flex flex-col w-full justify-between items-start space-y-6">
                    <Icons.newEarnyIconwithName />
                </div>
                {/* Main Navigation */}
                <nav className="flex w-full">
                    <div className="w-full flex flex-col gap-[24px]">
                        <Link
                            href="/home"
                            className={getLinkStyles("/home")}
                            onClick={() => {
                                if (isMobile) setIsOpen(false);
                            }}
                        >
                            <Icons.newSidebarHomeMenuIcon className="group-hover:text-black h-8 w-8 shrink-0" />
                            <span className="whitespace-nowrap">My Apps</span>
                        </Link>
                        <Link
                            href="https://docs.earnkit.com/"
                            className={getLinkStyles("/docs")}
                            onClick={() => {
                                if (isMobile) setIsOpen(false);
                            }}
                        >
                            <Icons.newSidebarBookIcon className="group-hover:text-black h-8 w-8 shrink-0" />
                            <span className="whitespace-nowrap">Docs</span>
                        </Link>



                    </div>
                </nav>
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

                        {/* Support Menu */}
                        <div className="relative support-menu">
                            <div
                                className="flex items-center gap-2 py-3 rounded-lg transition-colors w-full group font-medium font-funnel-sans cursor-pointer"
                                onClick={handleSupportClick}
                            >
                                <Icons.newSidebarQuestionIcon className="w-8 h-8 text-black/40 group-hover:text-black shrink-0" />
                                <span className="text-sm text-black/40 font-medium whitespace-nowrap overflow-hidden text-ellipsis transition-all group-hover:text-black flex-1 min-w-0">Support</span>
                                <Icons.arrowDownSidebarUserIcon className={`w-4 h-4 shrink-0 text-black/40 group-hover:text-black transition-transform ${isSupportMenuOpen ? 'rotate-180' : ''}`} />
                            </div>

                            {/* Support Submenu Options */}
                            {isSupportMenuOpen && (
                                <div className="my-2 space-y-2">
                                    <a
                                        href="https://slack.com"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center justify-center gap-1 px-4 py-1 text-sm text-black/40 w-full group font-funnel-sans hover:bg-white transition-colors cursor-pointer rounded-full border border-black/10"
                                        onClick={() => {
                                            if (isMobile) setIsOpen(false);
                                            setIsSupportMenuOpen(false);
                                        }}
                                    >
                                        <span className="text-black/40 group-hover:text-black/80">Join our</span>
                                        <div className="flex items-center gap-1">
                                            <Icons.newSidebarSlackIcon />
                                        </div>
                                    </a>
                                    <a
                                        href="#"
                                        className="flex items-center justify-center gap-1 px-4 py-1 text-sm text-black/40 w-full group font-funnel-sans hover:bg-white transition-colors cursor-pointer rounded-full border border-black/10"
                                        onClick={() => {
                                            if (isMobile) setIsOpen(false);
                                            setIsSupportMenuOpen(false);
                                        }}
                                    >
                                        <span className="text-black/40 group-hover:text-black/80">Book a 15-min call</span>
                                    </a>
                                </div>
                            )}
                        </div>
                        <div className="relative profile-menu">

                            {isProfileMenuOpen && (
                                <div className="absolute -top-40 left-0 mt-2 w-56 bg-white border border-black/10 rounded-[24px] shadow-xl py-3 z-50">
                                    <Link
                                        href="/settings"
                                        className="flex items-center gap-3 px-4 py-3 text-sm text-black/80 w-full group font-funnel-sans hover:bg-black/5 transition-colors"
                                        onClick={() => {
                                            if (isMobile) setIsOpen(false);
                                            setIsProfileMenuOpen(false);
                                        }}
                                    >
                                        <div className="w-8 h-8 bg-color2 rounded-full flex items-center justify-center group-hover:bg-color3 transition-colors">
                                            <Settings className="w-4 h-4 text-white" />
                                        </div>
                                        <span className="group-hover:text-black transition-colors font-medium">Settings</span>
                                    </Link>
                                    <button
                                        className="flex items-center gap-3 px-4 py-3 text-sm text-black/80 w-full group font-funnel-sans hover:bg-black/5 transition-colors"
                                        onClick={() => {
                                            handleLogoutClick();
                                            setIsProfileMenuOpen(false);
                                        }}
                                    >
                                        <div className="w-8 h-8 bg-color2 rounded-full flex items-center justify-center group-hover:bg-color3 transition-colors">
                                            <LogOut className="w-4 h-4 text-white" />
                                        </div>
                                        <span className="group-hover:text-black transition-colors font-medium">Log out</span>
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
                                <User className="w-8 h-8 min-w-8 min-h-8 bg-black/4 rounded-full p-2 text-black/40 group-hover:text-black group-hover:fill-black shrink-0" />
                                {/* )} */}
                                <span className="text-sm text-black/40 font-medium whitespace-nowrap overflow-hidden text-ellipsis transition-all group-hover:text-black flex-1 min-w-0">{username !== "" ? username : "user"}</span>
                                <Icons.arrowDownSidebarUserIcon className="w-4 h-4 shrink-0 text-black/40 group-hover:text-black" />
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