"use client";

import { useRef, useState, useCallback } from "react";

interface RecorderState {
  isRecording: boolean;
  audioUrl: string | null;
  duration: number;
}

export function useRecorder() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const [state, setState] = useState<RecorderState>({
    isRecording: false,
    audioUrl: null,
    duration: 0,
  });

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        const duration = (Date.now() - startTimeRef.current) / 1000;
        setState({ isRecording: false, audioUrl: url, duration });
        stream.getTracks().forEach((t) => t.stop());
      };

      startTimeRef.current = Date.now();
      mediaRecorder.start();
      setState({ isRecording: true, audioUrl: null, duration: 0 });
    } catch (error) {
      console.error("Failed to start recording:", error);
    }
  }, []);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
  }, []);

  const clearRecording = useCallback(() => {
    if (state.audioUrl) {
      URL.revokeObjectURL(state.audioUrl);
    }
    setState({ isRecording: false, audioUrl: null, duration: 0 });
  }, [state.audioUrl]);

  return { ...state, startRecording, stopRecording, clearRecording };
}
