import { Request, Response } from 'express';
import LogsModel from '../../../models/logs.model';

export const createInteractionLog = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const logData = req.body;
    const log = await LogsModel.createInteractionLog(logData);

    // Return formatted response with all fields needed for createAgentResponse
    return res.status(200).json({
      success: true,
      data: {
        log,
        responseTemplate: {
          log_id: log.log_id,
          agent_id: log.agent_id,
          // Optional fields that will need to be filled
          response_content: null,
          model_version: null,
          response_time: null,
        },
      },
    });
  } catch (error: any) {
    console.error('Error creating interaction log:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to create interaction log',
    });
  }
};

export const createAgentResponse = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const responseData = req.body;
    const response = await LogsModel.createAgentResponse(responseData);

    return res.status(200).json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    console.error('Error creating agent response:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to create agent response',
    });
  }
};

export const getAgentLogs = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const { agentId } = req.params;
    const logs = await LogsModel.getAgentLogs(agentId);

    return res.status(200).json({
      success: true,
      data: logs,
    });
  } catch (error: any) {
    console.error('Error fetching agent logs:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch agent logs',
    });
  }
};

export const getAgentResponses = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const { agentId } = req.params;
    const responses = await LogsModel.getAgentResponses(agentId);

    return res.status(200).json({
      success: true,
      data: responses,
    });
  } catch (error: any) {
    console.error('Error fetching agent responses:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch agent responses',
    });
  }
};

export const getAgentInteractionsWithResponses = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const { agentId } = req.params;
    const interactions =
      await LogsModel.getAgentInteractionsWithResponses(agentId);

    return res.status(200).json({
      success: true,
      data: interactions,
    });
  } catch (error: any) {
    console.error('Error fetching agent interactions:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch agent interactions',
    });
  }
};
