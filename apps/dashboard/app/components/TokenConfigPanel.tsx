'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/app/components/ui/card';
import { Input } from '@/app/components/ui/input';
import { Button } from '@/app/components/ui/button';
import { toast } from 'sonner';

interface TokenConfig {
  tokenAddress: string;
  tokenSymbol: string;
  enabled: boolean;
  discountPercent: number;
}

interface AvailableToken {
  tokenAddress: string;
  tokenSymbol: string;
  name: string;
  decimals: number;
  chainId: number;
  logoUrl?: string;
}

interface TokenConfigPanelProps {
  agentId: string;
  userId?: string;
}

export function TokenConfigPanel({ agentId, userId }: TokenConfigPanelProps) {
  const [configs, setConfigs] = useState<TokenConfig[]>([]);
  const [availableTokens, setAvailableTokens] = useState<AvailableToken[]>([]);
  const [isDefault, setIsDefault] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Fetch token configs
  useEffect(() => {
    const fetchConfigs = async () => {
      try {
        setLoading(true);
        
        // Fetch current configs
        const configRes = await fetch(`/api/agents/${agentId}/token-config`);
        if (configRes.ok) {
          const data = await configRes.json();
          if (data.success) {
            setConfigs(data.data.configs);
            setIsDefault(data.data.isDefault);
          }
        }

        // Fetch available tokens
        const availableRes = await fetch(
          `/api/agents/${agentId}/token-config/available`
        );
        if (availableRes.ok) {
          const data = await availableRes.json();
          if (data.success) {
            setAvailableTokens(data.data);
          }
        }
      } catch (error) {
        console.error('Error fetching token configs:', error);
        toast.error('Failed to load token configuration');
      } finally {
        setLoading(false);
      }
    };

      if (agentId) {
        fetchConfigs();
      }
  }, [agentId]);

  // Initialize configs from available tokens if default
  useEffect(() => {
    if (isDefault && availableTokens.length > 0 && configs.length > 0) {
      // Merge available tokens with default configs
      const mergedConfigs = availableTokens.map((token) => {
        const existingConfig = configs.find(
          (c) => c.tokenAddress.toLowerCase() === token.tokenAddress.toLowerCase()
        );
        return existingConfig || {
          tokenAddress: token.tokenAddress,
          tokenSymbol: token.tokenSymbol,
          enabled: true,
          discountPercent: 0,
        };
      });
      setConfigs(mergedConfigs);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDefault, availableTokens.length]);

  const handleToggle = (tokenAddress: string) => {
    setConfigs((prev) =>
      prev.map((c) =>
        c.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
          ? { ...c, enabled: !c.enabled }
          : c
      )
    );
  };

  const handleDiscountChange = (tokenAddress: string, value: string) => {
    const discount = parseFloat(value) || 0;
    setConfigs((prev) =>
      prev.map((c) =>
        c.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
          ? { ...c, discountPercent: Math.min(100, Math.max(0, discount)) }
          : c
      )
    );
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const response = await fetch(`/api/agents/${agentId}/token-config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ configs, ...(userId ? { userId } : {}) }),
      });

      const data = await response.json();
      if (data.success) {
        toast.success('Token configuration saved');
        setIsDefault(false);
      } else {
        throw new Error(data.message || 'Failed to save');
      }
    } catch (error: unknown) {
      console.error('Error saving token configs:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to save token configuration';
      toast.error(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="rounded-[20px] shadow-none border border-black/10">
        <CardContent className="p-8">
          <div className="animate-pulse space-y-4">
            <div className="h-6 bg-gray-200 rounded w-1/4"></div>
            <div className="h-20 bg-gray-200 rounded"></div>
            <div className="h-20 bg-gray-200 rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-[20px] shadow-none border border-black/10">
      <CardContent className="p-8">
        {/* Header */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold font-funnel-display text-black mb-2">
            Payment Token Settings
          </h2>
          <p className="text-black/40 text-sm font-funnel-sans">
            Configure which payment methods your users can use and set discounts for specific tokens.
          </p>
        </div>

        {/* Token List */}
        <div className="space-y-4">
          {configs.map((config) => {
            const tokenInfo = availableTokens.find(
              (t) => t.tokenAddress.toLowerCase() === config.tokenAddress.toLowerCase()
            );

            return (
              <div
                key={config.tokenAddress}
                className="flex items-center justify-between p-4 bg-black/4 rounded-lg border border-black/10"
              >
                {/* Token Info */}
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                    {tokenInfo?.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={tokenInfo.logoUrl}
                        alt={config.tokenSymbol}
                        className="w-8 h-8 rounded-full"
                      />
                    ) : (
                      <span className="text-sm font-bold text-gray-600">
                        {config.tokenSymbol.slice(0, 2)}
                      </span>
                    )}
                  </div>
                  <div>
                    <div className="font-semibold text-black">{config.tokenSymbol}</div>
                    <div className="text-xs text-black/40">
                      {tokenInfo?.name || config.tokenSymbol}
                    </div>
                  </div>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-4">
                  {/* Discount Input */}
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-black/60">Discount:</label>
                    <div className="flex items-center">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={config.discountPercent}
                        onChange={(e) =>
                          handleDiscountChange(config.tokenAddress, e.target.value)
                        }
                        className="w-16 h-8 text-center text-sm"
                        disabled={!config.enabled}
                      />
                      <span className="ml-1 text-sm text-black/60">%</span>
                    </div>
                  </div>

                  {/* Enable Toggle */}
                  <button
                    onClick={() => handleToggle(config.tokenAddress)}
                    className={`relative w-12 h-6 rounded-full transition-colors ${
                      config.enabled ? 'bg-green-500' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                        config.enabled ? 'left-7' : 'left-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Info Box */}
        <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <p className="text-sm text-blue-800">
            <strong>Tip:</strong> Offering a discount on token payments (e.g., 10% off when paying
            with MINIDEV) can incentivize users to pay with your preferred token.
          </p>
        </div>

        {/* Save Button */}
        <div className="mt-6 flex justify-end">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-black text-white hover:bg-black/80 px-6 py-2 rounded-lg"
          >
            {saving ? 'Saving...' : 'Save Token Settings'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default TokenConfigPanel;

