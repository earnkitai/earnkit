import pool from "../config/database";
import crypto from "crypto";

export interface IAgent {
  name: string;
  address: string;
  saltNonce: bigint;
}

export interface IWallet {
  userId: string;
  apiKey: string;
  organizationId: string;
  signWith: string;
}

interface CreateWalletParams {
  userId: string;
  organizationId: string;
  signWith: string;
}

export const createWallet = async ({
  userId,
  organizationId,
  signWith,
}: CreateWalletParams) => {
  const query = `
    INSERT INTO wallets (user_id, organization_id, sign_with)
    VALUES ($1, $2, $3)
    RETURNING *
  `;

  const result = await pool.query(query, [userId, organizationId, signWith]);

  return result.rows[0];
};

export const findByApiKey = async (apiKey: string) => {
  const hashedKey = crypto.createHash("sha256").update(apiKey).digest("hex");

  const query = `
    SELECT w.*
    FROM wallets w
    JOIN users u ON w.user_id = u.user_id
    JOIN api_keys ak ON u.id = ak.user_id
    WHERE ak.hashed_key = $1 AND ak.active = true
  `;

  const result = await pool.query(query, [hashedKey]);
  return result.rows[0];
};

class WalletModel {
  static async createWallet({
    userId,
    organizationId,
    signWith,
  }: CreateWalletParams) {
    const query = `
      INSERT INTO wallets (user_id, organization_id, sign_with)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const result = await pool.query(query, [userId, organizationId, signWith]);
    return result.rows[0];
  }

  static async addAgent(walletId: number, agent: IAgent) {
    const query = `
      INSERT INTO agents (wallet_id, name, address, salt_nonce)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const values = [
      walletId,
      agent.name,
      agent.address,
      agent.saltNonce.toString(),
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async findAgentByNameAndApiKey(apiKey: string, agentName: string) {
    const query = `
      SELECT a.*
      FROM agents a
      JOIN wallets w ON w.id = a.wallet_id
      WHERE w.api_key = $1 AND a.name = $2
    `;
    const result = await pool.query(query, [apiKey, agentName]);
    return result.rows[0];
  }

  static async findByApiKey(apiKey: string) {
    const hashedKey = crypto.createHash("sha256").update(apiKey).digest("hex");

    const query = `
      SELECT w.*, 
        json_agg(
          CASE WHEN a.id IS NOT NULL 
          THEN json_build_object(
            'name', a.name, 
            'address', a.address,
            'saltnonce', a.salt_nonce
          )
          ELSE NULL 
          END
        ) FILTER (WHERE a.id IS NOT NULL) as agents
      FROM wallets w
      JOIN users u ON w.user_id = u.user_id
      JOIN api_keys ak ON u.id = ak.user_id
      LEFT JOIN agents a ON a.wallet_id = w.id
      WHERE ak.hashed_key = $1 AND ak.active = true
      GROUP BY w.id, w.user_id, w.organization_id, w.sign_with
    `;

    const result = await pool.query(query, [hashedKey]);
    return result.rows[0];
  }
}

export default WalletModel;
