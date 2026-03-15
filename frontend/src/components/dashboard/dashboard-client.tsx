"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { UploadForm } from "./upload-form";
import { ThumbnailForm } from "./thumbnail-form";
import { AvatarForm } from "./avatar-form";
import { JobList } from "./job-list";
import { TopUpCard } from "./topup-card";

type Job = {
  id: string;
  type: string;
  status: string;
  inputUrl: string;
  resultUrl: string | null;
  cost: number;
  createdAt: string;
};

const TABS = [
  { id: "clipper", label: "✂️ Clipper", cost: 2 },
  { id: "thumbnail", label: "🖼️ Thumbnail", cost: 1 },
  { id: "avatar", label: "🗣️ Avatar", cost: 3 },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function DashboardClient({
  credits,
  jobs,
}: {
  credits: number;
  jobs: Job[];
}) {
  const [activeTab, setActiveTab] = useState<TabId>("clipper");

  const currentTab = TABS.find((t) => t.id === activeTab)!;
  const hasEnoughCredits = credits >= currentTab.cost;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          AI-powered tools for content creators. You have{" "}
          <strong>{credits} credits</strong>.
        </p>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-2 border-b pb-1">
        {TABS.map((tab) => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab(tab.id)}
            className="text-sm"
          >
            {tab.label}
            <span className="ml-1.5 text-xs opacity-70">({tab.cost} cr)</span>
          </Button>
        ))}
      </div>

      {/* Feature form based on active tab */}
      {hasEnoughCredits ? (
        <>
          {activeTab === "clipper" && <UploadForm />}
          {activeTab === "thumbnail" && <ThumbnailForm />}
          {activeTab === "avatar" && <AvatarForm />}
        </>
      ) : (
        <div className="border border-destructive/50 rounded-lg p-6 text-center space-y-2">
          <p className="font-medium text-destructive">
            You need at least {currentTab.cost} credits for{" "}
            {currentTab.label.replace(/[^\w\s]/g, "").trim()}.
          </p>
          <p className="text-sm text-muted-foreground">
            Each new user receives 10 free credits to try all features.
          </p>
        </div>
      )}

      {/* Credit packs (demo) */}
      <TopUpCard currentCredits={credits} />

      {/* Job history */}
      <JobList jobs={jobs} />
    </div>
  );
}
