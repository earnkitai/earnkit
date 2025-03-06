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
    const { email } = await request.json();

    // Get the sub-organization ID for the email
    const { organizationIds } = await client.getSubOrgIds({
      organizationId: turnkeyConfig.organizationId,
      filterType: 'EMAIL',
      filterValue: email,
    });

    if (!organizationIds.length) {
      return NextResponse.json({ hasUsername: false });
    }

    // Get the user details
    const { user } = await client.getUser({
      organizationId: organizationIds[0],
      userId: organizationIds[0], // The sub-org ID is the same as the user ID
    });

    // Check if user has a username
    const hasUsername = !!user.userName;

    return NextResponse.json({ hasUsername });
  } catch (error) {
    console.error('Error checking username:', error);
    return NextResponse.json(
      { error: 'Failed to check username' },
      { status: 500 },
    );
  }
}
