import { TypeORMAdapter } from '@auth/typeorm-adapter';
import NextAuth from 'next-auth';
import 'next-auth/jwt';
import { Provider } from 'next-auth/providers';
import Nodemailer from 'next-auth/providers/nodemailer';
import { sendVerificationRequest } from './app/actions/signin/sendVerificationRequest';

import * as entities from './lib/entities';

const providers: Provider[] = [
  Nodemailer({
    server: process.env.EMAIL_SERVER,
    from: process.env.EMAIL_FROM,
    maxAge: 1 * 60 * 60, // 1 hour
    sendVerificationRequest: async ({ identifier, url }) => {
      await sendVerificationRequest({
        identifier,
        url,
        provider: {
          server: process.env.EMAIL_SERVER!,
          from: process.env.EMAIL_FROM!,
        },
        theme: { brandColor: '', buttonText: 'Sign in' },
      });
    },
  }),
];

export const providerMap = providers
  .map((provider) => {
    if (typeof provider === 'function') {
      const providerData = provider();
      return { id: providerData.id, name: providerData.name };
    } else {
      return { id: provider.id, name: provider.name };
    }
  })
  .filter((provider) => provider.id !== 'credentials');

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: TypeORMAdapter(process.env.DATABASE_URL!, { entities }),
  providers: providers,
  pages: {
    signIn: '/signin',
    signOut: '/signin',
    error: '/error',
    // verifyRequest: '/verify-request',
  },
  session: {
    strategy: 'database',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },

  callbacks: {
    async session({ session, user }) {
      // Ensure we're using the correct user ID from the database
      return {
        ...session,
        user: {
          id: user.id,
          email: user.email,
          name: user.name || null,
          image: user.image || null,
          emailVerified: user.emailVerified || null,
          username: user.username || null,
        },
      };
    },

    jwt({ token, trigger, session, account }) {
      if (trigger === 'update') token.name = session.user.name;
      if (account?.provider === 'keycloak') {
        return { ...token, accessToken: account.access_token };
      }
      return token;
    },
  },
  events: {
    async signIn({ user }) {
      // Log the user object during sign in to debug
      console.log('Sign in event, user:', user);
    },
    async session({ session, token }) {
      // Log the session and token during session creation
      console.log('Session event:', { session, token });
    },
  },
  // debug: true,
  secret: process.env.NEXTAUTH_SECRET || 'secret',
});

declare module 'next-auth' {
  interface Session {
    accessToken?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
  }
}

// Export a version-safe signIn function for client component
