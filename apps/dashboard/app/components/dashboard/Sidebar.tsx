'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { User, Settings, LogOut, House, PanelLeft, Wallet, Power } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { findUserById } from '@/actions/user';
import { Icons } from '../sections/icons';
import { usePrivy, useConnectWallet, useWallets } from '@privy-io/react-auth';
import { toast } from 'sonner';

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { ready, authenticated, user: privyUser, logout } = usePrivy();
  const { connectWallet } = useConnectWallet();
  const { wallets } = useWallets();

  // We only care about the injected (browser-extension) wallet — that's the
  // one used to sign buyback actions in CreateSection. Privy can also surface
  // embedded/social wallets, but those don't need a "connect" affordance.
  const injectedWallet = wallets.find((w) => w.connectorType === 'injected');
  const walletAddress = injectedWallet?.address ?? null;
  const truncatedWallet = walletAddress
    ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`
    : null;

  const handleConnectWallet = () => connectWallet();
  const handleDisconnectWallet = async () => {
    // Privy v2 declares disconnect() on ConnectedWallet but explicitly no-ops
    // for MetaMask/Phantom (see node_modules/@privy-io/react-auth dts:750).
    // We try both: unlink() removes the wallet from the Privy user record
    // (only if linked), disconnect() severs the connector session where the
    // wallet supports it. For MM, neither truly disconnects — the wallet
    // extension owns that state. Surface that honestly to the user.
    let acted = false;
    try {
      if (injectedWallet?.linked) {
        await injectedWallet.unlink();
        acted = true;
      }
    } catch {
      /* ignore */
    }
    try {
      injectedWallet?.disconnect();
    } catch {
      /* ignore */
    }
    if (acted) {
      toast.success('Wallet unlinked from your account');
    } else {
      toast.message(
        'Your wallet extension controls connection. Disconnect this site from your wallet (MetaMask → Connected sites) to fully sever.',
      );
    }
  };

  const [isHovered, setIsHovered] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [username, setUsername] = useState<string>('');

  const fetchUsername = useCallback(async (userId: string) => {
    const result = await findUserById(userId);
    if (result?.username) {
      setUsername(result.username);
    }
  }, []);

  useEffect(() => {
    if (ready && authenticated && privyUser?.id) {
      const userId = privyUser.id.split(':').pop() || privyUser.id;
      fetchUsername(userId);
    }
  }, [ready, authenticated, privyUser?.id, fetchUsername]);

  useEffect(() => {
    const checkIfMobile = () => {
      const mobileValue = window.innerWidth < 768;
      setIsMobile((prev) => (prev !== mobileValue ? mobileValue : prev));
    };

    checkIfMobile();
    window.addEventListener('resize', checkIfMobile);
    return () => window.removeEventListener('resize', checkIfMobile);
  }, []);

  const handleLogoutClick = () => {
    logout().then(() => {
      router.push('/');
      setIsOpen(false);
    });
  };

  const getLinkStyles = (path: string) => {
    const active = pathname.includes(path);
    return `flex items-center gap-3 ${isOpen ? 'px-0' : 'px-3'} py-2 rounded-lg transition-all duration-200 w-full group font-medium font-funnel-sans
            ${active ? 'text-black' : 'text-gray-400 hover:text-black hover:bg-black/5'}`;
  };

  return (
    <>
      {/* Mobile Floating Toggle Button */}
      {isMobile && !isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed top-4 left-4 z-[60] p-2 bg-white border border-black/10 rounded-lg shadow-sm active:scale-95 transition-transform"
        >
          <PanelLeft className="w-6 h-6 text-black/60" />
        </button>
      )}

      {/* Background Overlay for Mobile Expansion */}
      {isMobile && isOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-[40] backdrop-blur-[2px] transition-opacity duration-300"
          onClick={() => setIsOpen(false)}
        />
      )}

      <aside
        onMouseEnter={() => !isMobile && setIsHovered(true)}
        onMouseLeave={() => {
          setIsHovered(false);
          setIsProfileMenuOpen(false);
        }}
        className={`fixed z-[50] left-0 top-0 h-screen flex flex-col transition-all duration-300 ease-in-out border-r border-black/5 bg-white
          ${
            isMobile
              ? isOpen
                ? 'translate-x-0 w-[280px]'
                : '-translate-x-full w-[280px]'
              : isOpen
                ? 'w-[260px]'
                : 'w-[68px]'
          }`}
      >
        {/* Header Section */}
        <div className="p-4 flex items-center justify-between h-[72px]">
          <div className="flex items-center gap-2 overflow-hidden shrink-0">
            {!isOpen ? (
              <button
                onClick={() => setIsOpen(true)}
                className="p-1 rounded-md ml-1 transition-colors"
              >
                {!isMobile && isHovered ? (
                  <PanelLeft className="w-6 h-6 text-black/60" />
                ) : (
                  <img
                    src="images/landing/earnkit_logo_mobile.png"
                    className="h-6 w-6 min-w-[24px] brightness-0 invert-0"
                    alt="Logo"
                  />
                )}
              </button>
            ) : (
              <Icons.newEarnyIconwithName />
            )}
          </div>

          {isOpen && (
            <button
              onClick={() => setIsOpen(false)}
              className="text-black/60 hover:text-black p-1 hover:bg-black/5 rounded-md transition-colors"
            >
              <PanelLeft className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 px-3 py-4 space-y-2 overflow-y-auto overflow-x-hidden">
          {[
            {
              href: '/home',
              label: 'Home',
              icon: <House className="h-5 w-5 mr-0.5 shrink-0" />,
            },
            {
              href: '/discover',
              label: 'Discover',
              icon: (
                <Icons.newSidebarHomeMenuIcon className="h-7 w-7 shrink-0 !text-gray-400 group-hover:!text-black -ml-1" />
              ),
            },
            {
              href: 'https://docs.earnkit.com/',
              label: 'Docs',
              icon: (
                <Icons.newSidebarBookIcon className="h-7 w-7 shrink-0 !text-gray-600 group-hover:!text-black -ml-1" />
              ),
              external: true,
            },
          ].map((item) => (
            <Link
              key={item.label}
              href={item.href}
              target={item.external ? '_blank' : undefined}
              className={getLinkStyles(item.href)}
              onClick={() => isMobile && setIsOpen(false)}
            >
              <div className="w-6 flex justify-center shrink-0">
                {item.icon}
              </div>
              <span
                className={`whitespace-nowrap transition-all duration-300 
                ${isOpen ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4 pointer-events-none'}`}
              >
                {item.label}
              </span>
            </Link>
          ))}
        </nav>

        {/* Profile Section */}
        <div className="p-3 relative">
          {/* Wallet row — only when sidebar is open. Collapsed state shows a
              status dot on the avatar instead. */}
          {isOpen && ready && authenticated && (
            <div className="mb-2">
              {walletAddress ? (
                <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-black/[0.03] border border-black/5 rounded-lg">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    <span className="text-xs font-mono text-black/70 truncate">
                      {truncatedWallet}
                    </span>
                  </div>
                  <button
                    onClick={handleDisconnectWallet}
                    title="Disconnect wallet"
                    className="text-black/30 hover:text-black/70 transition-colors shrink-0"
                  >
                    <Power className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleConnectWallet}
                  className="w-full px-3 py-2 text-xs font-semibold text-white bg-black rounded-lg hover:bg-black/80 transition-colors flex items-center justify-center gap-2 font-funnel-sans"
                >
                  <Wallet className="w-3.5 h-3.5" />
                  Connect Wallet
                </button>
              )}
            </div>
          )}

          {isProfileMenuOpen && (
            <div
              className={`absolute bg-white border border-black/10 rounded-2xl shadow-xl py-2 z-[60] transition-all duration-200 animate-in fade-in slide-in-from-bottom-2
                ${
                  isOpen
                    ? 'bottom-[calc(100%+8px)] left-3 right-3 w-auto'
                    : 'bottom-4 left-[72px] w-[220px]'
                }`}
            >
              {!isOpen && (
                <div className="px-4 py-1 border-b border-black/5 mb-1">
                  <p className="text-[10px] font-bold text-black/30 uppercase tracking-widest">
                    Account
                  </p>
                  <p className="text-sm font-semibold text-black truncate">
                    {username || 'User'}
                  </p>
                </div>
              )}
              <Link
                href="/settings"
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-black/70 hover:text-black hover:bg-black/5 transition-colors font-funnel-sans"
              >
                <Settings className="w-4 h-4" />
                <span>Settings</span>
              </Link>
              <button
                onClick={handleLogoutClick}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-black/70 hover:text-red-600 hover:bg-red-50 w-full transition-colors font-funnel-sans text-left"
              >
                <LogOut className="w-4 h-4" />
                <span>Log out</span>
              </button>
            </div>
          )}

          <div
            className={`flex items-center gap-3 p-2 rounded-xl transition-all cursor-pointer group
              ${!isOpen ? 'justify-center' : ''}`}
            onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
          >
            <div className="relative w-8 h-8 rounded-full bg-black/5 flex items-center justify-center shrink-0 border border-black/5 group-hover:border-black/10">
              <User className="w-4 h-4 text-black/40 group-hover:text-black transition-colors" />
              {walletAddress && (
                <span
                  title="Wallet connected"
                  className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white"
                />
              )}
            </div>

            {isOpen && (
              <>
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="text-sm text-black truncate leading-tight font-medium">
                    {username || 'User'}
                  </span>
                </div>
                <Icons.arrowDownSidebarUserIcon
                  className={`w-4 h-4 shrink-0 text-black/30 transition-transform duration-200 ${isProfileMenuOpen ? 'rotate-180' : ''}`}
                />
              </>
            )}
          </div>
        </div>
      </aside>

      <div
        className={`transition-all duration-300 ease-in-out shrink-0 
        ${isMobile ? 'w-0' : isOpen ? 'w-[260px]' : 'w-[68px]'}`}
      />
    </>
  );
}
