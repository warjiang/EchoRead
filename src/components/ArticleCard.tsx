"use client";

import { cn } from "@/lib/utils";
import { BookOpen, Clock } from "lucide-react";
import Link from "next/link";

interface ArticleCardProps {
  id: string;
  title: string;
  category?: string | null;
  difficulty?: string | null;
  publishedAt: string;
  summary?: string | null;
}

const difficultyColors: Record<string, string> = {
  easy: "bg-green-100 text-green-800",
  medium: "bg-yellow-100 text-yellow-800",
  hard: "bg-red-100 text-red-800",
};

export function ArticleCard({ id, title, category, difficulty, publishedAt, summary }: ArticleCardProps) {
  return (
    <Link href={`/articles/${id}`}>
      <div className="border rounded-lg p-5 hover:shadow-md transition-shadow cursor-pointer bg-white">
        <div className="flex items-center gap-2 mb-2">
          {category && (
            <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
              {category}
            </span>
          )}
          {difficulty && (
            <span className={cn("text-xs font-medium px-2 py-0.5 rounded", difficultyColors[difficulty] || "")}>
              {difficulty}
            </span>
          )}
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2 line-clamp-2">{title}</h3>
        {summary && <p className="text-sm text-gray-600 mb-3 line-clamp-2">{summary}</p>}
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {new Date(publishedAt).toLocaleDateString()}
          </span>
          <span className="flex items-center gap-1">
            <BookOpen className="w-3 h-3" />
            Read & Practice
          </span>
        </div>
      </div>
    </Link>
  );
}
