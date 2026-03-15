import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { UploadForm } from "@/components/dashboard/upload-form";
import { JobList } from "@/components/dashboard/job-list";
import { TopUpCard } from "@/components/dashboard/topup-card";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { creditsAmount: true },
  });

  const jobs = await prisma.job.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const serializedJobs = jobs.map((job) => ({
    id: job.id,
    type: job.type,
    status: job.status,
    inputUrl: job.inputUrl,
    resultUrl: job.resultUrl,
    cost: job.cost,
    createdAt: job.createdAt.toISOString(),
  }));

  const credits = user?.creditsAmount ?? 0;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Upload a video and let AI find the best moments.
        </p>
      </div>

      {credits >= 2 ? (
        <UploadForm />
      ) : (
        <div className="border border-destructive/50 rounded-lg p-6 text-center space-y-2">
          <p className="font-medium text-destructive">
            You need at least 2 credits to generate clips.
          </p>
          <p className="text-sm text-muted-foreground">
            Purchase a credit pack below to continue.
          </p>
        </div>
      )}

      <TopUpCard currentCredits={credits} />

      <JobList jobs={serializedJobs} />
    </div>
  );
}
