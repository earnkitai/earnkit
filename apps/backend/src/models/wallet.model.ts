import pool from '../config/database';
import crypto from 'crypto';

export interface IAgent {
  name: string;
  address: string;
  saltNonce: bigint;
}

export interface IWallet {
  id: number;
  user_id: string;
  organization_id: string;
  sign_with: string;
  public_key?: string;
  private_key?: string;
  agents: IAgent[];
}

export interface IKey {
  id: number;
  wallet_id: number;
  public_key: string;
  private_key: string;
  created_at: Date;
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
  const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');

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
    publicKey,
    privateKey,
  }: {
    userId: string;
    organizationId: string;
    signWith: string;
    publicKey?: string;
    privateKey?: string;
  }): Promise<IWallet> {
    const query = `
      INSERT INTO wallets (user_id, organization_id, sign_with, public_key, private_key)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;

    const result = await pool.query(query, [
      userId,
      organizationId,
      signWith,
      publicKey,
      privateKey,
    ]);

    return {
      ...result.rows[0],
      agents: [],
    };
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

  static async findByApiKey(apiKey: string): Promise<IWallet | null> {
    const query = `
      SELECT w.*, 
             json_agg(
               json_build_object(
                 'id', a.id,
                 'name', a.name,
                 'address', a.address,
                 'saltNonce', a.salt_nonce
               )
             ) FILTER (WHERE a.id IS NOT NULL) as agents
      FROM wallets w
      LEFT JOIN agents a ON w.id = a.wallet_id
      JOIN users u ON w.user_id = u.user_id
      JOIN api_keys ak ON u.id = ak.user_id
      WHERE ak.hashed_key = $1 AND ak.active = true
      GROUP BY w.id, w.user_id, w.organization_id, w.sign_with
    `;

    const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');
    const result = await pool.query(query, [hashedKey]);

    return result.rows[0] || null;
  }

  static async createKeys(
    walletId: number,
    publicKey: string,
    privateKey: string,
  ): Promise<IKey> {
    const query = `
      INSERT INTO keys (wallet_id, public_key, private_key)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const result = await pool.query(query, [walletId, publicKey, privateKey]);
    return result.rows[0];
  }

  static async findKeysByWalletId(walletId: number): Promise<IKey | null> {
    const query = `
      SELECT * FROM keys WHERE wallet_id = $1
    `;
    const result = await pool.query(query, [walletId]);
    return result.rows[0] || null;
  }
}

export default WalletModel;
