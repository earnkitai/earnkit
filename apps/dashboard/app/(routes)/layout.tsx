import { ReactNode } from 'react';
import Sidebar from '@/app/components/dashboard/Sidebar';
import { Toaster } from '@/app/components/ui/sonner';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex font-funnel-sans">
      <Sidebar />
      {/* Main Content */}
      <div className="flex-1 overflow-x-hidden ">
        <div className="pb-[20px]">{children}</div>
      </div>
      <Toaster />
    </div>
  );
}
