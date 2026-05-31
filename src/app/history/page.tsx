import { prisma } from "@/lib/db";
import { BarChart3, Clock, BookOpen } from "lucide-react";

export default async function HistoryPage() {
  const history = await prisma.readingHistory.findMany({
    orderBy: { createdAt: "desc" },
    include: { article: true },
    take: 50,
  });

  const totalDuration = history.reduce((sum, h) => sum + h.duration, 0);
  const totalArticles = new Set(history.map((h) => h.articleId)).size;
  const shadowCompleted = history.filter((h) => h.shadowDone).length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 mb-6">
        <BarChart3 className="w-6 h-6 text-purple-600" />
        Learning History
      </h1>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-lg border p-4 text-center">
          <BookOpen className="w-5 h-5 text-blue-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-gray-900">{totalArticles}</p>
          <p className="text-xs text-gray-500">Articles Read</p>
        </div>
        <div className="bg-white rounded-lg border p-4 text-center">
          <Clock className="w-5 h-5 text-green-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-gray-900">{Math.round(totalDuration / 60)}</p>
          <p className="text-xs text-gray-500">Minutes Practiced</p>
        </div>
        <div className="bg-white rounded-lg border p-4 text-center">
          <BarChart3 className="w-5 h-5 text-purple-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-gray-900">{shadowCompleted}</p>
          <p className="text-xs text-gray-500">Shadow Completed</p>
        </div>
      </div>

      {/* History list */}
      {history.length === 0 ? (
        <div className="text-center py-16">
          <BarChart3 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No reading history yet. Start reading articles to track your progress.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {history.map((record) => (
            <div key={record.id} className="flex items-center justify-between p-4 bg-white rounded-lg border">
              <div className="flex-1">
                <p className="font-medium text-gray-900 text-sm">{record.article.title}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {new Date(record.createdAt).toLocaleDateString()} •{" "}
                  {Math.round(record.duration / 60)} min •{" "}
                  {Math.round(record.progress * 100)}% complete
                </p>
              </div>
              {record.shadowDone && (
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                  Shadow ✓
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
