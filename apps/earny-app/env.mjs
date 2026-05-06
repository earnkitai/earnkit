import { vercel } from '@t3-oss/env-core/presets';
import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  client: {
    NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
    NEXT_PUBLIC_APP_URL: z.string().optional(),
    NEXT_PUBLIC_BASE_URL: z.string().optional(),
    NEXT_PUBLIC_ORGANIZATION_ID: z.string().optional(),
    NEXT_PUBLIC_ALCHEMY_API_KEY: z.string().optional(),
    NEXT_PUBLIC_RP_ID: z.string().optional(),
  },
  server: {
    NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
    NEXT_PUBLIC_RP_ID: z.string().optional(),
    NEXT_PUBLIC_APP_URL: z.string().optional(),
    TURNKEY_API_PUBLIC_KEY: z.string().optional(),
    TURNKEY_API_PRIVATE_KEY: z.string().optional(),
    NEXT_PUBLIC_BASE_URL: z.string().optional(),
    NEXT_PUBLIC_ORGANIZATION_ID: z.string().optional(),
    NEXT_PUBLIC_ALCHEMY_API_KEY: z.string().optional(),
    COINGECKO_API_KEY: z.string().optional(),
    DATABASE_URL: z.string().optional(),
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
  },
  runtimeEnv: {
    NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL:
      process.env.NEXT_PUBLIC_VERCEL_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_RP_ID: process.env.NEXT_PUBLIC_RP_ID,
    NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL:
      process.env.NEXT_PUBLIC_VERCEL_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
    FACEBOOK_SECRET_SALT: process.env.FACEBOOK_SECRET_SALT,
    TURNKEY_API_PUBLIC_KEY: process.env.TURNKEY_API_PUBLIC_KEY,
    TURNKEY_API_PRIVATE_KEY: process.env.TURNKEY_API_PRIVATE_KEY,
    NEXT_PUBLIC_ORGANIZATION_ID: process.env.NEXT_PUBLIC_ORGANIZATION_ID,
    NEXT_PUBLIC_ALCHEMY_API_KEY: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY,
    COINGECKO_API_KEY: process.env.COINGECKO_API_KEY,
    TURNKEY_WARCHEST_API_PUBLIC_KEY:
      process.env.TURNKEY_WARCHEST_API_PUBLIC_KEY,
    TURNKEY_WARCHEST_API_PRIVATE_KEY:
      process.env.TURNKEY_WARCHEST_API_PRIVATE_KEY,
    TURNKEY_WARCHEST_ORGANIZATION_ID:
      process.env.TURNKEY_WARCHEST_ORGANIZATION_ID,
    WARCHEST_PRIVATE_KEY_ID: process.env.WARCHEST_PRIVATE_KEY_ID,
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
  },
  extends: [vercel()],
});
