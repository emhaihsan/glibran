"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CREDIT_PACKS } from "@/lib/constants";

export function TopUpCard({ currentCredits }: { currentCredits: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center justify-between">
          <span>Credit Packs</span>
          <Badge variant="outline" className="text-sm">
            Balance: {currentCredits}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {currentCredits <= 0 && (
          <p className="text-sm text-destructive font-medium">
            You have no credits remaining.
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {CREDIT_PACKS.map((pack, i) => (
            <div
              key={i}
              className="border rounded-lg p-4 text-center space-y-2 hover:border-primary/50 transition-colors"
            >
              <p className="text-2xl font-bold">{pack.credits}</p>
              <p className="text-xs text-muted-foreground">credits</p>
              <p className="text-sm font-medium">{pack.desc}</p>
              <Button variant="outline" size="sm" className="w-full" disabled>
                Coming Soon
              </Button>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Payments powered by Mayar · Top-up available after merchant verification
        </p>
      </CardContent>
    </Card>
  );
}
