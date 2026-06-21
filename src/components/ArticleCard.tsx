"use client";

import type * as React from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ArrowRight, BookOpen, Clock } from "lucide-react";
import Link from "next/link";

interface ArticleCardProps {
  id: string;
  title: string;
  category?: string | null;
  difficulty?: string | null;
  publishedAt: string;
  summary?: string | null;
}

const difficultyVariants: Record<
  string,
  React.ComponentProps<typeof Badge>["variant"]
> = {
  easy: "secondary",
  medium: "outline",
  hard: "destructive",
};

export function ArticleCard({
  id,
  title,
  category,
  difficulty,
  publishedAt,
  summary,
}: ArticleCardProps) {
  return (
    <Link href={`/articles/${id}`} className="group block focus-visible:outline-none">
      <Card className="h-full transition-colors group-hover:bg-muted/30 group-focus-visible:ring-3 group-focus-visible:ring-ring/50">
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {category && (
                <Badge variant="outline" className="max-w-full truncate">
                  {category}
                </Badge>
              )}
              {difficulty && (
                <Badge
                  variant={difficultyVariants[difficulty] || "secondary"}
                  className={cn("capitalize")}
                >
                  {difficulty}
                </Badge>
              )}
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
              <Clock className="size-3.5" aria-hidden="true" />
              {new Date(publishedAt).toLocaleDateString()}
            </span>
          </div>
          <CardTitle className="line-clamp-2 text-lg leading-snug transition-colors group-hover:text-foreground">
            {title}
          </CardTitle>
        </CardHeader>
        {summary && (
          <CardContent>
            <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
              {summary}
            </p>
          </CardContent>
        )}
        <Separator />
        <CardFooter className="justify-between gap-4 border-t-0 bg-transparent text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <BookOpen className="size-3.5" aria-hidden="true" />
            Read & Practice
          </span>
          <ArrowRight
            className="size-3.5 transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </CardFooter>
      </Card>
    </Link>
  );
}
