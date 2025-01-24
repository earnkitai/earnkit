import { Request, Response } from 'express';
import AgentDetailsModel from '../../models/agent.details.model';

export const createFarcasterDetails = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const details = req.body;
    const farcasterDetails =
      await AgentDetailsModel.createFarcasterDetails(details);

    return res.status(200).json({
      success: true,
      data: farcasterDetails,
    });
  } catch (error: any) {
    console.error('Error creating farcaster details:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to create farcaster details',
    });
  }
};

export const updateFarcasterDetails = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const { agentId } = req.params;
    const details = req.body;

    const farcasterDetails = await AgentDetailsModel.updateFarcasterDetails(
      agentId,
      details,
    );

    return res.status(200).json({
      success: true,
      data: farcasterDetails,
    });
  } catch (error: any) {
    console.error('Error updating farcaster details:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to update farcaster details',
    });
  }
};

export const getFarcasterDetails = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const { agentId } = req.params;
    const farcasterDetails =
      await AgentDetailsModel.getFarcasterDetails(agentId);

    if (!farcasterDetails) {
      return res.status(404).json({
        success: false,
        error: 'Farcaster details not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: farcasterDetails,
    });
  } catch (error: any) {
    console.error('Error fetching farcaster details:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch farcaster details',
    });
  }
};

export const createOrUpdateConfig = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const { agentId } = req.params;
    const { config } = req.body;

    const agentConfig = await AgentDetailsModel.createOrUpdateConfig(
      agentId,
      config,
    );

    return res.status(200).json({
      success: true,
      data: agentConfig,
    });
  } catch (error: any) {
    console.error('Error updating agent config:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to update agent config',
    });
  }
};

export const getConfig = async (req: Request, res: Response): Promise<any> => {
  try {
    const { agentId } = req.params;
    const config = await AgentDetailsModel.getConfig(agentId);

    if (!config) {
      return res.status(404).json({
        success: false,
        error: 'Agent config not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: config,
    });
  } catch (error: any) {
    console.error('Error fetching agent config:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch agent config',
    });
  }
};
