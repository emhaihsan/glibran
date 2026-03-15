import { Button } from "@/components/ui/button";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function Home() {
  const session = await getServerSession(authOptions);

  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background">
      <div className="text-center space-y-6 px-4">
        <h1 className="text-5xl font-bold tracking-tight">
          <span className="text-primary">Glibran</span>
        </h1>
        <p className="text-xl text-muted-foreground max-w-lg mx-auto">
          Turn long videos into viral short-form clips with AI.
          Auto-detect highlights, crop vertically, and burn subtitles — in seconds.
        </p>
        <div className="flex gap-4 justify-center pt-4">
          <Link href="/api/auth/signin">
            <Button size="lg" className="text-base px-8">
              Get Started
            </Button>
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          5 free credits on sign-up. No credit card required.
        </p>
      </div>
    </main>
  );
}
