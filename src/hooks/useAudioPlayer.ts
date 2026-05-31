"use client";

import { useRef, useState, useCallback } from "react";

interface AudioPlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
}

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<AudioPlayerState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    playbackRate: 1,
  });

  const play = useCallback((url: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(url);
    audio.playbackRate = state.playbackRate;
    audioRef.current = audio;

    audio.onplay = () => setState((s) => ({ ...s, isPlaying: true }));
    audio.onpause = () => setState((s) => ({ ...s, isPlaying: false }));
    audio.onended = () => setState((s) => ({ ...s, isPlaying: false }));
    audio.ontimeupdate = () =>
      setState((s) => ({ ...s, currentTime: audio.currentTime }));
    audio.onloadedmetadata = () =>
      setState((s) => ({ ...s, duration: audio.duration }));

    audio.play();
  }, [state.playbackRate]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, []);

  const setRate = useCallback((rate: number) => {
    setState((s) => ({ ...s, playbackRate: rate }));
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  }, []);

  return { ...state, play, pause, stop, setRate, audioRef };
}
