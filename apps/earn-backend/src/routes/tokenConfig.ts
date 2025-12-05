import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { tokenService } from '../services/tokenService';
import { AgentTokenConfig } from '../types';

// Use mergeParams to access parent route params (:agentId)
const router: Router = Router({ mergeParams: true });

// Default token configs to initialize agents with
const DEFAULT_TOKEN_CONFIGS: AgentTokenConfig[] = [
  { tokenAddress: 'eth', tokenSymbol: 'ETH', enabled: true, discountPercent: 0 },
  {
    tokenAddress: '0x534b7aad1cdb6f02ec48cabe428f0d9131e40b07',
    tokenSymbol: 'MINIDEV',
    enabled: true,
    discountPercent: 0,
  },
];

/**
 * GET /api/agents/:agentId/token-config
 * Get token configuration for an agent
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params as { agentId: string };
    console.log('[TokenConfig] GET request for agentId param:', agentId);

    // Try to find agent by UUID (id) first, then fall back to external agentId
    let agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true },
    });

    if (!agent) {
      // Fallback: try by external agentId (slug)
      console.log('[TokenConfig] Not found by UUID, trying external agentId...');
      agent = await prisma.agent.findUnique({
        where: { agentId },
        select: { id: true },
      });
    }

    console.log('[TokenConfig] Found agent:', agent);

    if (!agent) {
      console.log('[TokenConfig] Agent not found by either UUID or agentId');
      return res.status(404).json({
        success: false,
        message: `Agent with agentId ${agentId} not found`,
      });
    }

    // Get token configs for this agent
    const configs = await prisma.agentTokenConfig.findMany({
      where: { agentId: agent.id },
    });

    // If no configs exist, return defaults
    if (configs.length === 0) {
      return res.json({
        success: true,
        data: {
          agentId,
          configs: DEFAULT_TOKEN_CONFIGS,
          isDefault: true,
        },
      });
    }

    return res.json({
      success: true,
      data: {
        agentId,
        configs: configs.map((c) => ({
          tokenAddress: c.tokenAddress,
          tokenSymbol: c.tokenSymbol,
          enabled: c.enabled,
          discountPercent: c.discountPercent,
        })),
        isDefault: false,
      },
    });
  } catch (error: any) {
    console.error('Error getting token config:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to get token configuration',
    });
  }
});

/**
 * PUT /api/agents/:agentId/token-config
 * Update token configuration for an agent
 * Body: { configs: AgentTokenConfig[] }
 */
router.put('/', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params as { agentId: string };
    const { configs } = req.body as { configs: AgentTokenConfig[] };
    console.log('[TokenConfig] PUT request for agentId param:', agentId);

    if (!configs || !Array.isArray(configs)) {
      return res.status(400).json({
        success: false,
        message: 'configs array is required',
      });
    }

    // Try to find agent by UUID (id) first, then fall back to external agentId
    let agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true },
    });

    if (!agent) {
      // Fallback: try by external agentId (slug)
      console.log('[TokenConfig] Not found by UUID, trying external agentId...');
      agent = await prisma.agent.findUnique({
        where: { agentId },
        select: { id: true },
      });
    }

    console.log('[TokenConfig] Found agent:', agent);

    if (!agent) {
      console.log('[TokenConfig] Agent not found by either UUID or agentId');
      return res.status(404).json({
        success: false,
        message: `Agent with agentId ${agentId} not found`,
      });
    }

    // Validate tokens
    for (const config of configs) {
      if (config.tokenAddress.toLowerCase() !== 'eth') {
        // Check if token is in supported list
        if (!tokenService.isTokenSupported(config.tokenAddress)) {
          return res.status(400).json({
            success: false,
            message: `Token ${config.tokenAddress} is not supported`,
          });
        }
      }

      // Validate discount percentage
      if (config.discountPercent < 0 || config.discountPercent > 100) {
        return res.status(400).json({
          success: false,
          message: 'discountPercent must be between 0 and 100',
        });
      }
    }

    // Upsert each config
    const results = await Promise.all(
      configs.map((config) =>
        prisma.agentTokenConfig.upsert({
          where: {
            agentId_tokenAddress: {
              agentId: agent.id,
              tokenAddress: config.tokenAddress.toLowerCase(),
            },
          },
          update: {
            tokenSymbol: config.tokenSymbol,
            enabled: config.enabled,
            discountPercent: config.discountPercent,
          },
          create: {
            agentId: agent.id,
            tokenAddress: config.tokenAddress.toLowerCase(),
            tokenSymbol: config.tokenSymbol,
            enabled: config.enabled,
            discountPercent: config.discountPercent,
          },
        }),
      ),
    );

    return res.json({
      success: true,
      data: {
        agentId,
        configs: results.map((c) => ({
          tokenAddress: c.tokenAddress,
          tokenSymbol: c.tokenSymbol,
          enabled: c.enabled,
          discountPercent: c.discountPercent,
        })),
      },
    });
  } catch (error: any) {
    console.error('Error updating token config:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update token configuration',
    });
  }
});

/**
 * GET /api/agents/:agentId/token-config/available
 * Get all available tokens that can be configured
 */
router.get('/available', async (req: Request, res: Response) => {
  try {
    const supportedTokens = tokenService.getSupportedTokens();

    const availableTokens = [
      {
        tokenAddress: 'eth',
        tokenSymbol: 'ETH',
        name: 'Ethereum',
        decimals: 18,
        chainId: 8453,
        logoUrl: undefined,
      },
      ...supportedTokens.map((t) => ({
        tokenAddress: t.address,
        tokenSymbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        chainId: t.chainId,
        logoUrl: t.logoUrl,
      })),
    ];

    return res.json({
      success: true,
      data: availableTokens,
    });
  } catch (error: any) {
    console.error('Error getting available tokens:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to get available tokens',
    });
  }
});

export default router;

