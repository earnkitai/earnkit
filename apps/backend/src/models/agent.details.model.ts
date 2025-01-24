import pool from '../config/database';

export interface AgentFarcasterDetails {
  agent_id: string;
  signer_uuid: string;
  fid: number;
  public_key: string;
  pfp_url?: string;
}

export interface AgentConfig {
  agent_id: string;
  config: Record<string, any>;
}

class AgentDetailsModel {
  // Farcaster Details Methods
  static async createFarcasterDetails(details: AgentFarcasterDetails) {
    const query = `
      INSERT INTO agent_farcaster_details (agent_id, signer_uuid, fid, public_key, pfp_url)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const values = [
      details.agent_id,
      details.signer_uuid,
      details.fid,
      details.public_key,
      details.pfp_url,
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async updateFarcasterDetails(
    agentId: string,
    details: Partial<AgentFarcasterDetails>,
  ) {
    const query = `
      UPDATE agent_farcaster_details
      SET signer_uuid = COALESCE($2, signer_uuid),
          fid = COALESCE($3, fid),
          public_key = COALESCE($4, public_key),
          pfp_url = COALESCE($5, pfp_url),
          updated_at = CURRENT_TIMESTAMP
      WHERE agent_id = $1
      RETURNING *
    `;
    const values = [
      agentId,
      details.signer_uuid,
      details.fid,
      details.public_key,
      details.pfp_url,
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async getFarcasterDetails(agentId: string) {
    const query = `
      SELECT * FROM agent_farcaster_details
      WHERE agent_id = $1
    `;
    const result = await pool.query(query, [agentId]);
    return result.rows[0];
  }

  // Agent Config Methods
  static async createOrUpdateConfig(
    agentId: string,
    config: Record<string, any>,
  ) {
    const query = `
      INSERT INTO agent_config (agent_id, config)
      VALUES ($1, $2)
      ON CONFLICT (agent_id)
      DO UPDATE SET config = $2, updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    const result = await pool.query(query, [agentId, config]);
    return result.rows[0];
  }

  static async getConfig(agentId: string) {
    const query = `
      SELECT * FROM agent_config
      WHERE agent_id = $1
    `;
    const result = await pool.query(query, [agentId]);
    return result.rows[0];
  }
}

export default AgentDetailsModel;
