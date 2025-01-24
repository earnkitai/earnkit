import pool from '../config/database';

export interface IAgent {
  id: string; // UUID
  name: string;
  walletAddress: `0x${string}`;
  saltNonce: string;
  createdAt: Date;
}

export interface ISubOrg {
  id: number;
  organizationId: string;
  ownerWalletAddress: string;
  publicKey: string;
  privateKey: string;
  agents: IAgent[];
}

class WalletModel {
  // Create a new sub-organization for a user
  static async createSubOrg({
    userId,
    organizationId,
    ownerWalletAddress,
    publicKey,
    privateKey,
  }: {
    userId: number;
    organizationId: string;
    ownerWalletAddress: string;
    publicKey: string;
    privateKey: string;
  }): Promise<ISubOrg> {
    const query = `
      INSERT INTO sub_organizations 
        (user_id, organization_id, owner_wallet_address, public_key, private_key)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;

    const result = await pool.query(query, [
      userId,
      organizationId,
      ownerWalletAddress,
      publicKey,
      privateKey,
    ]);

    return {
      ...result.rows[0],
      agents: [],
    };
  }

  // Find sub-org by ID
  static async findById(subOrgId: number): Promise<ISubOrg | null> {
    const query = `
      SELECT 
        so.*,
        json_agg(
          CASE WHEN aa.id IS NOT NULL THEN
            json_build_object(
              'id', aa.id,
              'name', aa.name,
              'walletAddress', aa.wallet_address,
              'saltNonce', aa.salt_nonce,
              'createdAt', aa.created_at
            )
          ELSE NULL END
        ) FILTER (WHERE aa.id IS NOT NULL) as agents
      FROM sub_organizations so
      LEFT JOIN ai_agents aa ON aa.sub_org_id = so.id
      WHERE so.id = $1
      GROUP BY so.id
    `;

    const result = await pool.query(query, [subOrgId]);
    if (!result.rows[0]) return null;

    return {
      id: result.rows[0].id,
      organizationId: result.rows[0].organization_id,
      ownerWalletAddress: result.rows[0].owner_wallet_address,
      publicKey: result.rows[0].public_key,
      privateKey: result.rows[0].private_key,
      agents: result.rows[0].agents || [],
    };
  }

  // Find sub-org and its agents by user address
  static async findByUserAddress(userAddress: string): Promise<ISubOrg | null> {
    const query = `
      SELECT 
        so.*,
        json_agg(
          CASE WHEN aa.id IS NOT NULL THEN
            json_build_object(
              'id', aa.id,
              'name', aa.name,
              'walletAddress', aa.wallet_address,
              'saltNonce', aa.salt_nonce,
              'createdAt', aa.created_at
            )
          ELSE NULL END
        ) FILTER (WHERE aa.id IS NOT NULL) as agents
      FROM sub_organizations so
      JOIN users u ON u.id = so.user_id
      LEFT JOIN ai_agents aa ON aa.sub_org_id = so.id
      WHERE u.user_id = $1
      GROUP BY so.id
    `;

    const result = await pool.query(query, [userAddress]);
    if (!result.rows[0]) return null;

    return {
      id: result.rows[0].id,
      organizationId: result.rows[0].organization_id,
      ownerWalletAddress: result.rows[0].owner_wallet_address,
      publicKey: result.rows[0].public_key,
      privateKey: result.rows[0].private_key,
      agents: result.rows[0].agents || [],
    };
  }

  // Add a new agent
  static async addAgent(
    subOrgId: number,
    agent: { name: string; walletAddress: string; saltNonce: string },
  ): Promise<IAgent> {
    const query = `
      INSERT INTO ai_agents (sub_org_id, name, wallet_address, salt_nonce)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, wallet_address as "walletAddress", salt_nonce as "saltNonce", created_at as "createdAt"
    `;
    const values = [subOrgId, agent.name, agent.walletAddress, agent.saltNonce];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  // Find agent by name and user address
  static async findAgentByNameAndUserAddress(
    userAddress: string,
    agentName: string,
  ): Promise<IAgent | null> {
    const query = `
      SELECT 
        aa.id,
        aa.name,
        aa.wallet_address as "walletAddress",
        aa.salt_nonce as "saltNonce",
        aa.created_at as "createdAt"
      FROM ai_agents aa
      JOIN sub_organizations so ON so.id = aa.sub_org_id
      JOIN users u ON u.id = so.user_id
      WHERE u.user_id = $1 AND aa.name = $2
    `;

    const result = await pool.query(query, [userAddress, agentName]);
    return result.rows[0] || null;
  }

  // Find sub-org and its agents by platform API key
  static async findByApiKey(apiKey: string): Promise<ISubOrg | null> {
    const query = `
      SELECT 
        so.*,
        json_agg(
          CASE WHEN aa.id IS NOT NULL THEN
            json_build_object(
              'id', aa.id,
              'name', aa.name,
              'walletAddress', aa.wallet_address,
              'saltNonce', aa.salt_nonce,
              'createdAt', aa.created_at
            )
          ELSE NULL END
        ) FILTER (WHERE aa.id IS NOT NULL) as agents
      FROM sub_organizations so
      JOIN users u ON u.id = so.user_id
      JOIN platform_api_keys pak ON pak.user_id = u.id
      LEFT JOIN ai_agents aa ON aa.sub_org_id = so.id
      WHERE pak.api_key = $1 AND pak.active = true
      GROUP BY so.id
    `;

    const result = await pool.query(query, [apiKey]);
    if (!result.rows[0]) return null;

    // Transform snake_case to camelCase
    return {
      id: result.rows[0].id,
      organizationId: result.rows[0].organization_id,
      ownerWalletAddress: result.rows[0].owner_wallet_address,
      publicKey: result.rows[0].public_key,
      privateKey: result.rows[0].private_key,
      agents: result.rows[0].agents || [],
    };
  }

  // Add this method to the WalletModel class
  static async findKeysByWalletId(
    subOrgId: number,
  ): Promise<{ public_key: string; private_key: string } | null> {
    const query = `
      SELECT public_key, private_key
      FROM sub_organizations
      WHERE id = $1
    `;
    const result = await pool.query(query, [subOrgId]);
    return result.rows[0] || null;
  }
}

export default WalletModel;
