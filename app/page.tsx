'use client'
import { useState } from 'react'

interface VideoInfo {
  platform: string
  title: string
  uploader: string
  avatar?: string
  duration?: number
  views?: number
  likes?: number
  coins?: number
  favorites?: number
  danmakus?: number
  description?: string
  thumbnail?: string
  bvid?: string
  aid?: number
  url: string
}

function formatDuration(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function formatNumber(n: number) {
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿'
  if (n >= 10000) return (n / 10000).toFixed(1) + '万'
  return n.toLocaleString()
}

export default function Home() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [video, setVideo] = useState<VideoInfo | null>(null)
  const [tab, setTab] = useState<'download' | 'tutorial'>('download')
  const [copied, setCopied] = useState('')

  async function handleAnalyze() {
    if (!url.trim()) return
    setLoading(true)
    setError('')
    setVideo(null)
    try {
      const resp = await fetch('/api/video-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || '解析失败')
      setVideo(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '未知错误')
    } finally {
      setLoading(false)
    }
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(''), 2000)
  }

  function getDownloadCommands(v: VideoInfo) {
    const u = v.url
    return [
      { label: '🎬 最高画质下载', cmd: `yt-dlp -f "bestvideo+bestaudio" --merge-output-format mp4 "${u}"` },
      { label: '🎵 仅下载音频 (MP3)', cmd: `yt-dlp -x --audio-format mp3 "${u}"` },
      { label: '📋 查看所有画质', cmd: `yt-dlp -F "${u}"` },
      ...(v.platform === 'bilibili' ? [
        { label: '💬 下载字幕', cmd: `yt-dlp --write-sub --sub-lang zh-CN --skip-download "${u}"` },
        { label: '🔑 大会员画质下载', cmd: `yt-dlp --cookies-from-browser chrome -f "bestvideo+bestaudio" "${u}"` },
      ] : []),
      { label: '📊 获取元数据 (JSON)', cmd: `yt-dlp --dump-json "${u}"` },
    ]
  }

  function getTutorialText(v: VideoInfo) {
    const platform = v.platform === 'bilibili' ? 'B 站' : 'YouTube'
    const lines = [
      `📺 ${v.title}`,
      '',
      `视频信息`,
      `• ${platform} UP主/频道: ${v.uploader}`,
    ]
    if (v.duration) lines.push(`• 时长: ${formatDuration(v.duration)}`)
    if (v.views) lines.push(`• 播放量: ${formatNumber(v.views)}`)
    lines.push(`• 链接: ${v.url}`)
    if (v.description) {
      lines.push('', `简介`, v.description.slice(0, 200))
    }
    lines.push(
      '', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '', '🔰 下载教程（零基础 3 步搞定）',
      '',
      '第 1 步：安装工具',
      '',
      'Mac 用户:',
      '  brew install yt-dlp ffmpeg',
      '',
      'Windows 用户:',
      '  1. 下载 yt-dlp: https://github.com/yt-dlp/yt-dlp/releases',
      '  2. 下载 ffmpeg: https://ffmpeg.org/download.html',
      '  3. 解压到同一目录，添加到 PATH',
      '',
      '第 2 步：打开终端，粘贴命令',
      '',
      '# 下载最高画质',
      `yt-dlp -f "bestvideo+bestaudio" --merge-output-format mp4 "${v.url}"`,
      '',
      '# 只要音频',
      `yt-dlp -x --audio-format mp3 "${v.url}"`,
      '',
      '第 3 步：播放',
      '双击下载的文件即可 🎉',
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '⚠️ 常见问题',
      '',
      '报错"需要登录"？',
      `  yt-dlp --cookies-from-browser chrome "${v.url}"`,
      '',
      '下载很慢？',
      `  yt-dlp --limit-rate 500K "${v.url}"`,
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '由 BiliHelper 自动生成',
    )
    return lines.join('\n')
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950 text-white">
      <div className="max-w-3xl mx-auto px-4 py-16">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold mb-3">
            <span className="text-white">Bili</span>
            <span className="text-pink-400">Helper</span>
          </h1>
          <p className="text-gray-400 text-lg">真正能用的视频信息查询 + 小白攻略生成器</p>
        </div>

        {/* Input */}
        <div className="flex gap-3 mb-8">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
            placeholder="粘贴 B 站或 YouTube 视频链接..."
            className="flex-1 bg-gray-800/60 border border-gray-700 rounded-xl px-5 py-4 text-white placeholder-gray-500 focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 transition-all"
          />
          <button
            onClick={handleAnalyze}
            disabled={loading || !url.trim()}
            className="px-8 py-4 bg-gradient-to-r from-pink-500 to-rose-500 rounded-xl font-semibold hover:from-pink-600 hover:to-rose-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all whitespace-nowrap"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                解析中
              </span>
            ) : '解析 🔍'}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 mb-6 text-red-300">
            ❌ {error}
          </div>
        )}

        {/* Video Info Card */}
        {video && (
          <div className="space-y-6">
            <div className="bg-gray-800/40 border border-gray-700/50 rounded-2xl overflow-hidden">
              {video.thumbnail && (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={video.thumbnail} alt={video.title} className="w-full h-48 object-cover" />
                  {video.duration && (
                    <span className="absolute bottom-3 right-3 bg-black/80 text-white text-sm px-2 py-1 rounded">
                      {formatDuration(video.duration)}
                    </span>
                  )}
                </div>
              )}
              <div className="p-6">
                <h2 className="text-xl font-bold mb-2">{video.title}</h2>
                <div className="flex items-center gap-3 text-gray-400 mb-4">
                  {video.avatar && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={video.avatar} alt="" className="w-8 h-8 rounded-full" />
                  )}
                  <span className="font-medium">{video.uploader}</span>
                  <span className="text-xs bg-gray-700 px-2 py-0.5 rounded">
                    {video.platform === 'bilibili' ? 'B站' : 'YouTube'}
                  </span>
                </div>
                {video.views !== undefined && (
                  <div className="flex gap-4 text-sm text-gray-500">
                    <span>▶ {formatNumber(video.views)}</span>
                    {video.likes !== undefined && <span>👍 {formatNumber(video.likes)}</span>}
                    {video.coins !== undefined && <span>🪙 {formatNumber(video.coins)}</span>}
                    {video.danmakus !== undefined && <span>💬 {formatNumber(video.danmakus)}</span>}
                  </div>
                )}
                {video.description && (
                  <p className="mt-4 text-sm text-gray-400 line-clamp-3">{video.description}</p>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2">
              <button
                onClick={() => setTab('download')}
                className={`flex-1 py-3 rounded-xl font-medium transition-all ${tab === 'download'
                    ? 'bg-pink-500/20 text-pink-400 border border-pink-500/50'
                    : 'bg-gray-800/40 text-gray-400 border border-gray-700/50 hover:bg-gray-800/60'
                  }`}
              >
                📥 下载指令
              </button>
              <button
                onClick={() => setTab('tutorial')}
                className={`flex-1 py-3 rounded-xl font-medium transition-all ${tab === 'tutorial'
                    ? 'bg-pink-500/20 text-pink-400 border border-pink-500/50'
                    : 'bg-gray-800/40 text-gray-400 border border-gray-700/50 hover:bg-gray-800/60'
                  }`}
              >
                📖 小白攻略
              </button>
            </div>

            {/* Download Commands */}
            {tab === 'download' && (
              <div className="space-y-3">
                {getDownloadCommands(video).map((item) => (
                  <div key={item.label} className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-medium text-gray-300">{item.label}</span>
                      <button
                        onClick={() => copyToClipboard(item.cmd, item.label)}
                        className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded-lg transition-colors"
                      >
                        {copied === item.label ? '✅ 已复制' : '📋 复制'}
                      </button>
                    </div>
                    <code className="block text-xs text-green-400 bg-black/30 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
                      {item.cmd}
                    </code>
                  </div>
                ))}
                <div className="bg-amber-900/20 border border-amber-700/40 rounded-xl p-4 text-sm text-amber-300">
                  💡 使用前请先安装 yt-dlp：<code className="bg-black/30 px-2 py-0.5 rounded">brew install yt-dlp ffmpeg</code>
                </div>
              </div>
            )}

            {/* Tutorial */}
            {tab === 'tutorial' && (
              <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-lg">📖 下载攻略</h3>
                  <button
                    onClick={() => copyToClipboard(getTutorialText(video), 'tutorial')}
                    className="text-sm bg-pink-500/20 text-pink-400 hover:bg-pink-500/30 px-4 py-2 rounded-lg transition-colors"
                  >
                    {copied === 'tutorial' ? '✅ 已复制' : '📋 复制完整攻略'}
                  </button>
                </div>
                <pre className="whitespace-pre-wrap text-gray-300 text-sm leading-relaxed font-sans">
                  {getTutorialText(video)}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-16 text-gray-600 text-sm">
          <p>Powered by <a href="https://github.com/yt-dlp/yt-dlp" className="text-pink-500 hover:underline" target="_blank" rel="noopener noreferrer">yt-dlp</a> + B 站 API + noembed</p>
          <p className="mt-1">© 2026 BiliHelper. 仅供学习交流使用。</p>
        </div>
      </div>
    </main>
  )
}
