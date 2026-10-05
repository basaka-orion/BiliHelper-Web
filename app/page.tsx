'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import { downloadCommand } from '../lib/video-url'
import { readSSE } from '../lib/sse'
import { browserVideoInfo } from '../lib/browser-bili'
import { Search, Download, Sparkles, Copy, Check, AlertCircle, Clock, Eye, ThumbsUp, MessageCircle, ChevronDown, ChevronUp, Zap, FileText, ExternalLink } from 'lucide-react'

/* ─── Types ─── */
interface VideoInfo {
  platform: string; title: string; uploader: string; avatar?: string
  duration?: number; views?: number; likes?: number; coins?: number
  favorites?: number; danmakus?: number; description?: string
  thumbnail?: string; bvid?: string; cid?: number; aid?: number
  url: string; subtitles: { lan: string; lan_doc: string; subtitle_url: string }[]
  hasSubtitles: boolean; subtitleNotice?: string; pages?: { cid: number; page: number; title: string; duration: number }[]; selectedPage?: number
}

/* ─── Helpers ─── */
function fmt(n: number) {
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿'
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万'
  return n.toLocaleString()
}
function fmtDur(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = Math.floor(s) % 60
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(sec).padStart(2, '0')}`
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
  const [transcript, setTranscript] = useState('')
  const [subtitleIndex, setSubtitleIndex] = useState('auto')
  const [tutorialStatus, setTutorialStatus] = useState('')
  const [tutorialSource, setTutorialSource] = useState('')
  const [tutorialError, setTutorialError] = useState('')
  const [history, setHistory] = useState<{ url: string; title: string }[]>([])
  const contentRef = useRef<HTMLDivElement>(null)
  const analyzeAbort = useRef<AbortController | null>(null)
  const tutorialAbort = useRef<AbortController | null>(null)
  const downloadAbort = useRef<AbortController | null>(null)
  const tutorialRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLElement>(null)

  useMouseGlow(heroRef)

  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem('bili-history') || '[]'); if (Array.isArray(saved)) setHistory(saved.filter(x => typeof x?.url === 'string' && typeof x?.title === 'string').slice(0, 8)) } catch {}
    return () => { analyzeAbort.current?.abort(); tutorialAbort.current?.abort(); downloadAbort.current?.abort() }
  }, [])
  useEffect(() => { if (video || error) contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [video, error])

  const copy = useCallback(async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(''), 2000) }
    catch { setError('复制失败，请选中内容手动复制。') }
  }, [])

  async function responseJson(r: Response) {
    let data
    try { data = await r.json() } catch { throw new Error(`服务暂不可用（${r.status}），请稍后重试。`) }
    if (!r.ok) throw new Error(data.error || `请求失败（${r.status}）`)
    return data
  }

  async function analyze(input?: string) {
    const value = input || url
    if (!value.trim()) return
    analyzeAbort.current?.abort(); tutorialAbort.current?.abort(); downloadAbort.current?.abort()
    const controller = new AbortController(); analyzeAbort.current = controller
    setUrl(value); setLoading(true); setError(''); setVideo(null); setTutorialLoading(false); setDownloading(false)
    setTutorialText(''); setTutorialError(''); setTutorialSource(''); setTranscript(''); setSubtitleIndex('auto'); setActiveTab('download'); setDownloadResult(null); setDescExpanded(false)
    const timeout = setTimeout(() => controller.abort(), 55000)
    try {
      const r = await fetch('/api/video-info', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ url: value.trim() }),
      })
      let d = await r.json().catch(() => { throw new Error(`服务暂不可用（${r.status}），请稍后重试。`) })
      if (!r.ok) {
        if (d.browserFallback) d = await browserVideoInfo(d.resolvedUrl || value, controller.signal)
        else throw new Error(d.error || `解析失败（${r.status}）`)
      }
      if (controller.signal.aborted) return
      setVideo(d); setUrl(d.url)
      const next = [{ url: d.url, title: d.title }, ...history.filter(x => x.url !== d.url)].slice(0, 8)
      setHistory(next)
      try { localStorage.setItem('bili-history', JSON.stringify(next)) } catch {}
    } catch (e: unknown) {
      if (analyzeAbort.current === controller) setError(controller.signal.aborted ? '解析超时，请稍后重试。' : e instanceof Error ? e.message : '解析失败')
    } finally { clearTimeout(timeout); if (analyzeAbort.current === controller) { setLoading(false); analyzeAbort.current = null } }
  }

  async function downloadVideo() {
    if (!video || downloading) return
    const controller = new AbortController(); downloadAbort.current = controller
    setDownloading(true); setDownloadResult(null); setActiveTab('download')
    const timeout = setTimeout(() => controller.abort(), 50000)
    try {
      const r = await fetch('/api/download', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ url: video.url, bvid: video.bvid, cid: video.cid }),
      })
      if (r.ok && (r.headers.get('content-type') || '').includes('video/')) {
        const blob = await r.blob()
        if (!blob.size) throw new Error('下载内容为空，请重试。')
        const a = document.createElement('a'), objectUrl = URL.createObjectURL(blob)
        a.href = objectUrl; a.download = `${video.title.replace(/[\\/:*?"<>|]/g, '_')}.mp4`
        document.body.appendChild(a); a.click(); a.remove()
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60000)
        setDownloadResult({ mode: 'success', message: '视频已准备好，请在浏览器下载列表中确认保存。' })
      } else setDownloadResult(await responseJson(r))
    } catch (e: unknown) {
      if (downloadAbort.current === controller) setDownloadResult({ mode: 'fallback', command: downloadCommand(video.url), message: controller.signal.aborted ? '网页下载超时，请使用下方本机下载指令。' : e instanceof Error ? e.message : '下载失败，请使用本机下载。' })
    } finally { clearTimeout(timeout); if (downloadAbort.current === controller) { setDownloading(false); downloadAbort.current = null } }
  }

  async function generateTutorial() {
    if (!video || tutorialLoading) return
    const controller = new AbortController(); tutorialAbort.current = controller
    setTutorialLoading(true); setTutorialText(''); setTutorialError(''); setTutorialSource(''); setTutorialStatus('正在连接 AI 服务…'); setActiveTab('tutorial')
    const subtitleUrl = subtitleIndex === 'auto' ? video.subtitles?.[0]?.subtitle_url || '' : video.subtitles?.[Number(subtitleIndex)]?.subtitle_url || ''
    let output = '', completed = false
    const timeout = setTimeout(() => controller.abort(), 65000)
    try {
      const r = await fetch('/api/tutorial', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ subtitleUrl, title: video.title, videoUrl: video.url, transcript, sourceMode: subtitleIndex === 'auto' ? 'auto' : 'subtitle' }),
      })
      if (!r.ok) { await responseJson(r); return }
      if (!r.body || !r.headers.get('content-type')?.includes('text/event-stream')) throw new Error('AI 服务返回格式异常，请重试。')
      await readSSE(r.body, payload => {
        if (controller.signal.aborted) return
        if (payload === '[DONE]') { completed = true; return }
        let event
        try { event = JSON.parse(payload) } catch { return }
        if (event.error) throw new Error(event.error)
        if (event.status) setTutorialStatus(event.status)
        if (event.source) setTutorialSource(event.source)
        if (event.warning) setTutorialError(event.warning)
        if (event.text) { output += event.text; setTutorialText(output) }
      })
      if (!completed || !output.trim()) throw new Error('生成中断或没有返回内容，请重试。')
      setTutorialStatus('生成完成')
    } catch (e: unknown) {
      if (tutorialAbort.current === controller) setTutorialError(controller.signal.aborted ? '生成已停止，已收到的内容保留在下方。' : e instanceof Error ? e.message : '教程生成失败')
    } finally { clearTimeout(timeout); if (tutorialAbort.current === controller) { setTutorialLoading(false); tutorialAbort.current = null } }
  }

  function exportTutorial() {
    if (!video || !tutorialText) return
    const blob = new Blob([`# ${video.title}\n\n来源：${video.url}\n\n依据：${tutorialSource || '视频内容'}\n${tutorialError ? `\n注意：${tutorialError}\n` : ''}\n${tutorialText}`], { type: 'text/markdown;charset=utf-8' })
    const href = URL.createObjectURL(blob), a = document.createElement('a')
    a.href = href; a.download = `${video.title.replace(/[\\/:*?"<>|]/g, '_')}-学习笔记.md`
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(href), 60000)
  }

  return (
    <main className="relative z-10 min-h-screen">

      {/* ═══════════ HERO — Full viewport, extreme typography ═══════════ */}
      <section
        ref={heroRef}
        className="hero-section relative min-h-[65vh] py-14 sm:py-20 flex flex-col items-center justify-center px-4 sm:px-6 overflow-hidden"
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
            视频解析 · 字幕学习 · 本机下载
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
            <span className="text-[0.8rem]">AI 智能教程 · 本机下载 · 零门槛</span>
          </motion.p>

          {/* ─── Search Bar — Elevated glass terminal ─── */}
          <motion.div
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.3 }}
            className="w-full max-w-2xl mx-auto"
          >
            <div className="search-container glass-elevated rounded-2xl p-2">
              <div className="flex gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-dim)]" />
                  <input
                    type="text" aria-label="视频链接" autoComplete="off" spellCheck={false} value={url} onChange={e => setUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && !loading && analyze()}
                    placeholder="视频链接、分享文本或 BV 号"
                    className="w-full bg-transparent pl-12 pr-4 py-4 sm:py-5 text-[var(--text-primary)] placeholder-[var(--text-dim)] outline-none text-base font-light tracking-wide"
                  />
                </div>
                <button
                  onClick={() => analyze()} disabled={loading || !url.trim()}
                  className="btn-primary disabled:opacity-30 disabled:cursor-not-allowed disabled:transform-none px-4 sm:px-10 py-4 sm:py-5 text-sm font-semibold whitespace-nowrap rounded-xl tracking-wide uppercase"
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

            <p className="mt-3 text-xs text-[var(--text-secondary)]">支持 B 站视频 / 分 P / 短链接，以及 YouTube 视频与 Shorts</p>
            {history.length > 0 && <div className="mt-4 text-left glass rounded-xl p-3">
              <div className="flex justify-between text-xs text-[var(--text-secondary)] mb-2"><span>最近解析 · 仅保存在这台设备</span><button onClick={() => { setHistory([]); try { localStorage.removeItem('bili-history') } catch {} }} className="hover:text-white">清空记录</button></div>
              <div className="flex flex-wrap gap-2">{history.slice(0, 4).map(item => <button key={item.url} disabled={loading} onClick={() => analyze(item.url)} title={item.title} className="max-w-full truncate rounded-lg bg-white/5 px-3 py-2 text-xs text-[var(--text-secondary)] hover:text-white">{item.title}</button>)}</div>
            </div>}

            {/* Feature pills — asymmetric */}
            <motion.div
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: 0.5 }}
              className="flex items-center justify-center gap-3 sm:gap-8 mt-5 text-[11px] tracking-[0.12em] uppercase text-[var(--text-dim)] font-medium"
            >
              <span className="flex items-center gap-2"><Zap className="w-3 h-3 text-[var(--accent)]" />链接解析</span>
              <span className="w-[1px] h-3 bg-[var(--border)]" />
              <span className="flex items-center gap-2"><Download className="w-3 h-3 text-[var(--accent)]" />本机下载</span>
              <span className="w-[1px] h-3 bg-[var(--border)]" />
              <span className="flex items-center gap-2"><Sparkles className="w-3 h-3 text-[var(--gold)]" />AI 教程</span>
            </motion.div>
          </motion.div>
        </motion.div>
      </section>

      {/* ═══════════ CONTENT AREA ═══════════ */}
      <div ref={contentRef} className="max-w-4xl mx-auto px-4 sm:px-6 pb-16 scroll-mt-6">

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              role="alert" className="flex items-center gap-3 glass rounded-xl p-4 mb-6 border-[var(--danger)]/20 border">
              <AlertCircle className="w-5 h-5 text-[var(--danger)] shrink-0" />
              <span className="text-[var(--danger)] text-sm">{error}</span>
              <button aria-label="关闭错误提示" onClick={() => setError('')} className="ml-auto text-[var(--text-dim)] hover:text-white text-xs">✕</button>
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
                      <a aria-label="打开原视频" href={video.url} target="_blank" rel="noopener noreferrer"
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

              {(video.pages?.length || 0) > 1 && <div className="glass rounded-xl p-4">
                <label htmlFor="part" className="text-sm mr-3">选择分 P</label>
                <select id="part" value={video.selectedPage || 1} onChange={e => analyze(`https://www.bilibili.com/video/${video.bvid}?p=${e.target.value}`)} className="max-w-full bg-[var(--bg-deep)] p-2 rounded-lg text-sm">{video.pages?.map(p => <option key={p.cid} value={p.page}>P{p.page} · {p.title} ({fmtDur(p.duration)})</option>)}</select>
              </div>}

              {/* ─── Action Bento Grid — Asymmetric 2-col ─── */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={downloadVideo} disabled={downloading}
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
                    {video.bvid ? '小文件网页下载，大文件本机下载' : '查看本机下载步骤与指令'}
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
                    {video.hasSubtitles ? '根据视频或所选字幕生成学习笔记' : '尝试提取视频内容，也可粘贴字幕'}
                  </p>
                  {tutorialLoading && (
                    <div className="mt-4 h-1 bg-[var(--bg-glass)] rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-[var(--gold)] to-[#fbbf24] rounded-full shimmer" style={{ width: '100%' }} />
                    </div>
                  )}
                </button>
              </div>

              <details className="glass rounded-xl p-4" open={!!tutorialError}>
                <summary className="text-sm cursor-pointer text-[var(--text-secondary)]">字幕来源 · 可选择语言或粘贴文本</summary>
                <div className="mt-4 space-y-3">
                  <label htmlFor="subtitle" className="block text-xs text-[var(--text-secondary)]">内容来源</label>
                  <select id="subtitle" value={subtitleIndex} onChange={e => setSubtitleIndex(e.target.value)} disabled={tutorialLoading} className="bg-[var(--bg-deep)] rounded-lg p-2 text-sm w-full">
                    <option value="auto">自动提取视频内容</option>{video.subtitles.map((s, i) => <option key={s.lan + i} value={i}>{s.lan_doc} · 平台字幕</option>)}
                  </select>
                  {video.subtitleNotice && <p className="text-xs text-[var(--text-secondary)]">{video.subtitleNotice}</p>}
                  <label htmlFor="transcript" className="block text-xs text-[var(--text-secondary)]">粘贴实际字幕或转录文本（优先使用，最多 60000 字符）</label>
                  <textarea id="transcript" maxLength={60000} rows={5} value={transcript} disabled={tutorialLoading} onChange={e => setTranscript(e.target.value)} placeholder="没有平台字幕？将视频的字幕或转录内容粘贴到这里，再点击 AI 教程。" className="w-full bg-[var(--bg-deep)] border border-[var(--border)] rounded-xl p-3 text-sm" />
                  <p className="text-xs text-[var(--text-secondary)]">只根据实际内容生成笔记，不会把简介当作完整视频字幕。</p>
                </div>
              </details>

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
              {video && (
                <div role="tablist" aria-label="结果内容" className="flex gap-1 p-1.5 glass rounded-xl">
                  {[
                    { key: 'download' as const, icon: FileText, label: '下载指令' },
                    { key: 'tutorial' as const, icon: Sparkles, label: 'AI 教程' },
                  ].map(tab => (
                    <button
                      key={tab.key} role="tab" aria-selected={activeTab === tab.key}
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
                  <details className="glass rounded-xl p-4" open={downloadResult?.mode === 'fallback'}>
                    <summary className="text-sm cursor-pointer">第一次下载？先完成这两步</summary>
                    <ol className="text-sm text-[var(--text-secondary)] list-decimal pl-5 mt-3 space-y-3">
                      <li>安装下载工具和音视频合并工具。Mac（已安装 Homebrew）：<code className="block mt-2 p-3 bg-black/30 rounded-lg overflow-x-auto">brew install yt-dlp ffmpeg</code>Windows（PowerShell）：<code className="block mt-2 p-3 bg-black/30 rounded-lg overflow-x-auto">winget install --id yt-dlp.yt-dlp -e</code><code className="block mt-2 p-3 bg-black/30 rounded-lg overflow-x-auto">winget install --id Gyan.FFmpeg -e</code><a href="https://github.com/yt-dlp/yt-dlp#installation" target="_blank" rel="noopener noreferrer" className="inline-block mt-2 text-[var(--accent)]">查看完整安装说明</a></li>
                      <li>复制下方指令，在终端粘贴并运行。文件保存在终端当前文件夹；最高画质通常需要 FFmpeg。</li>
                      <li>如果提示需要登录，在指令的 <code>yt-dlp</code> 后加入 <code>--cookies-from-browser chrome</code>，并先在本机 Chrome 登录视频网站。登录状态只在本机使用。</li>
                    </ol>
                  </details>
                  {[
                    { label: '最高画质', icon: '🎬', cmd: downloadCommand(video.url) },
                    { label: '仅音频', icon: '🎵', cmd: downloadCommand(video.url, 'audio') },
                    ...([
                      { label: '字幕', icon: '💬', cmd: downloadCommand(video.url, 'subtitle') },
                    ]),
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
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4 text-xs text-[var(--text-secondary)]" role="status" aria-live="polite">
                    <span>{tutorialLoading ? tutorialStatus : tutorialError ? '生成未完成' : tutorialText ? '生成完成' : '准备生成'}{tutorialSource && ` · ${tutorialSource}`}</span>
                    {tutorialLoading && <button onClick={() => tutorialAbort.current?.abort()} className="text-[var(--accent)]">停止生成</button>}
                  </div>
                  {tutorialError && <div role="alert" className="text-sm text-[var(--danger)] mb-4">{tutorialError}<button disabled={tutorialLoading} onClick={generateTutorial} className="ml-3 underline">重试</button></div>}
                  {tutorialText ? (
                    <div className={`tutorial-content ${tutorialLoading ? 'typing-cursor' : ''}`}>
                      <ReactMarkdown>{tutorialText}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="text-center py-16 text-[var(--text-dim)]">
                      <div className="w-16 h-16 rounded-2xl bg-[var(--gold)]/5 border border-[var(--gold)]/10 flex items-center justify-center mx-auto mb-4">
                        <Sparkles className="w-7 h-7 opacity-40 text-[var(--gold)]" />
                      </div>
                      <p className="text-sm">{tutorialLoading ? tutorialStatus : tutorialError ? '可展开「字幕来源」粘贴实际字幕后重试' : '点击上方「AI 教程」按钮开始'}</p>
                    </div>
                  )}
                  {tutorialText && !tutorialLoading && (
                    <div className="mt-6 pt-4 flex flex-wrap gap-4 border-t border-[var(--border)]">
                      <button onClick={() => copy(tutorialText, 'tutorial')}
                        className="text-sm text-[var(--accent)] hover:text-[var(--accent-bright)] flex items-center gap-2 transition-colors">
                        {copied === 'tutorial' ? <><Check className="w-4 h-4" /> 已复制完整教程</> : <><Copy className="w-4 h-4" /> 复制学习笔记 (Markdown)</>}
                      </button>
                      <button onClick={exportTutorial} className="text-sm text-[var(--accent)] flex items-center gap-2"><Download className="w-4 h-4" />导出 Markdown</button>
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
