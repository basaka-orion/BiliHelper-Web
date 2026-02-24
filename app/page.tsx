'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import { Search, Download, Sparkles, Copy, Check, AlertCircle, Clock, Eye, ThumbsUp, MessageCircle, ChevronDown, ChevronUp, Zap, FileText, ExternalLink } from 'lucide-react'

/* ─── Types ─── */
interface VideoInfo {
  platform: string; title: string; uploader: string; avatar?: string
  duration?: number; views?: number; likes?: number; coins?: number
  favorites?: number; danmakus?: number; description?: string
  thumbnail?: string; bvid?: string; cid?: number; aid?: number
  url: string; subtitles: { lan: string; lan_doc: string; subtitle_url: string }[]
  hasSubtitles: boolean
}

/* ─── Helpers ─── */
function fmt(n: number) {
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿'
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万'
  return n.toLocaleString()
}
function fmtDur(s: number) {
  const m = Math.floor(s / 60), sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}
function proxyImg(url: string) {
  if (!url) return ''
  return `/api/image-proxy?url=${encodeURIComponent(url)}`
}

/* ─── Animations ─── */
const fadeUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] },
}
const stagger = {
  animate: { transition: { staggerChildren: 0.12 } },
}

/* ─── Mouse Glow Hook ─── */
function useMouseGlow(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const handler = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect()
      el.style.setProperty('--mx', `${e.clientX - rect.left}px`)
      el.style.setProperty('--my', `${e.clientY - rect.top}px`)
    }
    el.addEventListener('mousemove', handler)
    return () => el.removeEventListener('mousemove', handler)
  }, [ref])
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
  const [descExpanded, setDescExpanded] = useState(false)
  const tutorialRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLElement>(null)

  useMouseGlow(heroRef)

  const copy = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(''), 2000)
  }, [])

  async function analyze() {
    if (!url.trim()) return
    setLoading(true); setError(''); setVideo(null)
    setTutorialText(''); setDownloadResult(null); setDescExpanded(false)
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
        body: JSON.stringify({ subtitleUrl, title: video.title, description: video.description, videoUrl: video.url }),
      })
      if (!r.ok) { const d = await r.json(); setError(d.error || '教程生成失败'); setTutorialLoading(false); return }
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
            try { const { text } = JSON.parse(payload); if (text) setTutorialText(prev => prev + text) } catch { /* skip */ }
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

      {/* ═══════════ HERO — Full viewport, extreme typography ═══════════ */}
      <section
        ref={heroRef}
        className="hero-section relative min-h-[100vh] flex flex-col items-center justify-center px-4 sm:px-6 overflow-hidden"
      >
        {/* Mouse-following glow */}
        <div className="mouse-glow" />

        {/* Floating accent orbs */}
        <div className="absolute top-[15%] left-[20%] w-[400px] h-[400px] rounded-full bg-[var(--accent-deep)] opacity-[0.03] blur-[150px] float-slow pointer-events-none" />
        <div className="absolute bottom-[20%] right-[15%] w-[300px] h-[300px] rounded-full bg-[var(--gold)] opacity-[0.02] blur-[120px] float-slow pointer-events-none" style={{ animationDelay: '-4s' }} />

        <motion.div {...stagger} initial="initial" animate="animate" className="text-center w-full max-w-4xl mx-auto">

          {/* Micro badge */}
          <motion.div {...fadeUp} className="inline-flex items-center gap-2.5 px-5 py-2 rounded-full glass text-[11px] tracking-[0.15em] uppercase text-[var(--text-dim)] mb-10 font-medium">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--success)] opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--success)]" />
            </span>
            yt-dlp + AI 驱动
          </motion.div>

          {/* ─── EXTREME Title ─── */}
          <motion.h1
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.1 }}
            className="font-display font-bold tracking-[-0.04em] mb-6 leading-[0.9]"
            style={{ fontSize: 'clamp(3.5rem, 10vw, 8rem)' }}
          >
            <span className="bg-clip-text text-transparent bg-gradient-to-b from-white via-[#e8e8ed] to-[var(--text-dim)]">
              Bili
            </span>
            <span className="bg-clip-text text-transparent bg-gradient-to-b from-[var(--accent-bright)] via-[var(--accent)] to-[var(--accent-deep)]">
              Helper
            </span>
          </motion.h1>

          {/* Subtitle — restrained, high contrast with title */}
          <motion.p
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.2 }}
            className="text-base sm:text-lg text-[var(--text-dim)] max-w-md mx-auto mb-14 leading-relaxed font-light tracking-wide"
          >
            粘贴链接，<span className="text-[var(--text-secondary)]">解码一切</span>。
            <br />
            <span className="text-[0.8rem]">AI 智能教程 · 离线下载 · 零门槛</span>
          </motion.p>

          {/* ─── Search Bar — Elevated glass terminal ─── */}
          <motion.div
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.3 }}
            className="w-full max-w-2xl mx-auto"
          >
            <div className="search-container glass-elevated rounded-2xl p-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-dim)]" />
                  <input
                    type="text" value={url} onChange={e => setUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && analyze()}
                    placeholder="粘贴 B 站或 YouTube 视频链接..."
                    className="w-full bg-transparent pl-12 pr-4 py-4 sm:py-5 text-[var(--text-primary)] placeholder-[var(--text-dim)] outline-none text-base font-light tracking-wide"
                  />
                </div>
                <button
                  onClick={analyze} disabled={loading || !url.trim()}
                  className="btn-primary disabled:opacity-30 disabled:cursor-not-allowed disabled:transform-none px-8 sm:px-10 py-4 sm:py-5 text-sm font-semibold whitespace-nowrap rounded-xl tracking-wide uppercase"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                      解析中
                    </span>
                  ) : '解析'}
                </button>
              </div>
            </div>

            {/* Feature pills — asymmetric */}
            <motion.div
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: 0.5 }}
              className="flex items-center justify-center gap-8 mt-8 text-[11px] tracking-[0.12em] uppercase text-[var(--text-dim)] font-medium"
            >
              <span className="flex items-center gap-2"><Zap className="w-3 h-3 text-[var(--accent)]" />秒级解析</span>
              <span className="w-[1px] h-3 bg-[var(--border)]" />
              <span className="flex items-center gap-2"><Download className="w-3 h-3 text-[var(--accent)]" />离线下载</span>
              <span className="w-[1px] h-3 bg-[var(--border)]" />
              <span className="flex items-center gap-2"><Sparkles className="w-3 h-3 text-[var(--gold)]" />AI 教程</span>
            </motion.div>
          </motion.div>
        </motion.div>
      </section>

      {/* ═══════════ CONTENT AREA ═══════════ */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pb-32">

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="flex items-center gap-3 glass rounded-xl p-4 mb-6 border-[var(--danger)]/20 border">
              <AlertCircle className="w-5 h-5 text-[var(--danger)] shrink-0" />
              <span className="text-[var(--danger)] text-sm">{error}</span>
              <button onClick={() => setError('')} className="ml-auto text-[var(--text-dim)] hover:text-white text-xs">✕</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ═══════════ VIDEO CARD — Asymmetric Bento ═══════════ */}
        <AnimatePresence>
          {video && (
            <motion.div
              initial={{ opacity: 0, y: 40, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="space-y-4"
            >
              {/* Video Info — Cinematic card */}
              <div className="glass-elevated rounded-2xl overflow-hidden">
                {video.thumbnail && (
                  <div className="relative h-48 sm:h-72 overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={proxyImg(video.thumbnail)}
                      alt={video.title}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-deep)] via-[var(--bg-deep)]/50 to-transparent" />

                    {/* Overlay pills */}
                    <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.2em] bg-[var(--accent-deep)]/90 backdrop-blur-sm px-3 py-1.5 rounded-lg text-white/90">
                        {video.platform === 'bilibili' ? 'Bilibili' : 'YouTube'}
                      </span>
                      {video.duration && (
                        <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-lg text-sm text-white/80 font-mono">
                          <Clock className="w-3.5 h-3.5" />
                          {fmtDur(video.duration)}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="p-6 sm:p-8">
                  <h2 className="font-display text-xl sm:text-2xl font-bold leading-snug mb-4 tracking-tight">{video.title}</h2>

                  <div className="flex items-center gap-3 mb-5">
                    {video.avatar && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={proxyImg(video.avatar)} alt="" className="w-9 h-9 rounded-full ring-2 ring-[var(--border)]" />
                    )}
                    <span className="text-sm font-medium text-[var(--text-secondary)]">{video.uploader}</span>
                    {video.url && (
                      <a href={video.url} target="_blank" rel="noopener noreferrer"
                        className="ml-auto text-[var(--text-dim)] hover:text-[var(--accent)] transition-colors">
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                  </div>

                  {/* Stats row */}
                  {video.views !== undefined && (
                    <div className="flex flex-wrap gap-2 mb-4">
                      <span className="stat-pill"><Eye className="w-3.5 h-3.5" />{fmt(video.views)}</span>
                      {video.likes !== undefined && <span className="stat-pill"><ThumbsUp className="w-3.5 h-3.5" />{fmt(video.likes)}</span>}
                      {video.danmakus !== undefined && <span className="stat-pill"><MessageCircle className="w-3.5 h-3.5" />{fmt(video.danmakus)}</span>}
                    </div>
                  )}

                  {/* Description — Expandable */}
                  {video.description && (
                    <div className="mt-4">
                      <p className={`text-sm text-[var(--text-dim)] leading-relaxed whitespace-pre-wrap ${!descExpanded ? 'line-clamp-3' : ''}`}>
                        {video.description}
                      </p>
                      {video.description.length > 100 && (
                        <button
                          onClick={() => setDescExpanded(!descExpanded)}
                          className="flex items-center gap-1 mt-2 text-xs text-[var(--accent)] hover:text-[var(--accent-bright)] transition-colors font-medium"
                        >
                          {descExpanded ? <><ChevronUp className="w-3 h-3" />收起</> : <><ChevronDown className="w-3 h-3" />展开全部</>}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ─── Action Bento Grid — Asymmetric 2-col ─── */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={downloadVideo} disabled={downloading || !video.bvid}
                  className="glass glow-border rounded-2xl p-5 sm:p-6 text-left group transition-all disabled:opacity-30 hover:bg-[var(--bg-glass-hover)]"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-11 h-11 rounded-xl bg-[var(--accent)]/10 border border-[var(--accent)]/20 flex items-center justify-center group-hover:bg-[var(--accent)]/20 transition-colors">
                      <Download className="w-5 h-5 text-[var(--accent)]" />
                    </div>
                    <span className="font-display font-semibold text-[15px]">
                      {downloading ? '下载中...' : '下载视频'}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-dim)] leading-relaxed">
                    {video.bvid ? '直接下载 MP4 到本地' : '仅支持 B 站视频'}
                  </p>
                  {downloading && (
                    <div className="mt-4 h-1 bg-[var(--bg-glass)] rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-[var(--accent-deep)] to-[var(--accent)] rounded-full shimmer" style={{ width: '100%' }} />
                    </div>
                  )}
                </button>

                <button
                  onClick={generateTutorial} disabled={tutorialLoading}
                  className="glass glow-border rounded-2xl p-5 sm:p-6 text-left group transition-all disabled:opacity-30 hover:bg-[var(--bg-glass-hover)]"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-11 h-11 rounded-xl bg-[var(--gold)]/10 border border-[var(--gold)]/20 flex items-center justify-center group-hover:bg-[var(--gold)]/20 transition-colors">
                      <Sparkles className="w-5 h-5 text-[var(--gold)]" />
                    </div>
                    <span className="font-display font-semibold text-[15px]">
                      {tutorialLoading ? 'AI 生成中...' : 'AI 教程'}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-dim)] leading-relaxed">
                    {video.hasSubtitles ? '从字幕提取知识点' : '从描述智能分析'}
                  </p>
                  {tutorialLoading && (
                    <div className="mt-4 h-1 bg-[var(--bg-glass)] rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-[var(--gold)] to-[#fbbf24] rounded-full shimmer" style={{ width: '100%' }} />
                    </div>
                  )}
                </button>
              </div>

              {/* Download Result */}
              <AnimatePresence>
                {downloadResult && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="glass rounded-2xl p-5">
                    {downloadResult.mode === 'success' && (
                      <div className="flex items-center gap-3 text-[var(--success)]">
                        <Check className="w-5 h-5" />
                        <span className="font-medium">{downloadResult.message}</span>
                      </div>
                    )}
                    {downloadResult.mode === 'fallback' && (
                      <div>
                        <p className="text-sm text-[var(--text-secondary)] mb-3">⚠️ {downloadResult.message}</p>
                        <div className="relative">
                          <code className="block font-mono text-xs text-[var(--success)] bg-black/40 rounded-xl p-4 pr-16 overflow-x-auto border border-[var(--border)]">
                            {downloadResult.command}
                          </code>
                          <button
                            onClick={() => copy(downloadResult.command || '', 'dl-cmd')}
                            className="absolute top-3 right-3 text-xs bg-white/5 hover:bg-white/10 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            {copied === 'dl-cmd' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    )}
                    {downloadResult.mode === 'error' && (
                      <div className="flex items-center gap-3 text-[var(--danger)]">
                        <AlertCircle className="w-5 h-5" />
                        <span className="text-sm">{downloadResult.message}</span>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ─── Tabs ─── */}
              {(tutorialText || activeTab === 'download') && (
                <div className="flex gap-1 p-1.5 glass rounded-xl">
                  {[
                    { key: 'download' as const, icon: FileText, label: '下载指令' },
                    { key: 'tutorial' as const, icon: Sparkles, label: 'AI 教程' },
                  ].map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === tab.key
                        ? 'bg-[var(--bg-glass-hover)] text-[var(--text-primary)] shadow-sm'
                        : 'text-[var(--text-dim)] hover:text-[var(--text-secondary)]'
                        }`}
                    >
                      <tab.icon className="w-4 h-4" />
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Download Commands Tab */}
              {activeTab === 'download' && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                  {[
                    { label: '最高画质', icon: '🎬', cmd: `yt-dlp -f "bestvideo+bestaudio" --merge-output-format mp4 "${video.url}"` },
                    { label: '仅音频', icon: '🎵', cmd: `yt-dlp -x --audio-format mp3 "${video.url}"` },
                    ...(video.platform === 'bilibili' ? [
                      { label: '字幕', icon: '💬', cmd: `yt-dlp --write-sub --sub-lang zh-CN --skip-download "${video.url}"` },
                    ] : []),
                  ].map(item => (
                    <div key={item.label} className="glass rounded-xl p-4 hover:bg-[var(--bg-glass-hover)] transition-colors">
                      <div className="flex justify-between items-center mb-2.5">
                        <span className="text-sm text-[var(--text-secondary)] flex items-center gap-2">
                          <span>{item.icon}</span> {item.label}
                        </span>
                        <button onClick={() => copy(item.cmd, item.label)}
                          className="flex items-center gap-1.5 text-xs text-[var(--text-dim)] hover:text-[var(--accent)] transition-colors px-2 py-1 rounded-md hover:bg-[var(--bg-glass)]">
                          {copied === item.label ? <><Check className="w-3 h-3" /> 已复制</> : <><Copy className="w-3 h-3" /> 复制</>}
                        </button>
                      </div>
                      <code className="block font-mono text-xs text-[var(--success)] bg-black/30 rounded-lg p-3 overflow-x-auto border border-[var(--border)]">{item.cmd}</code>
                    </div>
                  ))}
                </motion.div>
              )}

              {/* Tutorial Tab */}
              {activeTab === 'tutorial' && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  ref={tutorialRef}
                  className="glass-elevated rounded-2xl p-6 sm:p-8 max-h-[70vh] overflow-y-auto"
                >
                  {tutorialText ? (
                    <div className={`tutorial-content ${tutorialLoading ? 'typing-cursor' : ''}`}>
                      <ReactMarkdown>{tutorialText}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="text-center py-16 text-[var(--text-dim)]">
                      <div className="w-16 h-16 rounded-2xl bg-[var(--gold)]/5 border border-[var(--gold)]/10 flex items-center justify-center mx-auto mb-4">
                        <Sparkles className="w-7 h-7 opacity-40 text-[var(--gold)]" />
                      </div>
                      <p className="text-sm">点击上方「AI 教程」按钮开始</p>
                    </div>
                  )}
                  {tutorialText && !tutorialLoading && (
                    <div className="mt-6 pt-4 border-t border-[var(--border)]">
                      <button onClick={() => copy(tutorialText, 'tutorial')}
                        className="text-sm text-[var(--accent)] hover:text-[var(--accent-bright)] flex items-center gap-2 transition-colors">
                        {copied === 'tutorial' ? <><Check className="w-4 h-4" /> 已复制完整教程</> : <><Copy className="w-4 h-4" /> 复制完整教程 (Markdown)</>}
                      </button>
                    </div>
                  )}
                </motion.div>
              )}

            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ═══════════ FOOTER — Minimal, structured ═══════════ */}
      <footer className="relative z-10 border-t border-[var(--border)]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] tracking-[0.1em] uppercase text-[var(--text-dim)]">
          <p className="flex items-center gap-3">
            Powered by{' '}
            <a href="https://github.com/yt-dlp/yt-dlp" className="text-[var(--accent)] hover:text-[var(--accent-bright)] transition-colors" target="_blank" rel="noopener noreferrer">yt-dlp</a>
            <span className="text-[var(--border)]">·</span> B 站 API
            <span className="text-[var(--border)]">·</span> Qwen AI
          </p>
          <p>仅供学习交流使用</p>
        </div>
      </footer>
    </main>
  )
}
