import { TypeORMAdapter } from '@auth/typeorm-adapter';
import NextAuth from 'next-auth';
import { Provider } from 'next-auth/providers';
import Nodemailer from 'next-auth/providers/nodemailer';

const providers: Provider[] = [
  Nodemailer({
    server: process.env.EMAIL_SERVER,
    from: process.env.EMAIL_FROM,
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
  adapter: TypeORMAdapter(process.env.DATABASE_URL!),
  providers: providers,
  pages: {
    signIn: '/signin',
    signOut: '/',
    verifyRequest: '/verify-request',
  },
  session: {
    strategy: 'database',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  callbacks: {
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub || '';
      }
      return session;
    },
  },
  debug: true,
  secret: process.env.NEXTAUTH_SECRET || 'secret',
});

// Export a version-safe signIn function for client component
