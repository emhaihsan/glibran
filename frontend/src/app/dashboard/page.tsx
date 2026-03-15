import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { UploadForm } from "@/components/dashboard/upload-form";
import { JobList } from "@/components/dashboard/job-list";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const jobs = await prisma.job.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  // Serialize dates for client components
  const serializedJobs = jobs.map((job) => ({
    id: job.id,
    type: job.type,
    status: job.status,
    inputUrl: job.inputUrl,
    resultUrl: job.resultUrl,
    cost: job.cost,
    createdAt: job.createdAt.toISOString(),
  }));

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Upload a video and let AI find the best moments.
        </p>
      </div>

      <UploadForm />

      <JobList jobs={serializedJobs} />
    </div>
  );
}
