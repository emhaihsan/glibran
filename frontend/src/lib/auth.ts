import { PrismaAdapter } from "@auth/prisma-adapter";
import { AuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "./prisma";

export const authOptions: AuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        
        // Fetch credits from DB
        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { creditsAmount: true }
        });
        
        if (dbUser) {
          (session.user as any).creditsAmount = dbUser.creditsAmount;
        }
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
