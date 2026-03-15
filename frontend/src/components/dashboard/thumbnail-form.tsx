"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getPresignedImageUploadUrl, createThumbnailJob } from "@/lib/actions";
import { useRouter } from "next/navigation";

export function ThumbnailForm() {
  const [file, setFile] = useState<File | null>(null);
  const [headline, setHeadline] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("Please select an image file");
      return;
    }
    setFile(f);
    setError(null);
  };

  const handleGenerate = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);

    try {
      setProgress("Preparing upload…");
      const presign = await getPresignedImageUploadUrl(file.name);
      if ("error" in presign) throw new Error(presign.error);

      setProgress("Uploading image…");
      const up = await fetch(presign.url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": "image/png" },
      });
      if (!up.ok) throw new Error("Upload failed");

      setProgress("Starting AI thumbnail generation…");
      const result = await createThumbnailJob(presign.s3Key, headline || "YOUR TEXT HERE");
      if ("error" in result) throw new Error(result.error);

      setProgress("");
      setFile(null);
      setHeadline("");
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
        <CardTitle className="text-lg">AI Thumbnail Maker</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Upload a photo → AI removes background → text placed behind subject. Costs 1 credit.
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
            <p className="text-muted-foreground">Click to select an image</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="headline">Headline Text</Label>
          <Input
            id="headline"
            placeholder="e.g. THE TRUTH ABOUT AI"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {progress && <p className="text-sm text-muted-foreground animate-pulse">{progress}</p>}

        <Button onClick={handleGenerate} disabled={!file || uploading} className="w-full">
          {uploading ? "Processing…" : "Generate Thumbnail"}
        </Button>
      </CardContent>
    </Card>
  );
}
