import 'next-auth';
import { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: User & DefaultSession['user'];
  }

  interface User {
    id: string;
    email?: string | null;
    username?: string | null;
    hasAcceptedTerms: boolean;
    isGuest: boolean;
    mfaMethods: string[];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
  }
}
