"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPresignedUploadUrl, createClipJob } from "@/lib/actions";
import { useRouter } from "next/navigation";

export function UploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    if (!selected.type.startsWith("video/")) {
      setError("Please select a video file (.mp4)");
      return;
    }

    if (selected.size > 500 * 1024 * 1024) {
      setError("File too large. Max 500MB.");
      return;
    }

    setFile(selected);
    setError(null);
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      // 1. Get presigned URL
      setProgress("Preparing upload…");
      const presignResult = await getPresignedUploadUrl(file.name);
      if ("error" in presignResult) {
        throw new Error(presignResult.error);
      }

      // 2. Upload directly to S3
      setProgress("Uploading to storage…");
      const uploadRes = await fetch(presignResult.url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": "video/mp4" },
      });

      if (!uploadRes.ok) {
        throw new Error("Failed to upload file to storage");
      }

      // 3. Create job and trigger pipeline
      setProgress("Starting AI processing…");
      const jobResult = await createClipJob(presignResult.s3Key, file.name);
      if ("error" in jobResult) {
        throw new Error(jobResult.error);
      }

      setProgress("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Upload Video</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/*"
            onChange={handleFileSelect}
            className="hidden"
          />
          {file ? (
            <div className="space-y-1">
              <p className="font-medium">{file.name}</p>
              <p className="text-sm text-muted-foreground">
                {(file.size / (1024 * 1024)).toFixed(1)} MB
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-muted-foreground">
                Click to select a video file
              </p>
              <p className="text-xs text-muted-foreground">
                MP4 up to 500MB · Costs 2 credits
              </p>
            </div>
          )}
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {progress && (
          <p className="text-sm text-muted-foreground animate-pulse">{progress}</p>
        )}

        <Button
          onClick={handleUpload}
          disabled={!file || uploading}
          className="w-full"
        >
          {uploading ? "Processing…" : "Upload & Generate Clips"}
        </Button>
      </CardContent>
    </Card>
  );
}
