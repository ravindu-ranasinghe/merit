import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";

declare module "next-auth" {
  interface Session {
    user: { id: string; login: string; name?: string | null; image?: string | null };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    githubId?: string;
    login?: string;
    /** Kept in the encrypted session cookie, server-side only. Never sent to the browser. */
    accessToken?: string;
  }
}

/** Server-side only. GITHUB_ID, GITHUB_SECRET and NEXTAUTH_SECRET are never NEXT_PUBLIC_. */
export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_ID ?? "",
      clientSecret: process.env.GITHUB_SECRET ?? "",
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account?.access_token) token.accessToken = account.access_token;
      if (profile) {
        const p = profile as { id?: number | string; login?: string };
        // The immutable numeric GitHub user ID. Identity is never compared by login.
        if (p.id !== undefined) token.githubId = String(p.id);
        if (p.login) token.login = p.login;
      }
      return token;
    },
    async session({ session, token }) {
      session.user = {
        id: token.githubId ?? "",
        login: token.login ?? "",
        name: session.user?.name,
        image: session.user?.image,
      };
      return session;
    },
  },
};
