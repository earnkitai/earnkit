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
// import { useState } from "react";

export default function DashboardSidebar() {
    const { user } = useUser();
    const pathname = usePathname();
    const { logout } = useAuth();
    const [isHovered, setIsHovered] = useState(false);

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

    // const { data: session } = useSession();
    // console.log(session, "dashboard sidebar");

    // useEffect(() => {
    //     if (session?.user?.username) {
    //         setUsername(session.user.username);
    //     }
    // }, [session]);

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

    const handleLogout = () => {
        logout();
    };

    return (
        <div className="relative">
            {/* PanelRight Icon Container */}
            <div
                className={`fixed left-0 top-0 h-screen w-[60px] flex items-start justify-center rounded-r-2xl transition-opacity duration-300 ${isHovered ? 'opacity-0' : 'opacity-100'
                    }`}
                onMouseEnter={() => setIsHovered(true)}
            >
                <Icons.sidebarOpen className="w-6 h-6 mt-4" />
            </div>

            {/* Main Sidebar */}
            <aside
                className={`fixed z-20 left-0 top-0 h-screen bg-[#F8F8F8] flex flex-col justify-between items-center rounded-r-2xl transition-all duration-300 ease-in-out transform shadow-2xl ${isHovered ? 'translate-x-0 w-[250px]' : '-translate-x-full w-[250px]'
                    }`}
                onMouseLeave={() => setIsHovered(false)}
            >
                {/* Main Navigation */}
                <nav className="flex-1 w-full p-6">
                    <div className="space-y-4">
                        <Link
                            href="/dashboard"
                            className={getLinkStyles("/dashboard")}
                        >
                            <Home className="w-5 h-5 min-w-5" />
                            <span className="text-md font-medium">Home</span>
                        </Link>
                        <Link
                            href="/dashboard/wallet"
                            className={getLinkStyles("/dashboard/wallet")}
                        >
                            <Wallet className="w-5 h-5" />
                            <span className="text-md font-medium">Wallet</span>
                        </Link>



                        {/* <Link
                            href="/dashboard/create-agent"
                            className={getLinkStyles("/dashboard/create-agent")}
                        >
                            <Plus className="w-5 h-5 mr-1" />
                            <span className="text-md font-medium">Create Agent</span>
                        </Link> */}
                    </div>
                </nav>

                {/* Secondary Navigation */}
                <nav className="w-full p-6">
                    <div className="space-y-4">
                        <span
                            // href="/dashboard/user/profile"
                            className={getLinkStyles("/dashboard/user/profile")}
                        >
                            {pfpUrl ? (
                                <Image
                                    src={pfpUrl}
                                    alt="Profile Picture"
                                    className="w-5 h-5 rounded-full"
                                    width={20}
                                    height={20}
                                />
                            ) : (
                                <User className="w-5 h-5" />
                            )}
                            <span className="text-md font-medium text-ellipsis overflow-hidden whitespace-nowrap">{username !== "" ? username : "user"}</span>

                        </span>
                        <Link
                            href="https://docs.earnkit.com"
                            target="_blank"
                            className={getLinkStyles("/dashboard/docs")}
                        >
                            <FileText className="w-5 h-5" />
                            <span className="text-md font-medium">Docs</span>
                        </Link>

                        <Link
                            href="/dashboard/settings"
                            className={getLinkStyles("/dashboard/settings")}
                        >
                            <Settings className="w-5 h-5" />
                            <span className="text-md font-medium">Settings</span>
                        </Link>

                        <button
                            // onClick={() => signOut({ callbackUrl: "/signin" })}
                            className={getLinkStyles("/dashboard/logout")}
                            onClick={handleLogout}
                        >
                            <LogOut className="w-5 h-5" />
                            <span className="text-md font-medium">Log out</span>
                        </button>
                    </div>
                </nav>
            </aside>
        </div>
    );
} 