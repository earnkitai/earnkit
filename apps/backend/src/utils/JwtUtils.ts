import jwt from 'jsonwebtoken';
import { verifySignature } from './SignatureUtils';

const JWT_SECRET = process.env.JWT_SECRET!;

interface JwtPayload {
  address: string;
  signature: string;
}

export const generateToken = (address: string, signature: string): string => {
  return jwt.sign({ address, signature }, JWT_SECRET, { expiresIn: '24h' });
};

export const verifyToken = async (
  token: string,
): Promise<{ address: string } | null> => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    const isValidSignature = verifySignature(
      decoded.address,
      decoded.signature,
    );

    if (!isValidSignature) {
      return null;
    }

    return { address: decoded.address };
  } catch (error) {
    return null;
  }
};
