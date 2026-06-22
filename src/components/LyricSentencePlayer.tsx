"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Repeat, SkipBack, SkipForward } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  findActiveLyricSentenceIndex,
  findActiveLyricWordIndex,
  findFirstLyricSentenceIndex,
  findNextLyricSentenceIndex,
  findPreviousLyricSentenceIndex,
  isLyricSentencePlayable,
  type WsjAudioWordTiming,
} from "@/lib/original-audio/lyric";
import { cn } from "@/lib/utils";

interface Sentence {
  id: string;
  index: number;
  text: string;
  wsjAudioUrl: string | null;
  wsjAudioStartMs: number | null;
  wsjAudioEndMs: number | null;
  wsjAudioStatus: string;
  wsjAudioWords: WsjAudioWordTiming[];
}

interface LyricSentencePlayerProps {
  sourceAudioUrl: string;
  sentences: Sentence[];
  onSentenceChange?: (index: number) => void;
}

function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  const totalSeconds = Math.trunc(ms / 1000);
  const minutes = Math.trunc(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function renderWords(sentence: Sentence): WsjAudioWordTiming[] {
  return sentence.wsjAudioWords.length > 0
    ? sentence.wsjAudioWords
    : sentence.text.split(/\s+/).filter(Boolean).map((text) => ({ text, startMs: null, endMs: null }));
}

export function LyricSentencePlayer({
  sourceAudioUrl,
  sentences,
  onSentenceChange,
}: LyricSentencePlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sentenceRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [currentIndex, setCurrentIndex] = useState(() => findFirstLyricSentenceIndex(sentences));
  const [activeWordIndex, setActiveWordIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoopingSentence, setIsLoopingSentence] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);

  const currentSentence = sentences[currentIndex];

  const canGoPrev = useMemo(
    () => findPreviousLyricSentenceIndex(sentences, currentIndex) !== currentIndex,
    [currentIndex, sentences]
  );
  const canGoNext = useMemo(
    () => findNextLyricSentenceIndex(sentences, currentIndex) !== currentIndex,
    [currentIndex, sentences]
  );

  const seekToSentence = useCallback(
    (index: number, shouldPlay = false) => {
      const sentence = sentences[index];
      if (!isLyricSentencePlayable(sentence) || sentence.wsjAudioStartMs == null) return;
      const audio = audioRef.current;
      if (!audio) return;

      audio.currentTime = sentence.wsjAudioStartMs / 1000;
      setCurrentIndex(index);
      setCurrentTimeMs(sentence.wsjAudioStartMs);
      setActiveWordIndex(findActiveLyricWordIndex(sentence.wsjAudioWords, sentence.wsjAudioStartMs));
      if (shouldPlay) {
        void audio.play();
      }
    },
    [sentences]
  );

  const playCurrent = useCallback(() => {
    if (!isLyricSentencePlayable(currentSentence)) {
      seekToSentence(findFirstLyricSentenceIndex(sentences), true);
      return;
    }
    void audioRef.current?.play();
  }, [currentSentence, seekToSentence, sentences]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const goPrev = useCallback(() => {
    seekToSentence(findPreviousLyricSentenceIndex(sentences, currentIndex), isPlaying);
  }, [currentIndex, isPlaying, seekToSentence, sentences]);

  const goNext = useCallback(() => {
    seekToSentence(findNextLyricSentenceIndex(sentences, currentIndex), isPlaying);
  }, [currentIndex, isPlaying, seekToSentence, sentences]);

  const handleTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const nextTimeMs = Math.trunc(audio.currentTime * 1000);
    const sentence = sentences[currentIndex];
    if (
      isLoopingSentence &&
      isLyricSentencePlayable(sentence) &&
      sentence.wsjAudioStartMs != null &&
      sentence.wsjAudioEndMs != null &&
      nextTimeMs >= sentence.wsjAudioEndMs
    ) {
      audio.currentTime = sentence.wsjAudioStartMs / 1000;
      setCurrentTimeMs(sentence.wsjAudioStartMs);
      setActiveWordIndex(findActiveLyricWordIndex(sentence.wsjAudioWords, sentence.wsjAudioStartMs));
      return;
    }

    const nextIndex = findActiveLyricSentenceIndex(sentences, nextTimeMs, currentIndex);
    setCurrentTimeMs(nextTimeMs);
    if (nextIndex !== currentIndex) {
      setCurrentIndex(nextIndex);
    }
    setActiveWordIndex(findActiveLyricWordIndex(sentences[nextIndex]?.wsjAudioWords, nextTimeMs));
  }, [currentIndex, isLoopingSentence, sentences]);

  useEffect(() => {
    onSentenceChange?.(currentIndex);
    sentenceRefs.current[currentIndex]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [currentIndex, onSentenceChange]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  return (
    <div className="flex flex-col gap-4">
      <audio
        ref={audioRef}
        src={sourceAudioUrl}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onLoadedMetadata={(event) => setDurationMs(Math.trunc(event.currentTarget.duration * 1000))}
      />

      <div className="sticky top-16 z-10 flex flex-wrap items-center gap-3 rounded-lg border bg-background p-3">
        <div className="flex items-center gap-1">
          <Button type="button" onClick={goPrev} disabled={!canGoPrev} variant="ghost" size="icon" aria-label="Previous sentence">
            <SkipBack aria-hidden="true" />
          </Button>
          <Button
            type="button"
            onClick={isPlaying ? pause : playCurrent}
            size="icon-lg"
            disabled={!isLyricSentencePlayable(currentSentence)}
            aria-label={isPlaying ? "Pause source audio" : "Play source audio"}
          >
            {isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          </Button>
          <Button type="button" onClick={goNext} disabled={!canGoNext} variant="ghost" size="icon" aria-label="Next sentence">
            <SkipForward aria-hidden="true" />
          </Button>
        </div>

        <ToggleGroup
          value={[String(playbackRate)]}
          onValueChange={(value) => {
            const nextRate = Number(value[0]);
            if (Number.isFinite(nextRate) && nextRate > 0) {
              setPlaybackRate(nextRate);
            }
          }}
          className="rounded-md bg-muted p-0.5"
          spacing={0}
          aria-label="Playback speed"
        >
          {[0.5, 0.75, 1, 1.25, 1.5].map((rate) => (
            <ToggleGroupItem key={rate} value={String(rate)} size="sm" className="min-w-10">
              {rate}x
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={isLoopingSentence} onCheckedChange={setIsLoopingSentence} aria-label="Toggle sentence loop" />
          <Repeat className="size-4" aria-hidden="true" />
        </label>

        <Badge variant="outline" className="font-mono">
          {formatTime(currentTimeMs)} / {formatTime(durationMs)}
        </Badge>
        <Badge variant="secondary" className="font-mono">
          {currentIndex + 1}/{sentences.length}
        </Badge>
      </div>

      <div className="rounded-lg border bg-muted/30 p-4">
        <p className="text-base leading-8 text-foreground">
          {currentSentence?.text}
        </p>
      </div>

      <ScrollArea className="h-[28rem] rounded-lg border">
        <div className="flex flex-col gap-2 p-2">
          {sentences.map((sentence, sentenceIndex) => {
            const playable = isLyricSentencePlayable(sentence);
            return (
              <button
                key={sentence.id}
                ref={(el) => { sentenceRefs.current[sentenceIndex] = el; }}
                onClick={() => seekToSentence(sentenceIndex, isPlaying)}
                disabled={!playable}
                type="button"
                className={cn(
                  "rounded-md border p-3 text-left text-sm leading-7 transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  sentenceIndex === currentIndex
                    ? "border-foreground bg-muted text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground",
                  !playable && "cursor-not-allowed opacity-50 hover:border-transparent hover:bg-transparent"
                )}
              >
                <span className="mr-2 font-mono text-xs text-muted-foreground">
                  {String(sentenceIndex + 1).padStart(2, "0")}
                </span>
                <span className="inline-flex flex-wrap gap-x-1.5 gap-y-1 align-baseline">
                  {renderWords(sentence).map((word, wordIndex) => (
                    <span
                      key={`${sentence.id}-${wordIndex}-${word.text}`}
                      className={cn(
                        "rounded-[3px] px-0.5 transition-colors",
                        sentenceIndex === currentIndex &&
                          wordIndex === activeWordIndex &&
                          word.startMs != null &&
                          word.endMs != null &&
                          "bg-primary text-primary-foreground"
                      )}
                    >
                      {word.text}
                    </span>
                  ))}
                </span>
                {!playable && (
                  <span className="ml-2 text-xs text-muted-foreground">Unavailable</span>
                )}
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
