import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";

const execAsync = promisify(exec);

const AUDIO_DIR = path.join(process.cwd(), "public", "audio");

// Ensure audio directory exists
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

export interface TTSOptions {
  voice?: string;
  rate?: string;
  pitch?: string;
}

const DEFAULT_OPTIONS: TTSOptions = {
  voice: "en-US-AriaNeural",
  rate: "+0%",
  pitch: "+0Hz",
};

export async function generateAudio(
  text: string,
  filename: string,
  options: TTSOptions = {}
): Promise<string> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const outputPath = path.join(AUDIO_DIR, `${filename}.mp3`);

  if (fs.existsSync(outputPath)) {
    return `/audio/${filename}.mp3`;
  }

  const escapedText = text.replace(/"/g, '\\"').replace(/'/g, "\\'");

  const cmd = `edge-tts --voice "${opts.voice}" --rate="${opts.rate}" --pitch="${opts.pitch}" --text "${escapedText}" --write-media "${outputPath}"`;

  try {
    await execAsync(cmd);
    return `/audio/${filename}.mp3`;
  } catch (error) {
    console.error("Edge TTS error:", error);
    throw new Error(`Failed to generate audio: ${error}`);
  }
}

export async function generateArticleAudio(
  sentences: { id: string; text: string }[],
  articleId: string,
  options: TTSOptions = {}
): Promise<Map<string, string>> {
  const audioMap = new Map<string, string>();

  for (const sentence of sentences) {
    const filename = `${articleId}_${sentence.id}`;
    try {
      const audioUrl = await generateAudio(sentence.text, filename, options);
      audioMap.set(sentence.id, audioUrl);
    } catch (error) {
      console.error(`Failed to generate audio for sentence ${sentence.id}:`, error);
    }
  }

  return audioMap;
}

export const AVAILABLE_VOICES = [
  { id: "en-US-AriaNeural", name: "Aria (US Female)", accent: "American" },
  { id: "en-US-GuyNeural", name: "Guy (US Male)", accent: "American" },
  { id: "en-GB-SoniaNeural", name: "Sonia (UK Female)", accent: "British" },
  { id: "en-GB-RyanNeural", name: "Ryan (UK Male)", accent: "British" },
  { id: "en-AU-NatashaNeural", name: "Natasha (AU Female)", accent: "Australian" },
];
