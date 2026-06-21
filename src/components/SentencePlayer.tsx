"use client";

import { useCallback, useState, useEffect, useMemo, useRef } from "react";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface Sentence {
  id: string;
  index: number;
  text: string;
  wsjAudioUrl: string | null;
  wsjAudioStatus: string;
}

interface SentencePlayerProps {
  sentences: Sentence[];
  onSentenceChange?: (index: number) => void;
}

export function SentencePlayer({ sentences, onSentenceChange }: SentencePlayerProps) {
  const [isAutoPlay, setIsAutoPlay] = useState(false);
  const { isPlaying, playbackRate, play, pause, stop, setRate } = useAudioPlayer();
  const sentenceRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const isPlayable = useCallback(
    (sentence: Sentence | undefined) =>
      Boolean(sentence?.wsjAudioUrl && sentence.wsjAudioStatus === "ready"),
    []
  );
  const playableIndices = useMemo(
    () =>
      sentences
        .map((sentence, index) => (isPlayable(sentence) ? index : -1))
        .filter((index) => index >= 0),
    [isPlayable, sentences]
  );
  const [currentIndex, setCurrentIndex] = useState(() => {
    const initialIndex = sentences.findIndex((sentence) =>
      Boolean(sentence.wsjAudioUrl && sentence.wsjAudioStatus === "ready")
    );
    return Math.max(0, initialIndex);
  });
  const currentSentence = sentences[currentIndex];

  useEffect(() => {
    onSentenceChange?.(currentIndex);
    sentenceRefs.current[currentIndex]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [currentIndex, onSentenceChange]);

  const playCurrentSentence = async () => {
    if (isPlayable(currentSentence) && currentSentence.wsjAudioUrl) {
      play(currentSentence.wsjAudioUrl);
    }
  };

  const findNextPlayableIndex = (fromIndex: number) =>
    playableIndices.find((index) => index > fromIndex) ?? currentIndex;

  const findPrevPlayableIndex = (fromIndex: number) =>
    [...playableIndices].reverse().find((index) => index < fromIndex) ?? currentIndex;

  const goNext = () => {
    const nextIndex = findNextPlayableIndex(currentIndex);
    if (nextIndex !== currentIndex) {
      stop();
      setCurrentIndex(nextIndex);
    }
  };

  const goPrev = () => {
    const prevIndex = findPrevPlayableIndex(currentIndex);
    if (prevIndex !== currentIndex) {
      stop();
      setCurrentIndex(prevIndex);
    }
  };

  const handleSentenceClick = (index: number) => {
    stop();
    setCurrentIndex(index);
  };

  // Auto-play next sentence when current finishes
  useEffect(() => {
    const nextIndex = findNextPlayableIndex(currentIndex);
    if (!isPlaying && isAutoPlay && nextIndex !== currentIndex) {
      const timer = setTimeout(() => {
        setCurrentIndex(nextIndex);
      }, 1000);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, isAutoPlay, currentIndex, playableIndices]);

  useEffect(() => {
    if (isAutoPlay && !isPlaying && isPlayable(currentSentence)) {
      void playCurrentSentence();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-16 z-10 flex flex-wrap items-center gap-3 rounded-lg border bg-background p-3">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            onClick={goPrev}
            disabled={findPrevPlayableIndex(currentIndex) === currentIndex}
            variant="ghost"
            size="icon"
            aria-label="Previous sentence"
          >
            <SkipBack aria-hidden="true" />
          </Button>
          <Button
            type="button"
            onClick={isPlaying ? pause : playCurrentSentence}
            size="icon-lg"
            disabled={!isPlayable(currentSentence)}
            aria-label={isPlaying ? "Pause sentence" : "Play sentence"}
          >
            {isPlaying ? (
              <Pause aria-hidden="true" />
            ) : (
              <Play aria-hidden="true" />
            )}
          </Button>
          <Button
            type="button"
            onClick={goNext}
            disabled={findNextPlayableIndex(currentIndex) === currentIndex}
            variant="ghost"
            size="icon"
            aria-label="Next sentence"
          >
            <SkipForward aria-hidden="true" />
          </Button>
        </div>

        <ToggleGroup
          value={[String(playbackRate)]}
          onValueChange={(value) => {
            const nextRate = Number(value[0]);
            if (Number.isFinite(nextRate) && nextRate > 0) {
              setRate(nextRate);
            }
          }}
          className="rounded-md bg-muted p-0.5"
          spacing={0}
          aria-label="Playback speed"
        >
          {[0.5, 0.75, 1, 1.25, 1.5].map((rate) => (
            <ToggleGroupItem
              key={rate}
              value={String(rate)}
              size="sm"
              className="min-w-10"
            >
              {rate}x
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <Switch
            checked={isAutoPlay}
            onCheckedChange={(checked) => setIsAutoPlay(checked)}
            aria-label="Toggle autoplay"
          />
          Auto
        </label>

        <Badge variant="outline" className="font-mono">
          {currentIndex + 1}/{sentences.length}
        </Badge>
      </div>

      <ScrollArea className="h-[28rem] rounded-lg border">
        <div className="flex flex-col gap-2 p-2">
          {sentences.map((sentence, index) => (
            <button
              key={sentence.id}
              ref={(el) => { sentenceRefs.current[index] = el; }}
              onClick={() => handleSentenceClick(index)}
              disabled={!isPlayable(sentence)}
              type="button"
              className={cn(
                "rounded-md border p-3 text-left text-sm leading-7 transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                index === currentIndex
                  ? "border-foreground bg-muted font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground",
                !isPlayable(sentence) && "cursor-not-allowed opacity-50 hover:border-transparent hover:bg-transparent"
              )}
            >
              <span className="mr-2 font-mono text-xs text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </span>
              {sentence.text}
              {!isPlayable(sentence) && (
                <span className="ml-2 text-xs text-muted-foreground">
                  Unavailable
                </span>
              )}
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
