import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Shadow Reading - Learn English with WSJ",
  description: "Practice English shadow reading with daily WSJ news articles",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-gray-50">
        <nav className="bg-white border-b px-6 py-3 flex items-center justify-between">
          <a href="/" className="text-xl font-bold text-blue-600">📖 Shadow Reading</a>
          <div className="flex items-center gap-4 text-sm">
            <a href="/" className="text-gray-600 hover:text-blue-600">Articles</a>
            <a href="/vocabulary" className="text-gray-600 hover:text-blue-600">Vocabulary</a>
            <a href="/history" className="text-gray-600 hover:text-blue-600">History</a>
          </div>
        </nav>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
