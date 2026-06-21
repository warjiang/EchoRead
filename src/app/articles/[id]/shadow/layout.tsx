import type { Metadata } from "next";
import type { ReactNode } from "react";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

interface Props {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

interface MetadataProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: MetadataProps): Promise<Metadata> {
  const { id } = await params;
  const article = await db.query.articles.findFirst({
    where: eq(schema.articles.id, id),
    columns: {
      title: true,
    },
  });

  return {
    title: article ? `Shadow Reading: ${article.title}` : "Shadow Reading",
    description:
      "Practice sentence-by-sentence shadow reading with WSJ narration in EchoRead.",
  };
}

export default function ShadowReadingLayout({ children }: Props) {
  return children;
}
