"use client";

import { useEffect, useState } from "react";
import { lookupWord, type WordDefinition } from "@/lib/dictionary";
import { X, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

interface WordTooltipProps {
  word: string;
  context?: string;
  articleId?: string;
  onClose: () => void;
}

export function WordTooltip({ word, context, articleId, onClose }: WordTooltipProps) {
  const [lookup, setLookup] = useState<{
    word: string;
    definition: WordDefinition | null;
    loading: boolean;
  }>({ word, definition: null, loading: true });
  const [savedState, setSavedState] = useState({ word, saved: false });

  useEffect(() => {
    let cancelled = false;

    lookupWord(word).then((def) => {
      if (cancelled) return;
      setLookup({ word, definition: def, loading: false });
    });

    return () => {
      cancelled = true;
    };
  }, [word]);

  const saveToVocabulary = async () => {
    await fetch("/api/vocabulary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word, context, articleId }),
    });
    setSavedState({ word, saved: true });
  };

  const loading = lookup.word !== word || lookup.loading;
  const definition = lookup.word === word ? lookup.definition : null;
  const saved = savedState.word === word && savedState.saved;

  return (
    <Card className="absolute z-50 w-72 max-w-sm shadow-lg">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="truncate text-lg">{word}</CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close definition"
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
      {loading && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      )}

      {definition && (
        <div className="flex flex-col gap-3">
          {definition.phonetic && (
            <p className="text-sm text-muted-foreground">{definition.phonetic}</p>
          )}
          {definition.meanings.slice(0, 2).map((meaning, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Badge variant="outline" className="w-fit">
                {meaning.partOfSpeech}
              </Badge>
              <p className="text-sm leading-6 text-foreground">
                {meaning.definitions[0]?.definition}
              </p>
              {meaning.definitions[0]?.example && (
                <p className="text-xs leading-5 text-muted-foreground">
                  &quot;{meaning.definitions[0].example}&quot;
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && !definition && (
        <p className="text-sm text-muted-foreground">No definition found.</p>
      )}

      <Separator />

      <Button
        type="button"
        onClick={saveToVocabulary}
        disabled={saved}
        variant={saved ? "secondary" : "default"}
      >
        <Plus data-icon="inline-start" aria-hidden="true" />
        {saved ? "Saved" : "Add to Vocabulary"}
      </Button>
      </CardContent>
    </Card>
  );
}
