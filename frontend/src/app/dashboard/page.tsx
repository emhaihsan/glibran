import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { DashboardClient } from "@/components/dashboard/dashboard-client";

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

  return (
    <DashboardClient
      credits={user?.creditsAmount ?? 0}
      jobs={serializedJobs}
    />
  );
}
