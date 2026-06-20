"use client";

import { useEffect, useState } from "react";
import { lookupWord, type WordDefinition } from "@/lib/dictionary";
import { X, Plus } from "lucide-react";

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
    <div className="absolute z-50 bg-white border shadow-lg rounded-lg p-4 max-w-sm w-72">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-bold text-lg">{word}</h4>
        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
          <X className="w-4 h-4" />
        </button>
      </div>

      {loading && <p className="text-sm text-gray-500">Loading...</p>}

      {definition && (
        <div className="space-y-2">
          {definition.phonetic && (
            <p className="text-sm text-gray-500">{definition.phonetic}</p>
          )}
          {definition.meanings.slice(0, 2).map((meaning, i) => (
            <div key={i}>
              <span className="text-xs font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                {meaning.partOfSpeech}
              </span>
              <p className="text-sm text-gray-700 mt-1">
                {meaning.definitions[0]?.definition}
              </p>
              {meaning.definitions[0]?.example && (
                <p className="text-xs text-gray-500 italic mt-0.5">
                  &quot;{meaning.definitions[0].example}&quot;
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && !definition && (
        <p className="text-sm text-gray-500">No definition found.</p>
      )}

      <button
        onClick={saveToVocabulary}
        disabled={saved}
        className="mt-3 flex items-center gap-1 text-sm px-3 py-1.5 bg-green-50 text-green-700 rounded hover:bg-green-100 disabled:opacity-50"
      >
        <Plus className="w-3 h-3" />
        {saved ? "Saved!" : "Add to Vocabulary"}
      </button>
    </div>
  );
}
