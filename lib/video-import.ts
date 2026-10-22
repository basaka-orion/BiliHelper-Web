import { parseVideoLink } from "./video-url";
import type { VideoInfo } from "./workspace";

/** Read metadata on the viewer's network when the cloud cannot reach Bilibili. */
export async function loadVideoInfo(
  input: string,
  signal: AbortSignal,
  cloud: (input: string, signal: AbortSignal) => Promise<Response>,
  browser: (url: string, signal: AbortSignal) => Promise<VideoInfo>,
  onBrowserFallback?: () => void,
): Promise<VideoInfo> {
  signal.throwIfAborted();
  const original = parseVideoLink(input);
  let fallback = original.platform === "bilibili" && !original.short ? original : undefined;
  let retryable = true;
  try {
    const response = await cloud(input, signal);
    retryable = response.ok || response.status >= 500 || response.status === 429;
    const data = await response.json().catch(() => {
      throw new Error("视频服务返回格式异常，请重试。");
    });
    signal.throwIfAborted();
    if (response.ok) return data;
    // A short link has no BV identifier locally. Only the server's validated
    // redirect result can supply a browser fallback target; never execute a
    // returned arbitrary URL or replace a known part with a different video.
    if (retryable && original.short && data?.browserFallback === true && typeof data.resolvedUrl === "string") {
      try {
        const resolved = parseVideoLink(data.resolvedUrl);
        if (resolved.platform === "bilibili" && !resolved.short) fallback = resolved;
      } catch { /* An invalid redirect must not become a browser script request. */ }
    }
    throw new Error(typeof data?.error === "string" ? data.error : "视频无法打开，请重试。");
  } catch (error) {
    signal.throwIfAborted();
    if (!retryable) throw error;
    if (!fallback) {
      if (original.short) throw new Error("短链接未能解析成视频地址，请从原视频页复制完整链接后重试。");
      throw error;
    }
    onBrowserFallback?.();
    try {
      const video = await browser(fallback.url, signal);
      signal.throwIfAborted();
      return video;
    } catch (browserError) {
      signal.throwIfAborted();
      const detail = browserError instanceof Error ? browserError.message : "请稍后重试。";
      throw new Error(`云端和浏览器均未能读取视频信息。${detail}`);
    }
  }
}
