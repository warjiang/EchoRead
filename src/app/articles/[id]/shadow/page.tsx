"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Radio } from "lucide-react";
import { SentencePlayer } from "@/components/SentencePlayer";
import { LyricSentencePlayer } from "@/components/LyricSentencePlayer";
import { AudioRecorder } from "@/components/AudioRecorder";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hasLyricTimeline, type WsjAudioWordTiming } from "@/lib/original-audio/lyric";
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

interface Article {
  id: string;
  title: string;
  sentences: Sentence[];
  originalAudio: {
    status: string;
    sourceAudioUrl: string | null;
    clippedCount: number;
    sentenceCount: number;
    lastError: string | null;
  };
}

export default function ShadowReadingPage() {
  const params = useParams();
  const articleId = params.id as string;
  const [article, setArticle] = useState<Article | null>(null);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchArticle() {
      const res = await fetch(`/api/articles/${articleId}`);
      if (res.ok) {
        const data = await res.json();
        setArticle(data);
      }
      setLoading(false);
    }
    fetchArticle();
  }, [articleId]);

  if (loading) {
    return (
      <div className="container-page max-w-4xl py-8 sm:py-10">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-10 w-4/5" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="container-page max-w-4xl py-8 sm:py-10">
        <Card>
          <CardHeader>
            <CardTitle>Article Not Found</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              The requested practice session is unavailable.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (article.originalAudio.status !== "ready") {
    return (
      <div className="container-page max-w-4xl py-8 sm:py-10">
        <Card>
          <CardHeader>
            <CardTitle>Original Audio Not Ready</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm leading-6 text-muted-foreground">
              WSJ narration is {article.originalAudio.status}. Shadow reading opens
              after sentence clips are ready.
            </p>
            <Link
              href={`/articles/${articleId}`}
              className={cn(buttonVariants({ variant: "secondary" }), "w-fit")}
            >
              <ArrowLeft data-icon="inline-start" aria-hidden="true" />
              Back to Article
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const useLyricTimeline = Boolean(
    article.originalAudio.sourceAudioUrl && hasLyricTimeline(article.sentences)
  );

  return (
    <div className="container-page max-w-4xl py-8 sm:py-10">
      <div className="mb-8 border-b pb-6">
        <Link
          href={`/articles/${articleId}`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mb-5")}
        >
          <ArrowLeft data-icon="inline-start" aria-hidden="true" />
          Back to Article
        </Link>

        <div className="flex flex-col gap-3">
          <Badge variant="outline" className="w-fit">
            Shadow Reading Practice
          </Badge>
          <h1 className="text-balance text-3xl font-semibold leading-tight tracking-normal text-foreground">
            {article.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            {article.sentences.length} sentences
          </p>
        </div>
      </div>

      <div className="mb-6">
        {useLyricTimeline && article.originalAudio.sourceAudioUrl ? (
          <LyricSentencePlayer
            sourceAudioUrl={article.originalAudio.sourceAudioUrl}
            sentences={article.sentences}
            onSentenceChange={setCurrentSentenceIndex}
          />
        ) : (
          <SentencePlayer
            sentences={article.sentences}
            onSentenceChange={setCurrentSentenceIndex}
          />
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Record Your Reading</CardTitle>
            <Badge variant="secondary" className="font-mono">
              {currentSentenceIndex + 1}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm leading-6 text-muted-foreground">
            &quot;{article.sentences[currentSentenceIndex]?.text}&quot;
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Radio className="size-3.5" aria-hidden="true" />
            <span>Record once, listen back, then repeat the sentence.</span>
          </div>
          <AudioRecorder />
        </CardContent>
      </Card>
    </div>
  );
}
