import elliptic from 'elliptic';
const EC = new elliptic.ec('p256');

export function generateP256KeyPairHex() {
  try {
    // Create a new key pair
    const keyPair = EC.genKeyPair();

    // Get private key in hex format (64 characters)
    const privateKeyHex = keyPair.getPrivate('hex').padStart(64, '0');

    // Get compressed public key in hex format (66 characters, starting with 02 or 03)
    const compressedPublicKey = keyPair.getPublic(true, 'hex');

    return {
      publicKey: compressedPublicKey, // Will be 66 chars, starting with 02 or 03
      privateKey: privateKeyHex, // Will be 64 chars
    };
  } catch (error) {
    console.error('Error generating P-256 key pair:', error);
  }
}
