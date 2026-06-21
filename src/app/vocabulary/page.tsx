import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { VocabularyMasteryButton } from "@/components/VocabularyActions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { BookOpen, Check } from "lucide-react";

export default async function VocabularyPage() {
  const words = await db.query.vocabulary.findMany({
    orderBy: desc(schema.vocabulary.createdAt),
  });

  const mastered = words.filter((w) => w.mastered);
  const learning = words.filter((w) => !w.mastered);

  return (
    <div className="container-page max-w-4xl py-8 sm:py-10">
      <div className="mb-8 flex flex-col gap-3 border-b pb-6">
        <Badge variant="outline" className="w-fit">
          Vocabulary
        </Badge>
        <h1 className="text-3xl font-semibold leading-tight tracking-normal text-foreground">
          Vocabulary Book
        </h1>
        <p className="text-sm text-muted-foreground">
          {words.length} words collected, {mastered.length} mastered
        </p>
      </div>

      {words.length === 0 ? (
        <Empty className="min-h-[320px] border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookOpen aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No Saved Words</EmptyTitle>
            <EmptyDescription>
              Click words while reading to add them here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-6">
          {learning.length > 0 && (
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium text-foreground">Learning</h2>
                <Badge variant="secondary">{learning.length}</Badge>
              </div>
              <div className="grid gap-2">
                {learning.map((word) => (
                  <Card key={word.id} size="sm">
                    <CardContent className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">
                          {word.word}
                        </p>
                        {word.definition && (
                          <p className="mt-1 text-sm leading-6 text-muted-foreground">
                            {word.definition}
                          </p>
                        )}
                        {word.context && (
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                            &quot;...{word.context}...&quot;
                          </p>
                        )}
                      </div>
                      <VocabularyMasteryButton id={word.id} mastered={true} />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {mastered.length > 0 && (
            <section className="flex flex-col gap-3">
              {learning.length > 0 && <Separator />}
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium text-foreground">Mastered</h2>
                <Badge variant="secondary">{mastered.length}</Badge>
              </div>
              <div className="grid gap-2">
                {mastered.map((word) => (
                  <Card key={word.id} size="sm" className="bg-muted/40">
                    <CardContent className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-medium text-muted-foreground line-through">
                          {word.word}
                        </p>
                        {word.definition && (
                          <p className="mt-1 text-sm leading-6 text-muted-foreground">
                            {word.definition}
                          </p>
                        )}
                      </div>
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
                        <Check className="size-4" aria-hidden="true" />
                      </span>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
