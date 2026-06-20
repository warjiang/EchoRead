"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { generateArticleAudio } from "@/app/actions";
import { SentencePlayer } from "@/components/SentencePlayer";
import { AudioRecorder } from "@/components/AudioRecorder";

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
      <div className="max-w-3xl mx-auto px-4 py-8">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <p className="text-gray-500">Article not found</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link href={`/articles/${articleId}`} className="flex items-center gap-1 text-sm text-gray-500 hover:text-blue-600 mb-4">
        <ArrowLeft className="w-4 h-4" />
        Back to Article
      </Link>

      <h1 className="text-xl font-bold text-gray-900 mb-2">{article.title}</h1>
      <p className="text-sm text-gray-500 mb-6">Shadow Reading Practice • {article.sentences.length} sentences</p>

      {/* Generate audio button */}
      <div className="mb-4">
        <button
          onClick={generateAllAudio}
          disabled={generatingAudio}
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50"
        >
          {generatingAudio ? "Generating Audio..." : "🔊 Generate All Audio"}
        </button>
      </div>

      {/* Sentence player */}
      <div className="mb-6">
        <SentencePlayer
          sentences={article.sentences}
          onSentenceChange={setCurrentSentenceIndex}
        />
      </div>

      {/* Recording section */}
      <div className="border-t pt-4">
        <h3 className="text-sm font-medium text-gray-700 mb-2">
          🎤 Record Your Reading (Sentence {currentSentenceIndex + 1})
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          &quot;{article.sentences[currentSentenceIndex]?.text}&quot;
        </p>
        <AudioRecorder />
      </div>
    </div>
  );
}
