"use client";

import { useState, useEffect, useRef } from "react";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { cn } from "@/lib/utils";

interface Sentence {
  id: string;
  index: number;
  text: string;
  audioUrl: string | null;
}

interface SentencePlayerProps {
  sentences: Sentence[];
  onSentenceChange?: (index: number) => void;
}

export function SentencePlayer({ sentences, onSentenceChange }: SentencePlayerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAutoPlay, setIsAutoPlay] = useState(false);
  const { isPlaying, playbackRate, play, pause, stop, setRate } = useAudioPlayer();
  const sentenceRefs = useRef<(HTMLDivElement | null)[]>([]);

  const currentSentence = sentences[currentIndex];

  useEffect(() => {
    onSentenceChange?.(currentIndex);
    sentenceRefs.current[currentIndex]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [currentIndex, onSentenceChange]);

  const playCurrentSentence = async () => {
    if (!currentSentence) return;

    let audioUrl = currentSentence.audioUrl;
    if (!audioUrl) {
      // Generate audio on demand
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentenceId: currentSentence.id }),
      });
      const data = await res.json();
      audioUrl = data.audioUrl;
    }

    if (audioUrl) {
      play(audioUrl);
    }
  };

  const goNext = () => {
    if (currentIndex < sentences.length - 1) {
      stop();
      setCurrentIndex(currentIndex + 1);
    }
  };

  const goPrev = () => {
    if (currentIndex > 0) {
      stop();
      setCurrentIndex(currentIndex - 1);
    }
  };

  const handleSentenceClick = (index: number) => {
    stop();
    setCurrentIndex(index);
  };

  // Auto-play next sentence when current finishes
  useEffect(() => {
    if (!isPlaying && isAutoPlay && currentIndex < sentences.length - 1) {
      const timer = setTimeout(() => {
        setCurrentIndex((prev) => prev + 1);
        playCurrentSentence();
      }, 1000);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, isAutoPlay]);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg sticky top-0 z-10">
        <button onClick={goPrev} disabled={currentIndex === 0} className="p-2 rounded hover:bg-gray-200 disabled:opacity-30">
          <SkipBack className="w-4 h-4" />
        </button>
        <button onClick={isPlaying ? pause : playCurrentSentence} className="p-2 rounded-full bg-blue-600 text-white hover:bg-blue-700">
          {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
        </button>
        <button onClick={goNext} disabled={currentIndex === sentences.length - 1} className="p-2 rounded hover:bg-gray-200 disabled:opacity-30">
          <SkipForward className="w-4 h-4" />
        </button>

        {/* Speed control */}
        <div className="flex items-center gap-1 ml-4">
          {[0.5, 0.75, 1, 1.25, 1.5].map((rate) => (
            <button
              key={rate}
              onClick={() => setRate(rate)}
              className={cn(
                "px-2 py-1 text-xs rounded",
                playbackRate === rate ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              )}
            >
              {rate}x
            </button>
          ))}
        </div>

        {/* Auto-play toggle */}
        <label className="flex items-center gap-1 ml-auto text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={isAutoPlay}
            onChange={(e) => setIsAutoPlay(e.target.checked)}
            className="rounded"
          />
          Auto
        </label>

        <span className="text-xs text-gray-500">
          {currentIndex + 1}/{sentences.length}
        </span>
      </div>

      {/* Sentences display */}
      <div className="space-y-2 max-h-96 overflow-y-auto p-2">
        {sentences.map((sentence, index) => (
          <div
            key={sentence.id}
            ref={(el) => { sentenceRefs.current[index] = el; }}
            onClick={() => handleSentenceClick(index)}
            className={cn(
              "p-3 rounded-lg cursor-pointer transition-all text-sm leading-relaxed",
              index === currentIndex
                ? "bg-blue-50 border-l-4 border-blue-600 font-medium"
                : "hover:bg-gray-50 border-l-4 border-transparent"
            )}
          >
            <span className="text-gray-400 text-xs mr-2">{index + 1}</span>
            {sentence.text}
          </div>
        ))}
      </div>
    </div>
  );
}
