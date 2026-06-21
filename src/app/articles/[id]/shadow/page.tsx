"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Radio, Volume2 } from "lucide-react";
import { generateArticleAudio } from "@/app/actions";
import { SentencePlayer } from "@/components/SentencePlayer";
import { AudioRecorder } from "@/components/AudioRecorder";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface Sentence {
  id: string;
  index: number;
  text: string;
  audioUrl: string | null;
}

interface Article {
  id: string;
  title: string;
  sentences: Sentence[];
}

export default function ShadowReadingPage() {
  const params = useParams();
  const articleId = params.id as string;
  const [article, setArticle] = useState<Article | null>(null);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [generatingAudio, setGeneratingAudio] = useState(false);

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

  const generateAllAudio = async () => {
    setGeneratingAudio(true);
    try {
      await generateArticleAudio(articleId);
      // Refresh article data
      const articleRes = await fetch(`/api/articles/${articleId}`);
      if (articleRes.ok) {
        setArticle(await articleRes.json());
      }
    } finally {
      setGeneratingAudio(false);
    }
  };

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

      <div className="mb-6 flex justify-end">
        <Button
          type="button"
          onClick={generateAllAudio}
          disabled={generatingAudio}
          variant="secondary"
        >
          <Volume2 data-icon="inline-start" aria-hidden="true" />
          {generatingAudio ? "Generating Audio…" : "Generate All Audio"}
        </Button>
      </div>

      <div className="mb-6">
        <SentencePlayer
          sentences={article.sentences}
          onSentenceChange={setCurrentSentenceIndex}
        />
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
