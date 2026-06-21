"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  id: string;
  mastered: boolean;
}

export function VocabularyMasteryButton({ id, mastered }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const updateMastery = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/vocabulary", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, mastered }),
      });
      if (!response.ok) {
        throw new Error("Failed to update vocabulary");
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={loading}
      onClick={updateMastery}
      title="Mark as mastered"
      type="button"
      aria-label="Mark as mastered"
    >
      <Check aria-hidden="true" />
    </Button>
  );
}
