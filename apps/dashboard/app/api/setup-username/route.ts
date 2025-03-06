import { NextResponse } from 'next/server';
import { ApiKeyStamper, TurnkeyServerClient } from '@turnkey/sdk-server';
import { env } from '@/env.mjs';
import { turnkeyConfig } from '@/config/turnkey';

const { TURNKEY_API_PUBLIC_KEY, TURNKEY_API_PRIVATE_KEY } = env;

const stamper = new ApiKeyStamper({
  apiPublicKey: TURNKEY_API_PUBLIC_KEY,
  apiPrivateKey: TURNKEY_API_PRIVATE_KEY,
});

const client = new TurnkeyServerClient({
  apiBaseUrl: turnkeyConfig.apiBaseUrl,
  organizationId: turnkeyConfig.organizationId,
  stamper,
});

export async function POST(request: Request) {
  try {
    const { username } = await request.json();

    // Get the current user's sub-organization ID
    const { organizationIds } = await client.getSubOrgIds({
      organizationId: turnkeyConfig.organizationId,
      filterType: 'USERNAME',
      filterValue: username,
    });

    if (organizationIds.length > 0) {
      return NextResponse.json(
        { error: 'Username is already taken' },
        { status: 400 },
      );
    }

    // Update the user's username
    await client.updateUser({
      organizationId: turnkeyConfig.organizationId,
      userId: organizationIds[0], // The sub-org ID is the same as the user ID
      userName: username,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error setting username:', error);
    return NextResponse.json(
      { error: 'Failed to set username' },
      { status: 500 },
    );
  }
}
