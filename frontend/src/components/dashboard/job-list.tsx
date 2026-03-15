"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { refreshDashboard } from "@/lib/actions";
import { useRouter } from "next/navigation";

type Clip = {
  clip_url: string;
  s3_key: string;
  title: string;
  viral_score: number;
};

type Job = {
  id: string;
  type: string;
  status: string;
  inputUrl: string;
  resultUrl: string | null;
  cost: number;
  createdAt: string;
};

function statusColor(status: string) {
  switch (status) {
    case "COMPLETED":
      return "default";
    case "PROCESSING":
      return "secondary";
    case "FAILED":
      return "destructive";
    default:
      return "outline";
  }
}

function parseClips(resultUrl: string | null): Clip[] {
  if (!resultUrl) return [];
  try {
    return JSON.parse(resultUrl);
  } catch {
    return [];
  }
}

export function JobList({ jobs }: { jobs: Job[] }) {
  const router = useRouter();

  const handleRefresh = async () => {
    await refreshDashboard();
    router.refresh();
  };

  if (jobs.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No jobs yet. Upload a video to get started.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Your Jobs</h2>
        <Button variant="outline" size="sm" onClick={handleRefresh}>
          Refresh
        </Button>
      </div>

      {jobs.map((job) => {
        const clips = parseClips(job.resultUrl);
        return (
          <Card key={job.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">
                  {job.inputUrl.split("/").pop() || "Video"}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant={statusColor(job.status)}>{job.status}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(job.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </CardHeader>

            {job.status === "PROCESSING" && (
              <CardContent>
                <p className="text-sm text-muted-foreground animate-pulse">
                  AI is processing your video… This may take a few minutes.
                </p>
              </CardContent>
            )}

            {job.status === "FAILED" && (
              <CardContent>
                <p className="text-sm text-destructive">
                  Processing failed. Your {job.cost} credits have been refunded.
                </p>
              </CardContent>
            )}

            {job.status === "COMPLETED" && clips.length > 0 && (
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {clips.map((clip, i) => (
                    <div
                      key={i}
                      className="border rounded-lg p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium truncate">
                          {clip.title}
                        </p>
                        {clip.viral_score > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            {clip.viral_score}%
                          </Badge>
                        )}
                      </div>
                      <video
                        src={clip.clip_url}
                        controls
                        className="w-full rounded aspect-[9/16] bg-muted object-contain"
                      />
                      <a
                        href={clip.clip_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        download
                      >
                        <Button variant="outline" size="sm" className="w-full">
                          Download
                        </Button>
                      </a>
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
