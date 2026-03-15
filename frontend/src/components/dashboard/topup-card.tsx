"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createTopUpLink } from "@/lib/actions";
import { CREDIT_PACKS } from "@/lib/constants";

export function TopUpCard({ currentCredits }: { currentCredits: number }) {
  const [loading, setLoading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleBuy = async (packIndex: number) => {
    setLoading(packIndex);
    setError(null);

    try {
      const result = await createTopUpLink(packIndex);
      if ("error" in result) {
        throw new Error(result.error);
      }
      // Redirect to Mayar checkout
      window.location.href = result.checkoutUrl!;
    } catch (err: any) {
      setError(err.message || "Failed to create payment link");
      setLoading(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center justify-between">
          <span>Top Up Credits</span>
          <Badge variant="outline" className="text-sm">
            Balance: {currentCredits}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {currentCredits < 2 && (
          <p className="text-sm text-destructive font-medium">
            Insufficient credits to generate clips. Please top up below.
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
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={loading !== null}
                onClick={() => handleBuy(i)}
              >
                {loading === i ? "Redirecting…" : "Buy"}
              </Button>
            </div>
          ))}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <p className="text-xs text-muted-foreground text-center">
          Powered by Mayar · Secure payment gateway
        </p>
      </CardContent>
    </Card>
  );
}
