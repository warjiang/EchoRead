import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";

const execFileAsync = promisify(execFile);

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

export const AVAILABLE_VOICES = [
  { id: "en-US-AriaNeural", name: "Aria (US Female)", accent: "American" },
  { id: "en-US-GuyNeural", name: "Guy (US Male)", accent: "American" },
  { id: "en-GB-SoniaNeural", name: "Sonia (UK Female)", accent: "British" },
  { id: "en-GB-RyanNeural", name: "Ryan (UK Male)", accent: "British" },
  { id: "en-AU-NatashaNeural", name: "Natasha (AU Female)", accent: "Australian" },
];

const VOICE_IDS = new Set(AVAILABLE_VOICES.map((voice) => voice.id));
const RATE_PATTERN = /^[+-]\d{1,3}%$/;
const PITCH_PATTERN = /^[+-]\d{1,3}Hz$/;

function normalizeOptions(options: TTSOptions): Required<TTSOptions> {
  const opts = { ...DEFAULT_OPTIONS, ...options } as Required<TTSOptions>;

  if (!VOICE_IDS.has(opts.voice)) {
    throw new Error(`Unsupported voice: ${opts.voice}`);
  }
  if (!RATE_PATTERN.test(opts.rate)) {
    throw new Error(`Unsupported rate: ${opts.rate}`);
  }
  if (!PITCH_PATTERN.test(opts.pitch)) {
    throw new Error(`Unsupported pitch: ${opts.pitch}`);
  }

  return opts;
}

export async function generateAudio(
  text: string,
  filename: string,
  options: TTSOptions = {}
): Promise<string> {
  const opts = normalizeOptions(options);
  const outputPath = path.join(AUDIO_DIR, `${filename}.mp3`);

  if (fs.existsSync(outputPath)) {
    return `/audio/${filename}.mp3`;
  }

  try {
    await execFileAsync("edge-tts", [
      "--voice",
      opts.voice,
      "--rate",
      opts.rate,
      "--pitch",
      opts.pitch,
      "--text",
      text,
      "--write-media",
      outputPath,
    ]);
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
