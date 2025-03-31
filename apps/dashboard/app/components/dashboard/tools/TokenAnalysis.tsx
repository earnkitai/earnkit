import Image from 'next/image';
// import Link from 'next/link';
import { Icons } from '@/app/components/sections/icons';
import { TrendingUp, TrendingDown } from 'lucide-react';

export interface TokenAnalysisResponse {
    symbol: string;
    name: string;
    detail_platforms: {
        [key: string]: {
            decimal_place: number | null;
            contract_address: string;
        };
    };
    categories: string[];
    description: {
        en: string;
    };
    image: {
        small: string;
    };
    market_data: {
        current_price: {
            eth: number;
            usd: number;
        };
        ath: {
            eth: number;
            usd: number;
        };
        atl: {
            eth: number;
            usd: number;
        };
        market_cap: {
            eth: number;
            usd: number;
        };
        fully_diluted_valuation: {
            eth: number;
            usd: number;
        };
        total_volume: {
            eth: number;
            usd: number;
        };
        high_24h: {
            eth: number;
            usd: number;
        };
        low_24h: {
            eth: number;
            usd: number;
        };
        price_change_percentage_24h: number;
    };
}

interface TokenAnalysisProps {
    data: TokenAnalysisResponse;
}

export default function TokenAnalysis({ data }: TokenAnalysisProps) {
    const formatUSD = (value: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 6,
        }).format(value);
    };

    const formatETH = (value: number) => {
        // Convert scientific notation to decimal with leading zeros
        if (value < 1) {
            // Convert to string to handle scientific notation
            const str = value.toString();
            if (str.includes('e-')) {
                // Handle scientific notation
                const [base, exponent] = str.split('e-');
                const decimalPlaces = parseInt(exponent);
                const baseNum = parseFloat(base);
                const significantDigits = Math.abs(baseNum).toString().replace('.', '');
                return (
                    <span className="mr-1">
                        0.0
                        <sub className="text-xs">{decimalPlaces - 1}</sub>
                        {significantDigits}
                    </span>
                );
            }
            // For small numbers not in scientific notation, count leading zeros
            const decimalStr = value.toFixed(20);
            const [, decimals] = decimalStr.split('.');
            let leadingZeros = 0;
            for (const char of decimals) {
                if (char === '0') leadingZeros++;
                else break;
            }
            if (leadingZeros > 1) {
                return (
                    <span>
                        0.0
                        <sub className="text-xs">{leadingZeros}</sub>
                        {decimals.slice(leadingZeros)}
                    </span>
                );
            }
            return value.toFixed(8);
        }
        // For numbers >= 1
        return value.toFixed(4);
    };

    // const formatLargeNumber = (value: number) => {
    //     if (value >= 1e9) {
    //         return `${(value / 1e9).toFixed(2)}B`;
    //     } else if (value >= 1e6) {
    //         return `${(value / 1e6).toFixed(2)}M`;
    //     }
    //     return value.toLocaleString();
    // };

    return (
        <div className="max-w-[80%] w-full bg-white rounded-lg shadow-sm border border-black/10 p-6 font-funnel-sans">
            {/* Token Header */}
            <div className="flex items-center gap-4 mb-6">
                {data.image?.small ? (
                    <Image
                        src={data.image.small}
                        alt={data.name}
                        width={48}
                        height={48}
                        className="rounded-full"
                    />
                ) : (
                    <Icons.ethereum className="w-12 h-12 rounded-full" />
                )}
                <div>
                    <h2 className="text-2xl font-bold">{data.name}</h2>
                    <div className="flex items-center gap-2">
                        <span className="text-gray-600 font-medium">{data.symbol.toUpperCase()}</span>
                        {data.detail_platforms && Object.values(data.detail_platforms)[0]?.contract_address && (
                            <span className="text-xs text-gray-500 font-mono">
                                {Object.values(data.detail_platforms)[0].contract_address}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Price Information */}
            <div className="mb-6">
                <div className="flex items-baseline gap-3">
                    <span className="text-3xl font-bold">
                        {formatUSD(data.market_data.current_price.usd)}
                    </span>
                    <span className={`flex items-center gap-1 text-sm font-medium ${data.market_data.price_change_percentage_24h >= 0
                        ? 'text-green-500'
                        : 'text-red-500'
                        }`}>
                        {data.market_data.price_change_percentage_24h >= 0
                            ? <TrendingUp className="w-4 h-4" />
                            : <TrendingDown className="w-4 h-4" />}
                        {Math.abs(data.market_data.price_change_percentage_24h).toFixed(2)}%
                    </span>
                </div>
                <span className="text-sm text-gray-500 flex items-baseline">
                    {formatETH(data.market_data.current_price.eth)} ETH
                </span>
            </div>

            {/* Market Metrics Grid */}
            <div className="grid grid-cols-2 gap-6 mb-6">
                <div className="space-y-4">
                    <div className="p-4 bg-gray-50 rounded-lg">
                        <span className="text-sm text-gray-600">Market Cap</span>
                        <div className="font-bold">{formatUSD(data.market_data.market_cap.usd)}</div>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-lg">
                        <span className="text-sm text-gray-600">24h High</span>
                        <div className="font-bold">{formatUSD(data.market_data.high_24h.usd)}</div>
                    </div>
                </div>
                <div className="space-y-4">
                    <div className="p-4 bg-gray-50 rounded-lg">
                        <span className="text-sm text-gray-600">24h Volume</span>
                        <div className="font-bold">{formatUSD(data.market_data.total_volume.usd)}</div>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-lg">
                        <span className="text-sm text-gray-600">24h Low</span>
                        <div className="font-bold">{formatUSD(data.market_data.low_24h.usd)}</div>
                    </div>
                </div>
            </div>

            {/* Categories */}
            {data.categories && data.categories.length > 0 && (
                <div className="mb-6">
                    <h3 className="text-sm font-medium text-gray-600 mb-2">Categories</h3>
                    <div className="flex flex-wrap gap-2">
                        {data.categories.slice(0, 5).map((category, i) => (
                            <span
                                key={i}
                                className="px-3 py-1 bg-gray-100 rounded-full text-xs font-medium text-gray-700"
                            >
                                {category}
                            </span>
                        ))}
                        {data.categories.length > 5 && (
                            <span className="px-3 py-1 bg-gray-100 rounded-full text-xs font-medium text-gray-700">
                                +{data.categories.length - 5} more
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* Description */}
            {data.description?.en && (
                <div className="mb-6">
                    <h3 className="text-sm font-medium text-gray-600 mb-2">About</h3>
                    <p className="text-sm text-gray-700 line-clamp-3">
                        {data.description.en}
                    </p>
                </div>
            )}

            {/* Action Buttons */}
            {/* <div className="flex gap-3">
                <button className="flex-1 px-4 py-2 bg-black text-white rounded-lg font-semibold hover:bg-black/90 transition-colors">
                    Trade {data.symbol.toUpperCase()}
                </button>
                <Link
                    href={`https://www.coingecko.com/en/coins/${data.symbol.toLowerCase()}`}
                    target="_blank"
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold hover:bg-gray-200 transition-colors flex items-center gap-2"
                >
                    View More <ExternalLink className="w-4 h-4" />
                </Link>
            </div> */}
        </div>
    );
} 