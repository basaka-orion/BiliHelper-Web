import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BiliHelper — 视频学习笔记",
  description:
    "把这一节，整理成下次用得上的学习笔记。支持 B 站与 YouTube、分 P 导航、来源核对、本机保存、个人备注和 Markdown 导出。",
  keywords: "bilibili, youtube, 学习笔记, 视频学习, 字幕, Markdown",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
