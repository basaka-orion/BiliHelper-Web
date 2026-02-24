import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "BiliHelper — 视频解析 · AI 教程",
  description: "粘贴链接，一键解析 B 站 / YouTube 视频。AI 智能生成小白教程。由 yt-dlp + Gemini AI 驱动。",
  keywords: "bilibili, youtube, 视频下载, AI教程, yt-dlp",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={inter.variable}>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
