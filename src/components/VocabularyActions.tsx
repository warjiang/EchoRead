"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

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
    <button
      className="p-1.5 text-green-500 hover:bg-green-50 rounded disabled:opacity-50"
      disabled={loading}
      onClick={updateMastery}
      title="Mark as mastered"
      type="button"
    >
      <Check className="w-4 h-4" />
    </button>
  );
}
