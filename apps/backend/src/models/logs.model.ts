import pool from '../config/database';

export interface InteractionLog {
  log_id: string;
  agent_id: string;
  sender_address: string;
  content: string;
  timestamp: Date;
  metadata?: any;
  sender: 'user' | 'agent' | 'farcaster';
}

export interface AgentResponse {
  response_id: string;
  log_id: string;
  agent_id: string;
  response_content: string;
  model_version?: string;
  response_time?: number;
  timestamp: Date;
}

class LogsModel {
  static async createInteractionLog(
    log: Omit<InteractionLog, 'log_id' | 'timestamp'>,
  ): Promise<InteractionLog> {
    const query = `
      INSERT INTO interaction_logs (agent_id, sender_address, content, metadata, sender)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const values = [
      log.agent_id,
      log.sender_address,
      log.content,
      log.metadata,
      log.sender,
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async createAgentResponse(
    response: Omit<AgentResponse, 'response_id' | 'timestamp'>,
  ): Promise<AgentResponse> {
    const query = `
      INSERT INTO agent_responses (log_id, agent_id, response_content, model_version, response_time)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const values = [
      response.log_id,
      response.agent_id,
      response.response_content,
      response.model_version,
      response.response_time,
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async getAgentLogs(agentId: string): Promise<InteractionLog[]> {
    const query = `
      SELECT * FROM interaction_logs
      WHERE agent_id = $1
      ORDER BY timestamp DESC
    `;
    const result = await pool.query(query, [agentId]);
    return result.rows;
  }

  static async getAgentResponses(agentId: string): Promise<AgentResponse[]> {
    const query = `
      SELECT * FROM agent_responses
      WHERE agent_id = $1
      ORDER BY timestamp DESC
    `;
    const result = await pool.query(query, [agentId]);
    return result.rows;
  }

  static async getAgentInteractionsWithResponses(agentId: string): Promise<{
    logs: InteractionLog[];
    responses: Record<string, AgentResponse>;
  }> {
    const logsQuery = `
      SELECT * FROM interaction_logs
      WHERE agent_id = $1
      ORDER BY timestamp DESC
    `;
    const responsesQuery = `
      SELECT * FROM agent_responses
      WHERE agent_id = $1
      ORDER BY timestamp DESC
    `;

    const [logsResult, responsesResult] = await Promise.all([
      pool.query(logsQuery, [agentId]),
      pool.query(responsesQuery, [agentId]),
    ]);

    // Create a map of responses by log_id for easy lookup
    const responsesByLogId = responsesResult.rows.reduce(
      (acc, response) => {
        acc[response.log_id] = response;
        return acc;
      },
      {} as Record<string, AgentResponse>,
    );

    return {
      logs: logsResult.rows,
      responses: responsesByLogId,
    };
  }
}

export default LogsModel;
