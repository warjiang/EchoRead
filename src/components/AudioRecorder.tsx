"use client";

import { useRecorder } from "@/hooks/useRecorder";
import { Mic, Square, Play, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

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
      audio.play();
      onRecordingComplete?.(audioUrl);
    }
  };

  return (
    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
      {!isRecording && !audioUrl && (
        <button
          onClick={startRecording}
          className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-full hover:bg-red-600 transition"
        >
          <Mic className="w-4 h-4" />
          <span className="text-sm">Record</span>
        </button>
      )}

      {isRecording && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            <span className="text-sm text-red-600 font-medium">Recording...</span>
          </div>
          <button
            onClick={handleStop}
            className="p-2 bg-gray-800 text-white rounded-full hover:bg-gray-900"
          >
            <Square className="w-4 h-4" />
          </button>
        </div>
      )}

      {audioUrl && !isRecording && (
        <div className="flex items-center gap-3">
          <button
            onClick={playRecording}
            className="flex items-center gap-2 px-3 py-1.5 bg-green-500 text-white rounded-full hover:bg-green-600 text-sm"
          >
            <Play className="w-3 h-3" />
            Play ({duration.toFixed(1)}s)
          </button>
          <button
            onClick={clearRecording}
            className={cn("p-1.5 text-gray-400 hover:text-red-500 rounded")}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
