import pool from '../config/database';

export interface AgentFarcasterDetails {
  agent_id: string;
  signer_uuid: string;
  fid: number;
  public_key: string;
  user_name: string;
  display_name: string;
  custody_address: string;
  verified_addresses: string[];
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
      INSERT INTO agent_farcaster_details (
        agent_id, 
        signer_uuid, 
        fid, 
        public_key, 
        user_name,
        display_name,
        custody_address,
        verified_addresses,
        pfp_url
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;
    const values = [
      details.agent_id,
      details.signer_uuid,
      details.fid,
      details.public_key,
      details.user_name,
      details.display_name,
      details.custody_address,
      details.verified_addresses,
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
          user_name = COALESCE($5, user_name),
          display_name = COALESCE($6, display_name),
          custody_address = COALESCE($7, custody_address),
          verified_addresses = COALESCE($8, verified_addresses),
          pfp_url = COALESCE($9, pfp_url),
          updated_at = CURRENT_TIMESTAMP
      WHERE agent_id = $1
      RETURNING *
    `;
    const values = [
      agentId,
      details.signer_uuid,
      details.fid,
      details.public_key,
      details.user_name,
      details.display_name,
      details.custody_address,
      details.verified_addresses,
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
