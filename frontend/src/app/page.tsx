import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth/next";
import { generatePresignedUrl } from "@/lib/s3";

export default async function Home() {
  const session = await getServerSession(authOptions);
  
  // Test DB connection
  const usersCount = await prisma.user.count();
  
  // Test S3 Presigner (Dummy generation)
  let s3Test = "Failed";
  let s3ErrorDisplay = "";
  try {
    const url = await generatePresignedUrl("test-upload.mp4", "video/mp4");
    if (url.includes("x-amz-signature") || url.includes("X-Amz-Signature")) {
      s3Test = "Success";
    } else {
      s3ErrorDisplay = "URL did not contain signature";
    }
  } catch (error: any) {
    s3Test = "Error generating URL";
    s3ErrorDisplay = error?.message || String(error);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-slate-950 text-white font-sans">
      <h1 className="text-4xl font-bold mb-8 text-emerald-400">Glibran Milestone 1 Check</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl">
        {/* DB Status */}
        <div className="p-6 border border-slate-800 rounded-xl bg-slate-900 shadow-lg">
          <h2 className="text-xl font-semibold text-blue-400 mb-2">1. Neon DB (Prisma)</h2>
          <p className="text-slate-300">Connection: <span className="text-emerald-500 font-mono">OK</span></p>
          <p className="text-slate-400 text-sm mt-1">Users in DB: {usersCount}</p>
        </div>

        {/* Auth Status */}
        <div className="p-6 border border-slate-800 rounded-xl bg-slate-900 shadow-lg">
          <h2 className="text-xl font-semibold text-purple-400 mb-2">2. NextAuth (Google)</h2>
          {session ? (
            <p className="text-emerald-500 font-mono">Logged In as {session?.user?.email}</p>
          ) : (
            <p className="text-amber-500 font-mono">Not Logged In (Ready for API)</p>
          )}
        </div>

        {/* S3 Status */}
        <div className="p-6 border border-slate-800 rounded-xl bg-slate-900 shadow-lg">
          <h2 className="text-xl font-semibold text-orange-400 mb-2">3. AWS S3 SDK</h2>
          <p className="text-slate-300">Presign Test: <span className={s3Test === "Success" ? "text-emerald-500 font-mono" : "text-red-500 font-mono"}>{s3Test}</span></p>
          {s3ErrorDisplay && <p className="text-red-400 text-xs mt-1">{s3ErrorDisplay}</p>}
        </div>

        {/* UI Status */}
        <div className="p-6 border border-slate-800 rounded-xl bg-slate-900 shadow-lg">
          <h2 className="text-xl font-semibold text-pink-400 mb-2">4. Tailwind + Shadcn</h2>
          <div className="mt-4">
             <Button variant="default" className="bg-emerald-500 hover:bg-emerald-600 text-white">Shadcn Button Works!</Button>
          </div>
        </div>
      </div>
    </main>
  );
}
