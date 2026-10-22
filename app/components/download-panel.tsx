"use client";
import { useRef, useState, useEffect } from "react";
import { Check, Copy, Download, Loader2 } from "lucide-react";
import { browserMedia, type BrowserMedia } from "../../lib/browser-bili";
import { downloadCommand } from "../../lib/video-url";
import {
  transferMp4,
  type DownloadWritable,
} from "../../lib/download-transfer";
import type { VideoInfo } from "../../lib/workspace";

const QUALITY_LABELS: Record<number, string> = {
  16: "360p",
  32: "480p",
  64: "720p",
};
const PROXY_LIMIT = 4 * 1024 * 1024;
const MAX_DIRECT = 700 * 1024 * 1024;
const MAX_MEMORY = 40 * 1024 * 1024;
type SaveHandle = { createWritable: () => Promise<DownloadWritable> };
function canceled(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function sizeLabel(bytes: number) {
  if (!bytes) return "大小未知";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

function safeName(title: string, quality: string) {
  return `${title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 100) || "视频"}${quality ? `-${quality}` : ""}.mp4`;
}

function saveBlob(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 120000);
}

export function DownloadPanel({ video }: { video: VideoInfo }) {
  const [quality, setQuality] = useState(64);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState("");
  const [system, setSystem] = useState("mac");
  const [progress, setProgress] = useState<number | null>(null);
  const [stage, setStage] = useState("");
  const [received, setReceived] = useState(0);
  const [expected, setExpected] = useState(0);
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

  async function writeResponse(
    response: Response,
    media: BrowserMedia,
    name: string,
    signal: AbortSignal,
    handle?: SaveHandle,
  ) {
    const result = await transferMp4(response, {
      expectedSize: media.size,
      maxBytes: handle ? MAX_DIRECT : MAX_MEMORY,
      signal,
      createWritable: handle ? () => handle.createWritable() : undefined,
      onProgress: (bytes, total) => {
        setReceived(bytes);
        setExpected(total);
        setProgress(total ? Math.min(100, (bytes / total) * 100) : null);
      },
    });
    if (signal.aborted) throw new DOMException("下载已停止。", "AbortError");
    if (result.blob) saveBlob(result.blob, name);
    setProgress(100);
    return result.bytes;
  }

  async function serverMedia(signal: AbortSignal): Promise<BrowserMedia> {
    const response = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        url: video.url,
        bvid: video.bvid,
        cid: video.cid,
        quality,
        info: true,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(data.error || `下载信息请求失败（${response.status}）`);
    if (data.mode !== "direct" || typeof data.url !== "string")
      throw new Error(data.message || "平台没有返回可直接下载的视频地址");
    return {
      url: data.url,
      backups: Array.isArray(data.backups) ? data.backups : [],
      size: Number(data.size) || 0,
      quality: Number(data.quality) || quality,
      parts: Number(data.parts) || 1,
      format: typeof data.format === "string" ? data.format : "mp4",
    };
  }

  async function directDownload(
    media: BrowserMedia,
    signal: AbortSignal,
    handle?: SaveHandle,
  ) {
    if (media.parts !== 1)
      throw new Error("视频包含多个片段，请使用本机下载保存完整视频。");
    const name = safeName(
      video.title,
      QUALITY_LABELS[media.quality] || `q${media.quality}`,
    );
    const urls = [media.url, ...media.backups];
    let lastError: unknown;
    for (let index = 0; index < urls.length; index++) {
      const url = urls[index];
      try {
        setStage(
          index === 0
            ? "正在从视频 CDN 下载…"
            : "主线路失败，正在切换备用线路…",
        );
        const response = await fetch(url, {
          signal,
          cache: "no-store",
          credentials: "omit",
          referrerPolicy: "no-referrer",
        });
        return await writeResponse(response, media, name, signal, handle);
      } catch (error) {
        lastError = error;
        if (signal.aborted || canceled(error)) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("直接下载失败");
  }

  async function proxyDownload(signal: AbortSignal, handle?: SaveHandle) {
    setStage("正在通过本站中转小文件…");
    const response = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
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
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || data.error || "网页中转暂不可用。");
    }
    const size = Number(response.headers.get("X-Video-Size")) || 0;
    const actual = Number(response.headers.get("X-Video-Quality")) || quality;
    return writeResponse(
      response,
      { size, quality: actual, parts: 1, format: "mp4", url: "", backups: [] },
      safeName(video.title, QUALITY_LABELS[actual] || `q${actual}`),
      signal,
      handle,
    );
  }

  async function download() {
    if (loading || !video.bvid || !video.cid) return;
    const abort = new AbortController();
    controller.current = abort;
    const timer = setTimeout(() => abort.abort(), 10 * 60 * 1000);
    setLoading(true);
    setMessage("");
    setStage("正在读取平台可用的视频地址…");
    setProgress(null);
    setReceived(0);
    setExpected(0);
    try {
      // The picker must be requested by this click, before any network await.
      let handle: SaveHandle | undefined;
      if (
        typeof (window as unknown as { showSaveFilePicker?: unknown })
          .showSaveFilePicker === "function"
      ) {
        handle = await (
          window as unknown as {
            showSaveFilePicker: (options: {
              suggestedName: string;
              types: {
                description: string;
                accept: Record<string, string[]>;
              }[];
            }) => Promise<SaveHandle>;
          }
        ).showSaveFilePicker({
          suggestedName: safeName(video.title, ""),
          types: [
            { description: "MP4 视频", accept: { "video/mp4": [".mp4"] } },
          ],
        });
      }
      if (abort.signal.aborted)
        throw new DOMException("下载已停止。", "AbortError");
      let media: BrowserMedia | undefined;
      let lastError: unknown;
      let usedBrowserLookup = false;
      try {
        media = await serverMedia(abort.signal);
      } catch (error) {
        if (canceled(error)) throw error;
        lastError = error;
      }
      if (abort.signal.aborted) throw lastError;
      if (!media) {
        usedBrowserLookup = true;
        media = await browserMedia(
          video.bvid,
          video.cid,
          quality,
          abort.signal,
        );
      }
      let bytes: number | undefined;
      try {
        bytes = await directDownload(media, abort.signal, handle);
      } catch (error) {
        if (canceled(error)) throw error;
        lastError = error;
      }
      if (abort.signal.aborted) throw lastError;
      // A cloud-issued URL can fail on the viewer's network. Ask for a fresh,
      // same-part browser URL before falling back to the small-file proxy.
      if (bytes === undefined && !usedBrowserLookup) {
        setStage("正在为当前网络重新获取下载地址…");
        try {
          const refreshed = await browserMedia(
            video.bvid,
            video.cid,
            quality,
            abort.signal,
          );
          media = refreshed;
          bytes = await directDownload(refreshed, abort.signal, handle);
        } catch (error) {
          if (canceled(error)) throw error;
          lastError = error;
        }
      }
      if (abort.signal.aborted) throw lastError;
      if (bytes === undefined && media.size > 0 && media.size <= PROXY_LIMIT) {
        bytes = await proxyDownload(abort.signal, handle);
      }
      if (bytes === undefined) throw lastError;
      setMessage(
        `已保存 ${sizeLabel(bytes)}，实际画质 ${QUALITY_LABELS[media.quality] || `q${media.quality}`}。${handle ? "" : "请在浏览器下载列表确认。"}`,
      );
    } catch (error) {
      setMessage(
        abort.signal.aborted || canceled(error)
          ? "下载已取消或超时，可重新保存。"
          : error instanceof Error
            ? `${error.message} 也可使用下方本机下载。`
            : "下载失败，请使用下方本机下载。",
      );
    } finally {
      clearTimeout(timer);
      setLoading(false);
      setStage("");
      controller.current = undefined;
    }
  }

  const percent =
    progress === null ? null : Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div className="download-panel">
      <p className="muted">
        直接保存平台提供的完整 MP4。登录、地区与版权限制以平台为准。
      </p>
      {video.bvid && video.cid ? (
        <section className="tool-section">
          <h3>直接保存到浏览器</h3>
          <label htmlFor="download-quality">期望画质</label>
          <select
            id="download-quality"
            value={quality}
            onChange={(event) => setQuality(Number(event.target.value))}
            disabled={loading}
          >
            <option value={64}>优先 720p</option>
            <option value={32}>优先 480p · 文件更小</option>
            <option value={16}>优先 360p · 文件最小</option>
          </select>
          <p className="small muted">
            支持选择文件位置的浏览器可保存至 700 MiB；其他浏览器上限 40
            MiB。多片段和超大文件请用下方本机下载。
          </p>
          <button className="primary" onClick={download} disabled={loading}>
            {loading ? (
              <Loader2 className="spin" size={17} />
            ) : (
              <Download size={17} />
            )}
            {loading ? "正在下载" : "保存视频"}
          </button>
          {loading && (
            <button
              className="text-button"
              onClick={() => controller.current?.abort()}
            >
              停止下载
            </button>
          )}
          {loading && (
            <div className="download-progress" role="status">
              <progress
                value={percent ?? undefined}
                max={100}
                aria-label="下载进度"
              />
              <span>
                {stage}
                {expected > 0
                  ? ` · ${percent ?? 0}% · ${sizeLabel(received)} / ${sizeLabel(expected)}`
                  : received > 0
                    ? ` · ${sizeLabel(received)}`
                    : ""}
              </span>
            </div>
          )}
        </section>
      ) : (
        <p className="notice">
          当前视频没有可用的网页下载标识，请使用下方本机下载方式。
        </p>
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
