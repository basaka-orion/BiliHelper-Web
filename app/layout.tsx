import type { Metadata } from "next";
import "./globals.css";


export const metadata: Metadata = {
  title: "BiliHelper — 视频解析 · AI 教程",
  description: "粘贴链接，一键解析 B 站 / YouTube 视频。AI 智能生成小白教程。支持字幕来源选择、学习笔记导出和本机下载指令。",
  keywords: "bilibili, youtube, 视频下载, AI教程, yt-dlp",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" >
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
