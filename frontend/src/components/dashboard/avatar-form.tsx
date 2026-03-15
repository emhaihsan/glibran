"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { getPresignedImageUploadUrl, createAvatarJob } from "@/lib/actions";
import { useRouter } from "next/navigation";

export function AvatarForm() {
  const [file, setFile] = useState<File | null>(null);
  const [script, setScript] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("Please select a portrait photo");
      return;
    }
    setFile(f);
    setError(null);
  };

  const handleGenerate = async () => {
    if (!file || !script.trim()) return;
    setUploading(true);
    setError(null);

    try {
      setProgress("Preparing upload…");
      const presign = await getPresignedImageUploadUrl(file.name);
      if ("error" in presign) throw new Error(presign.error);

      setProgress("Uploading photo…");
      const up = await fetch(presign.url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": "image/png" },
      });
      if (!up.ok) throw new Error("Upload failed");

      setProgress("Starting AI avatar generation…");
      const result = await createAvatarJob(presign.s3Key, script.trim());
      if ("error" in result) throw new Error(result.error);

      setProgress("");
      setFile(null);
      setScript("");
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">AI Avatar Studio</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Upload a portrait photo + write a script → AI generates a talking video with voice synthesis. Costs 3 credits.
        </p>

        <div
          className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
          {file ? (
            <p className="font-medium">{file.name}</p>
          ) : (
            <p className="text-muted-foreground">Click to select a portrait photo</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="script">Script</Label>
          <textarea
            id="script"
            className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Type what the avatar should say…"
            value={script}
            onChange={(e) => setScript(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {progress && <p className="text-sm text-muted-foreground animate-pulse">{progress}</p>}

        <Button
          onClick={handleGenerate}
          disabled={!file || !script.trim() || uploading}
          className="w-full"
        >
          {uploading ? "Processing…" : "Generate Avatar Video"}
        </Button>
      </CardContent>
    </Card>
  );
}
