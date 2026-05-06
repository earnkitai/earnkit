import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Icons } from '@/app/components/sections/icons';

interface TokenDisplayProps {
    marketCap: number;
    volume24h: number;
    holders: number;
    platform: 'ZORA' | 'CLANKER';
    tokenName: string;
}

// const formatNumber = (num: number) => {
//     if (num >= 1000000) {
//         return `$${(num / 1000000).toFixed(2)}M`;
//     } else if (num >= 1000) {
//         return `$${(num / 1000).toFixed(2)}K`;
//     }
//     return `$${num.toFixed(2)}`;
// };

const CountUpAnimation = ({ value, duration = 1 }: { value: number; duration?: number }) => {
    const [displayValue, setDisplayValue] = useState(0);

    useEffect(() => {
        let startTime: number;
        let animationFrame: number;

        const animate = (timestamp: number) => {
            if (!startTime) startTime = timestamp;
            const progress = Math.min((timestamp - startTime) / (duration * 1000), 1);

            setDisplayValue(Math.floor(progress * value));

            if (progress < 1) {
                animationFrame = requestAnimationFrame(animate);
            }
        };

        animationFrame = requestAnimationFrame(animate);

        return () => {
            if (animationFrame) {
                cancelAnimationFrame(animationFrame);
            }
        };
    }, [value, duration]);

    return <span>${(displayValue).toLocaleString()}</span>;
};

export function TokenDisplay({ marketCap, volume24h, holders, platform, tokenName }: TokenDisplayProps) {
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm max-w-max items-center"
        >
            <p className="text-white/40 font-funnel-sans font-semibold whitespace-nowrap">Market Cap</p>
            <p className="text-secondary-green font-semibold text-left">
                <CountUpAnimation value={marketCap} />
            </p>

            <p className="text-white/40 font-funnel-sans font-semibold whitespace-nowrap">24h Volume</p>
            <p className="text-secondary-green font-semibold text-left">
                <CountUpAnimation value={volume24h} />
            </p>

            <p className="text-white/40 font-funnel-sans font-semibold whitespace-nowrap">Holders</p>
            <p className="font-semibold text-left">{holders.toLocaleString()}</p>

            <p className="text-white/40 font-funnel-sans font-semibold whitespace-nowrap">Token Name</p>
            <p className="font-semibold text-left">{tokenName}</p>

            <p className="text-white/40 font-funnel-sans font-semibold whitespace-nowrap">Platform</p>

            <div className="flex justify-start items-center gap-2">
                {platform === 'ZORA' ? (
                    <Icons.zoraSmallIcon className='w-4 h-4' />
                ) : (
                    <Icons.clankerIcon className='w-4 h-4' />
                )}
                <span>{platform}</span>
            </div>
        </motion.div>
    );
} 