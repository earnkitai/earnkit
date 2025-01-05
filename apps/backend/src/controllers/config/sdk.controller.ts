import { Request, Response } from 'express';
import { getApiKeyFromHeader } from '../../utils/GetHeaders';
import WalletModel from '../../models/wallet.model';
import { SDKConfig } from '../../types';

export const GetSdkConfig = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    // Get API key from request
    const apiKey = getApiKeyFromHeader(req);

    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: 'API key is required',
      });
    }

    // Find wallet and its keys
    const wallet = await WalletModel.findByApiKey(apiKey);
    if (!wallet) {
      return res.status(404).json({
        success: false,
        error: 'No wallet found for the provided API key',
      });
    }

    // Get keys from database
    const keys = await WalletModel.findKeysByWalletId(wallet.id);
    if (!keys?.public_key || !keys?.private_key) {
      return res.status(400).json({
        success: false,
        error: 'No keys found for this wallet',
      });
    }

    const config: SDKConfig = {
      turnkeyApiPrivateKey: keys.private_key,
      turnkeyApiPublicKey: keys.public_key,
      pimlicoApiKey: process.env.PIMLICO_API_KEY!,
      pimlicoUrl: process.env.PIMLICO_URL!,
    };

    res.json(config);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch configuration',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
