import { ethers } from 'ethers';

export const verifySignature = (
  address: string,
  signature: string,
): boolean => {
  try {
    // The message that was signed
    const message = `Sign this message to verify your wallet ownership: ${address}`;

    // Recover the address from the signature
    const recoveredAddress = ethers.verifyMessage(message, signature);

    // Check if the recovered address matches the provided address
    return recoveredAddress.toLowerCase() === address.toLowerCase();
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
};
