"use client";

import { useRecorder } from "@/hooks/useRecorder";
import { Mic, Square, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AudioRecorderProps {
  onRecordingComplete?: (audioUrl: string) => void;
}

export function AudioRecorder({ onRecordingComplete }: AudioRecorderProps) {
  const { isRecording, audioUrl, duration, startRecording, stopRecording, clearRecording } = useRecorder();

  const handleStop = () => {
    stopRecording();
  };

  const playRecording = () => {
    if (audioUrl) {
      const audio = new Audio(audioUrl);
      void audio.play();
      onRecordingComplete?.(audioUrl);
    }
  };

  return (
    <div className="flex min-h-14 flex-wrap items-center gap-3 rounded-lg border bg-muted/40 p-3">
      {!isRecording && !audioUrl && (
        <Button
          type="button"
          onClick={startRecording}
          variant="destructive"
        >
          <Mic data-icon="inline-start" aria-hidden="true" />
          Record
        </Button>
      )}

      {isRecording && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-destructive" />
            <span className="text-sm font-medium text-destructive">Recording…</span>
          </div>
          <Button
            type="button"
            onClick={handleStop}
            size="icon"
            aria-label="Stop recording"
          >
            <Square aria-hidden="true" />
          </Button>
        </div>
      )}

      {audioUrl && !isRecording && (
        <div className="flex items-center gap-3">
          <Button
            type="button"
            onClick={playRecording}
            variant="secondary"
          >
            <Play data-icon="inline-start" aria-hidden="true" />
            Play ({duration.toFixed(1)}s)
          </Button>
          <Button
            type="button"
            onClick={clearRecording}
            variant="ghost"
            size="icon"
            aria-label="Discard recording"
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}
