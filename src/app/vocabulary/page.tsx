import { prisma } from "@/lib/db";
import { VocabularyMasteryButton } from "@/components/VocabularyActions";
import { BookOpen, X } from "lucide-react";

export default async function VocabularyPage() {
  const words = await prisma.vocabulary.findMany({
    orderBy: { createdAt: "desc" },
  });

  const mastered = words.filter((w) => w.mastered);
  const learning = words.filter((w) => !w.mastered);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 mb-2">
        <BookOpen className="w-6 h-6 text-green-600" />
        Vocabulary Book
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        {words.length} words collected • {mastered.length} mastered
      </p>

      {words.length === 0 ? (
        <div className="text-center py-16">
          <BookOpen className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No words saved yet. Click on words while reading to add them.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {learning.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-800 mb-3">📚 Learning ({learning.length})</h2>
              <div className="grid gap-2">
                {learning.map((word) => (
                  <div key={word.id} className="flex items-center justify-between p-3 bg-white rounded-lg border">
                    <div>
                      <span className="font-medium text-gray-900">{word.word}</span>
                      {word.definition && (
                        <p className="text-sm text-gray-600 mt-0.5">{word.definition}</p>
                      )}
                      {word.context && (
                        <p className="text-xs text-gray-400 italic mt-0.5">&quot;...{word.context}...&quot;</p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <VocabularyMasteryButton id={word.id} mastered={true} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {mastered.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-800 mb-3">✅ Mastered ({mastered.length})</h2>
              <div className="grid gap-2">
                {mastered.map((word) => (
                  <div key={word.id} className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-100">
                    <div>
                      <span className="font-medium text-gray-700 line-through">{word.word}</span>
                      {word.definition && (
                        <p className="text-sm text-gray-500 mt-0.5">{word.definition}</p>
                      )}
                    </div>
                    <X className="w-4 h-4 text-gray-400" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
