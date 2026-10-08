"use client";
import { useRef, useState, useEffect } from "react";
import { Check, Copy, Download, Loader2 } from "lucide-react";
import { downloadCommand } from "../../lib/video-url";
import type { VideoInfo } from "../../lib/workspace";

export function DownloadPanel({ video }: { video: VideoInfo }) {
  const [quality, setQuality] = useState(32);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState("");
  const [system, setSystem] = useState("mac");
  const controller = useRef<AbortController>();
  useEffect(() => {
    setSystem(/Win/.test(navigator.platform) ? "windows" : "mac");
    return () => controller.current?.abort();
  }, []);
  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      setMessage("复制失败，请选中指令手动复制。");
    }
  }
  async function download() {
    if (loading) return;
    const abort = new AbortController();
    controller.current = abort;
    const timer = setTimeout(() => abort.abort(), 65000);
    setLoading(true);
    setMessage("正在准备文件，完成后会打开浏览器保存…");
    try {
      const response = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          url: video.url,
          bvid: video.bvid,
          cid: video.cid,
          quality,
        }),
      });
      if (
        !response.ok ||
        !response.headers.get("content-type")?.includes("video/")
      ) {
        const data = await response.json();
        setMessage(data.message || data.error || "请使用下方本机下载方式。");
        return;
      }
      const blob = await response.blob(),
        expected = Number(response.headers.get("X-Video-Size"));
      if (!blob.size || (expected > 0 && blob.size !== expected))
        throw new Error("文件传输中断，请降低画质重试或使用本机下载。");
      const href = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = href;
      link.download = `${video.title.replace(/[\\/:*?"<>|]/g, "_")}.mp4`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(href), 60000);
      const actual = (
        { 16: "360p", 32: "480p", 64: "720p" } as Record<number, string>
      )[Number(response.headers.get("X-Video-Quality"))];
      setMessage(
        `文件已交给浏览器保存${actual ? `，实际画质 ${actual}` : ""}。请在下载列表确认。`,
      );
    } catch (error) {
      setMessage(
        abort.signal.aborted
          ? "下载已停止或超时，可使用下方本机下载。"
          : error instanceof Error
            ? error.message
            : "下载失败，请使用本机方式。",
      );
    } finally {
      clearTimeout(timer);
      setLoading(false);
      controller.current = undefined;
    }
  }
  return (
    <div className="download-panel">
      <p className="muted">
        保存这一节视频，便于离线回看。平台的登录、地区与版权限制仍然适用。
      </p>
      {video.bvid && (
        <section className="tool-section">
          <h3>直接保存到浏览器</h3>
          <label htmlFor="download-quality">网页下载画质</label>
          <select
            id="download-quality"
            value={quality}
            onChange={(event) => setQuality(Number(event.target.value))}
            disabled={loading}
          >
            <option value={32}>优先 480p</option>
            <option value={16}>360p · 文件更小</option>
            <option value={64}>优先 720p</option>
          </select>
          <p className="small muted">
            最多 40 MiB。更大文件或最高画质，请使用下方本机下载。
          </p>
          <button className="primary" onClick={download} disabled={loading}>
            {loading ? (
              <Loader2 className="spin" size={17} />
            ) : (
              <Download size={17} />
            )}
            {loading ? "正在准备文件" : "保存视频"}
          </button>
          {loading && (
            <button
              className="text-button"
              onClick={() => controller.current?.abort()}
            >
              停止下载
            </button>
          )}
        </section>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <section className="tool-section">
        <h3>在电脑上下载</h3>
        <label htmlFor="download-system">我的电脑</label>
        <select
          id="download-system"
          value={system}
          onChange={(event) => setSystem(event.target.value)}
        >
          <option value="mac">Mac</option>
          <option value="windows">Windows</option>
        </select>
        <ol className="steps">
          <li>
            安装下载与音视频工具。
            {system === "mac" ? (
              <>
                <p className="small">已有 Homebrew 时运行：</p>
                <code>brew install yt-dlp ffmpeg</code>
              </>
            ) : (
              <>
                <code>winget install --id yt-dlp.yt-dlp -e</code>
                <code>winget install --id Gyan.FFmpeg -e</code>
              </>
            )}
            <a
              href="https://github.com/yt-dlp/yt-dlp#installation"
              target="_blank"
              rel="noopener noreferrer"
            >
              查看安装说明
            </a>
          </li>
          <li>在终端运行下方指令，文件保存到终端当前文件夹。</li>
          <li>
            需要登录时，先在本机 Chrome 登录视频网站，再在 yt-dlp 后加入{" "}
            <code>--cookies-from-browser chrome</code>。
          </li>
        </ol>
        {(["video", "audio", "subtitle"] as const).map((kind, index) => {
          const labels = ["最高画质视频", "仅音频", "字幕"];
          const command = downloadCommand(
            video.url,
            kind === "video" ? undefined : kind,
          );
          return (
            <div className="command" key={kind}>
              <div>
                <strong>{labels[index]}</strong>
                <button
                  className="text-button"
                  onClick={() => copy(command, kind)}
                >
                  {copied === kind ? <Check size={14} /> : <Copy size={14} />}
                  {copied === kind ? "已复制" : "复制指令"}
                </button>
              </div>
              <code>{command}</code>
            </div>
          );
        })}
      </section>
    </div>
  );
}
