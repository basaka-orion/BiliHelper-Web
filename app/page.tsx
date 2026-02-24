"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, ArrowRight, Download, BookOpen, ExternalLink, Copy, Check, Clock, Eye, ThumbsUp } from "lucide-react";
import ReactMarkdown from 'react-markdown';

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [videoInfo, setVideoInfo] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"download" | "tutorial">("download");
  const [copied, setCopied] = useState(false);

  const handleFetch = async () => {
    if (!url) return;
    setLoading(true);
    setVideoInfo(null);
    try {
      const res = await fetch("/api/video-info", {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
      } else {
        setVideoInfo(data);
      }
    } catch (e) {
      alert("网络错误");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatDuration = (s: number) => {
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return `${min}:${sec.toString().padStart(2, "0")}`;
  };

  const tutorialContent = videoInfo ? `
# 如何下载《${videoInfo.title}》

这是一份为您准备的简易下载攻略。

### 第一步：安装工具
如果您是第一次下载，需要先安装开源工具 **yt-dlp**：
- **Windows**: 下载 [yt-dlp.exe](https://github.com/yt-dlp/yt-dlp/releases) 并放入文件夹。
- **macOS**: 在终端运行 \`brew install yt-dlp\`。

### 第二步：复制下载指令
点击“下载指令”标签页，复制为您生成的专用命令。

### 第三步：开始下载
打开终端（命令行），粘贴刚才复制的命令并回车。

---
*本教程由 BiliHelper 为视频《${videoInfo.title}》自动生成。*
` : "";

  return (
    <main className="min-h-screen flex flex-col items-center p-6 md:p-24 relative overflow-hidden">
      {/* Bg Decor */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[500px] bg-[#FB7299] opacity-[0.03] blur-[120px] pointer-events-none rounded-full" />

      {/* Header */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-12"
      >
        <h1 className="text-4xl md:text-6xl font-black tracking-tighter mb-4 text-white">
          Bili<span className="text-[#FB7299]">Helper</span>
        </h1>
        <p className="text-zinc-500 font-medium">真正能用的 B 站 / YouTube 视频助手</p>
      </motion.div>

      {/* Input Section */}
      <div className="w-full max-w-2xl mb-12">
        <div className="glass-card p-2 rounded-2xl flex items-center gap-2 glow-pink">
          <div className="pl-4 text-zinc-500">
            <Search size={20} />
          </div>
          <input 
            type="text"
            placeholder="粘贴视频链接 (支持 BV号, b23.tv, YouTube)"
            className="flex-1 bg-transparent border-none focus:ring-0 text-zinc-100 py-3 outline-none"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleFetch()}
          />
          <button 
            onClick={handleFetch}
            disabled={loading || !url}
            className="bg-[#FB7299] hover:bg-[#ff85a9] text-white px-6 py-3 rounded-xl font-bold transition-all disabled:opacity-50"
          >
            {loading ? "正在解析..." : "解析"}
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {videoInfo ? (
          <motion.div 
            key="result"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-4xl space-y-8"
          >
            {/* Info Card */}
            <div className="glass-card rounded-3xl overflow-hidden flex flex-col md:flex-row shadow-2xl">
              <div className="md:w-2/5 aspect-video relative group">
                <img 
                   src={videoInfo.thumbnail} 
                   alt={videoInfo.title} 
                   className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                   <a href={videoInfo.url} target="_blank" className="bg-white/20 backdrop-blur-md p-3 rounded-full">
                     <ExternalLink size={24} className="text-white" />
                   </a>
                </div>
              </div>
              <div className="p-8 flex-1 flex flex-col justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-white mb-2 leading-tight">{videoInfo.title}</h2>
                  <div className="flex items-center gap-4 text-zinc-400 text-sm mb-4">
                    <span className="flex items-center gap-1"><Clock size={14} /> {formatDuration(videoInfo.duration || 0)}</span>
                    <span className="flex items-center gap-1"><Eye size={14} /> {videoInfo.views?.toLocaleString()} 播放</span>
                    <span className="flex items-center gap-1"><ThumbsUp size={14} /> {videoInfo.likes?.toLocaleString()} 赞</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-4 pt-4 border-t border-white/5">
                  {videoInfo.avatar && <img src={videoInfo.avatar} className="w-8 h-8 rounded-full" />}
                  <span className="text-zinc-300 font-semibold">{videoInfo.uploader}</span>
                </div>
              </div>
            </div>

            {/* Tabs & Content */}
            <div className="space-y-4">
              <div className="flex gap-2">
                <button 
                  onClick={() => setActiveTab("download")}
                  className={cn(
                    "px-6 py-2 rounded-full font-bold transition-all flex items-center gap-2",
                    activeTab === "download" ? "bg-white text-black" : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
                  )}
                >
                  <Download size={18} /> 下载指令
                </button>
                <button 
                  onClick={() => setActiveTab("tutorial")}
                  className={cn(
                    "px-6 py-2 rounded-full font-bold transition-all flex items-center gap-2",
                    activeTab === "tutorial" ? "bg-white text-black" : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
                  )}
                >
                  <BookOpen size={18} /> 小白攻略
                </button>
              </div>

              <div className="glass-card rounded-3xl p-8 min-h-[300px]">
                {activeTab === "download" ? (
                  <div className="space-y-6">
                    <div>
                      <label className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-3 block">基础下载命令 (8K/HDR/4K)</label>
                      <div className="bg-black/50 p-6 rounded-2xl font-mono text-[#FB7299] relative group">
                        <code className="break-all block pr-12">
                          yt-dlp -f "bestvideo+bestaudio" --merge-output-format mp4 "{videoInfo.url}"
                        </code>
                        <button 
                          onClick={() => copyToClipboard(`yt-dlp -f "bestvideo+bestaudio" --merge-output-format mp4 "${videoInfo.url}"`)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition-colors"
                        >
                          {copied ? <Check size={18} className="text-green-500" /> : <Copy size={18} />}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       <div className="bg-zinc-900/50 p-4 rounded-xl border border-white/5">
                         <p className="text-xs text-zinc-500 mb-2 uppercase font-bold">仅下载音频 (MP3)</p>
                         <code className="text-sm text-zinc-300 break-all">yt-dlp -x --audio-format mp3 "{videoInfo.url}"</code>
                       </div>
                       {videoInfo.platform === 'bilibili' && (
                         <div className="bg-zinc-900/50 p-4 rounded-xl border border-white/5">
                           <p className="text-xs text-zinc-500 mb-2 uppercase font-bold">仅下载中文字幕</p>
                           <code className="text-sm text-zinc-300 break-all">yt-dlp --write-sub --sub-lang zh-CN --skip-download "{videoInfo.url}"</code>
                         </div>
                       )}
                    </div>
                  </div>
                ) : (
                  <article className="prose prose-invert max-w-none">
                    <ReactMarkdown>{tutorialContent}</ReactMarkdown>
                  </article>
                )}
              </div>
            </div>
          </motion.div>
        ) : loading ? (
          <div className="w-full max-w-4xl space-y-8 animate-pulse">
            <div className="h-64 bg-zinc-900 rounded-3xl" />
            <div className="space-y-4">
              <div className="h-10 bg-zinc-900 w-48 rounded-full" />
              <div className="h-80 bg-zinc-900 rounded-3xl" />
            </div>
          </div>
        ) : null}
      </AnimatePresence>
    </main>
  );
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(" ");
}
