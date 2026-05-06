import { TrendingUp, TrendingDown } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { Icons } from '../../sections/icons';
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
    const contractAddress = data.detail_platforms && Object.values(data.detail_platforms)[0]?.contract_address || "";

    return (
        <div className="space-y-2 px-2">
            <div className="flex items-center gap-2">
                <span className="font-normal">Here is the analysis of</span>
                {/* // create capsule with token image and symbol */}
                <Link href={`https://www.coingecko.com/en/coins/${contractAddress}`} target="_blank"
                    className="text-sm flex items-center gap-2 font-medium bg-transparent border-2 border-black/20 rounded-full px-1.5 py-0.5 hover:bg-black/4 transition-colors hover:border-black/40">
                    {data.image.small ? <Image src={data.image.small} alt={data.symbol} width={16} height={16} className="rounded-full" /> : <Icons.basetokenImage className="w-4 h-4" />}
                    <span className="text-gray-600">{data.symbol.toUpperCase()}</span>
                </Link>
            </div>

            <div className="flex items-center gap-2">
                <span className="font-normal">Current Price:</span>
                <span className="font-medium">{formatUSD(data.market_data.current_price.usd)}</span>
                <span className={`flex items-center gap-1 ${data.market_data.price_change_percentage_24h >= 0
                    ? 'text-green-500'
                    : 'text-red-500'
                    }`}>
                    {data.market_data.price_change_percentage_24h >= 0
                        ? <TrendingUp className="w-3 h-3" />
                        : <TrendingDown className="w-3 h-3" />}
                    {Math.abs(data.market_data.price_change_percentage_24h).toFixed(2)}%
                </span>
            </div>

            <div>
                <span className="font-normal">24h High:</span> <span className="font-medium">{formatUSD(data.market_data.high_24h.usd)}</span>
            </div>

            <div>
                <span className="font-normal">24h Low:</span> <span className="font-medium">{formatUSD(data.market_data.low_24h.usd)}</span>
            </div>

            <div>
                <span className="font-normal">Market Cap:</span> <span className="font-medium">{formatUSD(data.market_data.market_cap.usd)}</span>
            </div>

        </div >
    );
} 