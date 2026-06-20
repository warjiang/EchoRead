export interface ChunkedScriptItem {
  sentence: string;
  chunks: string[];
  pauseHints: string[];
  stressWords: string[];
}

export interface SimplifiedVersion {
  cefrLevel: "B1-B2";
  text: string;
}

export interface DictationExercise {
  prompt: string;
  answer: string;
}

export interface ClozeExercise {
  prompt: string;
  answer: string;
}

export interface RetellOutlineItem {
  point: string;
  connectors: string[];
}

export interface KeywordPrompt {
  keyword: string;
  prompt: string;
}

export interface TrainingMaterialPayload {
  chunkedScript: ChunkedScriptItem[];
  simplifiedVersion: SimplifiedVersion;
  dictationExercises: DictationExercise[];
  clozeExercises: ClozeExercise[];
  retellOutline: RetellOutlineItem[];
  keywordPrompts: KeywordPrompt[];
}
