'use client'
import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import { Search, Download, Sparkles, Copy, Check, AlertCircle, Play, Clock, Eye, ThumbsUp, MessageCircle } from 'lucide-react'

interface VideoInfo {
  platform: string; title: string; uploader: string; avatar?: string
  duration?: number; views?: number; likes?: number; coins?: number
  favorites?: number; danmakus?: number; description?: string
  thumbnail?: string; bvid?: string; cid?: number; aid?: number
  url: string; subtitles: { lan: string; lan_doc: string; subtitle_url: string }[]
  hasSubtitles: boolean
}

function fmt(n: number) {
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿'
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万'
  return n.toLocaleString()
}

function fmtDur(s: number) {
  const m = Math.floor(s / 60), sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function Home() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [video, setVideo] = useState<VideoInfo | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadResult, setDownloadResult] = useState<{ mode: string; command?: string; message?: string } | null>(null)
  const [tutorialText, setTutorialText] = useState('')
  const [tutorialLoading, setTutorialLoading] = useState(false)
  const [copied, setCopied] = useState('')
  const [activeTab, setActiveTab] = useState<'download' | 'tutorial'>('download')
  const tutorialRef = useRef<HTMLDivElement>(null)

  const copy = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(''), 2000)
  }, [])

  async function analyze() {
    if (!url.trim()) return
    setLoading(true); setError(''); setVideo(null)
    setTutorialText(''); setDownloadResult(null)
    try {
      const r = await fetch('/api/video-info', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setVideo(d)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '解析失败')
    } finally { setLoading(false) }
  }

  async function downloadVideo() {
    if (!video?.bvid || !video?.cid) return
    setDownloading(true); setDownloadResult(null)
    try {
      const r = await fetch('/api/download', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bvid: video.bvid, cid: video.cid }),
      })
      const contentType = r.headers.get('content-type') || ''
      if (contentType.includes('video')) {
        const blob = await r.blob()
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `${video.title}.mp4`
        a.click()
        URL.revokeObjectURL(a.href)
        setDownloadResult({ mode: 'success', message: '下载完成！检查你的下载文件夹 🎉' })
      } else {
        const d = await r.json()
        if (d.mode === 'fallback') {
          setDownloadResult(d)
        } else {
          setDownloadResult({ mode: 'error', message: d.error || '下载失败' })
        }
      }
    } catch (e: unknown) {
      setDownloadResult({ mode: 'error', message: e instanceof Error ? e.message : '下载失败' })
    } finally { setDownloading(false) }
  }

  async function generateTutorial() {
    if (!video) return
    setTutorialLoading(true); setTutorialText(''); setActiveTab('tutorial')

    const subtitleUrl = video.subtitles?.[0]?.subtitle_url || ''
    try {
      const r = await fetch('/api/tutorial', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subtitleUrl, title: video.title, description: video.description,
        }),
      })
      if (!r.ok) {
        const d = await r.json()
        setError(d.error || '教程生成失败')
        setTutorialLoading(false)
        return
      }
      const reader = r.body?.getReader()
      if (!reader) return
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6).trim()
            if (payload === '[DONE]') continue
            try {
              const { text } = JSON.parse(payload)
              if (text) setTutorialText(prev => prev + text)
            } catch { /* skip */ }
          }
        }
        tutorialRef.current?.scrollTo({ top: tutorialRef.current.scrollHeight, behavior: 'smooth' })
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '教程生成失败')
    } finally { setTutorialLoading(false) }
  }

  return (
    <main className="relative z-10 min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-20">

        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass text-xs text-[var(--text-secondary)] mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] animate-pulse" />
            由 yt-dlp + Gemini AI 驱动
          </div>
          <h1 className="text-5xl sm:text-7xl font-black tracking-tight mb-4">
            Bili<span className="text-[var(--accent)]">Helper</span>
          </h1>
          <p className="text-lg text-[var(--text-secondary)] max-w-md mx-auto">
            粘贴视频链接，一键下载到本地 · AI 智能解析生成小白教程
          </p>
        </motion.div>

        {/* Input */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="glass rounded-2xl p-2 mb-8"
        >
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-dim)]" />
              <input
                type="text" value={url} onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && analyze()}
                placeholder="粘贴 B 站或 YouTube 视频链接..."
                className="w-full bg-transparent pl-12 pr-4 py-4 text-[var(--text-primary)] placeholder-[var(--text-dim)] outline-none text-lg"
              />
            </div>
            <button
              onClick={analyze} disabled={loading || !url.trim()}
              className="btn-glow bg-[var(--accent)] hover:bg-[var(--accent)]/90 disabled:opacity-30 disabled:cursor-not-allowed px-8 py-4 rounded-xl font-semibold text-white transition-all whitespace-nowrap"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  解析中
                </span>
              ) : '解析'}
            </button>
          </div>
        </motion.div>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="flex items-center gap-3 glass rounded-xl p-4 mb-6 border-[var(--accent)]/30 border">
              <AlertCircle className="w-5 h-5 text-[var(--accent)] shrink-0" />
              <span className="text-[var(--accent)] text-sm">{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Video Card */}
        <AnimatePresence>
          {video && (
            <motion.div
              initial={{ opacity: 0, y: 30, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="space-y-6"
            >
              {/* Video Info */}
              <div className="glass rounded-2xl overflow-hidden">
                {video.thumbnail && (
                  <div className="relative h-56 sm:h-72 overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={video.thumbnail} alt="" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-deep)] via-transparent to-transparent" />
                    {video.duration && (
                      <div className="absolute bottom-4 right-4 flex items-center gap-1.5 bg-black/70 backdrop-blur-sm px-3 py-1.5 rounded-lg text-sm">
                        <Clock className="w-3.5 h-3.5" />
                        {fmtDur(video.duration)}
                      </div>
                    )}
                    <div className="absolute bottom-4 left-4">
                      <span className="text-xs font-medium bg-[var(--accent)]/90 px-2.5 py-1 rounded-md">
                        {video.platform === 'bilibili' ? 'Bilibili' : 'YouTube'}
                      </span>
                    </div>
                  </div>
                )}
                <div className="p-6">
                  <h2 className="text-xl sm:text-2xl font-bold mb-3 leading-snug">{video.title}</h2>
                  <div className="flex items-center gap-3 mb-4">
                    {video.avatar && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={video.avatar} alt="" className="w-10 h-10 rounded-full ring-2 ring-[var(--border)]" />
                    )}
                    <span className="font-medium text-[var(--text-secondary)]">{video.uploader}</span>
                  </div>
                  {video.views !== undefined && (
                    <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--text-dim)]">
                      <span className="flex items-center gap-1.5"><Eye className="w-4 h-4" />{fmt(video.views)}</span>
                      {video.likes !== undefined && <span className="flex items-center gap-1.5"><ThumbsUp className="w-4 h-4" />{fmt(video.likes)}</span>}
                      {video.danmakus !== undefined && <span className="flex items-center gap-1.5"><MessageCircle className="w-4 h-4" />{fmt(video.danmakus)}</span>}
                    </div>
                  )}
                  {video.description && (
                    <p className="mt-4 text-sm text-[var(--text-dim)] line-clamp-2">{video.description}</p>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={downloadVideo} disabled={downloading || !video.bvid}
                  className="btn-glow glass rounded-xl p-5 text-left group hover:border-[var(--accent)]/30 transition-all disabled:opacity-40"
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-lg bg-[var(--accent)]/10 flex items-center justify-center">
                      <Download className="w-5 h-5 text-[var(--accent)]" />
                    </div>
                    <span className="font-semibold">
                      {downloading ? '下载中...' : '下载视频'}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-dim)]">
                    {video.bvid ? '直接下载 MP4 到本地' : '仅支持 B 站视频'}
                  </p>
                  {downloading && (
                    <div className="mt-3 h-1 bg-[var(--bg-glass)] rounded-full overflow-hidden">
                      <div className="h-full bg-[var(--accent)] rounded-full shimmer" style={{ width: '100%' }} />
                    </div>
                  )}
                </button>
                <button
                  onClick={generateTutorial} disabled={tutorialLoading}
                  className="btn-glow glass rounded-xl p-5 text-left group hover:border-[var(--gold)]/30 transition-all disabled:opacity-40"
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-lg bg-[var(--gold)]/10 flex items-center justify-center">
                      <Sparkles className="w-5 h-5 text-[var(--gold)]" />
                    </div>
                    <span className="font-semibold">
                      {tutorialLoading ? 'AI 生成中...' : 'AI 生成教程'}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-dim)]">
                    {video.hasSubtitles ? '从字幕提取知识点' : '从描述分析内容'}
                  </p>
                  {tutorialLoading && (
                    <div className="mt-3 h-1 bg-[var(--bg-glass)] rounded-full overflow-hidden">
                      <div className="h-full bg-[var(--gold)] rounded-full shimmer" style={{ width: '100%' }} />
                    </div>
                  )}
                </button>
              </div>

              {/* Download Result */}
              <AnimatePresence>
                {downloadResult && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="glass rounded-xl p-5">
                    {downloadResult.mode === 'success' && (
                      <div className="flex items-center gap-3 text-[var(--success)]">
                        <Check className="w-5 h-5" />
                        <span className="font-medium">{downloadResult.message}</span>
                      </div>
                    )}
                    {downloadResult.mode === 'fallback' && (
                      <div>
                        <p className="text-sm text-[var(--text-secondary)] mb-3">
                          ⚠️ {downloadResult.message}
                        </p>
                        <div className="relative">
                          <code className="block text-xs text-[#86efac] bg-black/40 rounded-lg p-4 pr-16 overflow-x-auto">
                            {downloadResult.command}
                          </code>
                          <button
                            onClick={() => copy(downloadResult.command || '', 'dl-cmd')}
                            className="absolute top-3 right-3 text-xs bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded-md transition-colors"
                          >
                            {copied === 'dl-cmd' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    )}
                    {downloadResult.mode === 'error' && (
                      <div className="flex items-center gap-3 text-[var(--accent)]">
                        <AlertCircle className="w-5 h-5" />
                        <span className="text-sm">{downloadResult.message}</span>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Tabs */}
              {(tutorialText || activeTab === 'download') && (
                <div className="flex gap-1 p-1 glass rounded-xl">
                  <button
                    onClick={() => setActiveTab('download')}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'download'
                        ? 'bg-white/5 text-[var(--text-primary)]'
                        : 'text-[var(--text-dim)] hover:text-[var(--text-secondary)]'
                      }`}
                  >
                    📥 下载指令
                  </button>
                  <button
                    onClick={() => setActiveTab('tutorial')}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'tutorial'
                        ? 'bg-white/5 text-[var(--text-primary)]'
                        : 'text-[var(--text-dim)] hover:text-[var(--text-secondary)]'
                      }`}
                  >
                    ✨ AI 教程
                  </button>
                </div>
              )}

              {/* Download Commands Tab */}
              {activeTab === 'download' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
                  {[
                    { label: '🎬 最高画质', cmd: `yt-dlp -f "bestvideo+bestaudio" --merge-output-format mp4 "${video.url}"` },
                    { label: '🎵 仅音频', cmd: `yt-dlp -x --audio-format mp3 "${video.url}"` },
                    ...(video.platform === 'bilibili' ? [
                      { label: '💬 字幕', cmd: `yt-dlp --write-sub --sub-lang zh-CN --skip-download "${video.url}"` },
                    ] : []),
                  ].map(item => (
                    <div key={item.label} className="glass rounded-xl p-4">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm text-[var(--text-secondary)]">{item.label}</span>
                        <button onClick={() => copy(item.cmd, item.label)}
                          className="flex items-center gap-1.5 text-xs text-[var(--text-dim)] hover:text-[var(--text-secondary)] transition-colors">
                          {copied === item.label ? <><Check className="w-3 h-3" /> 已复制</> : <><Copy className="w-3 h-3" /> 复制</>}
                        </button>
                      </div>
                      <code className="block text-xs text-[#86efac] bg-black/30 rounded-lg p-3 overflow-x-auto">{item.cmd}</code>
                    </div>
                  ))}
                </motion.div>
              )}

              {/* Tutorial Tab */}
              {activeTab === 'tutorial' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  ref={tutorialRef}
                  className="glass rounded-xl p-6 sm:p-8 max-h-[70vh] overflow-y-auto"
                >
                  {tutorialText ? (
                    <div className={`tutorial-content ${tutorialLoading ? 'typing-cursor' : ''}`}>
                      <ReactMarkdown>{tutorialText}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="text-center py-12 text-[var(--text-dim)]">
                      <Sparkles className="w-8 h-8 mx-auto mb-3 opacity-30" />
                      <p>点击上方「AI 生成教程」按钮开始</p>
                    </div>
                  )}
                  {tutorialText && !tutorialLoading && (
                    <div className="mt-6 pt-4 border-t border-[var(--border)]">
                      <button onClick={() => copy(tutorialText, 'tutorial')}
                        className="text-sm text-[var(--gold)] hover:text-[var(--gold)]/80 flex items-center gap-2 transition-colors">
                        {copied === 'tutorial' ? <><Check className="w-4 h-4" /> 已复制完整教程</> : <><Copy className="w-4 h-4" /> 复制完整教程 (Markdown)</>}
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
          className="text-center mt-20 text-xs text-[var(--text-dim)]"
        >
          <p className="flex items-center justify-center gap-2">
            <Play className="w-3 h-3" />
            Powered by <a href="https://github.com/yt-dlp/yt-dlp" className="text-[var(--accent)] hover:underline" target="_blank" rel="noopener noreferrer">yt-dlp</a>
            · B 站 API · Gemini AI
          </p>
          <p className="mt-1">仅供学习交流使用</p>
        </motion.div>
      </div>
    </main>
  )
}
