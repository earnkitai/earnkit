import 'next-auth';
import { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      emailVerified?: Date | null;
      username?: string | null;
    } & DefaultSession['user'];
  }

  interface User {
    id: string;
    email: string;
    name?: string | null;
    image?: string | null;
    emailVerified?: Date | null;
    username?: string | null;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
  }
}
