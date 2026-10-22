import { NextRequest } from "next/server";
import {
  downloadCommand,
  parseVideoLink,
  trustedAsset,
} from "../../../lib/video-url";
import {
  biliHeaders,
  biliJson,
  biliWbiJson,
  HttpError,
  errorResponse,
} from "../../../lib/upstream";
import { transferMp4 } from "../../../lib/download-transfer";

export const maxDuration = 60;

// A serverless response is capped at 4.5 MB by the platform, so the proxy path stays
// below that. Larger files are downloaded directly from the signed CDN URL by the browser.
const PROXY_LIMIT = 4 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const { url, bvid, cid, quality, info } = await req.json();
    let link;
    try {
      link = parseVideoLink(url || bvid);
    } catch (e) {
      throw new HttpError((e as Error).message, 400);
    }
    const qn = [16, 32, 64].includes(Number(quality)) ? Number(quality) : 32;
    const fallback = (message: string, extra = {}) =>
      Response.json({
        mode: "fallback",
        message,
        command: downloadCommand(link.url),
        ...extra,
      });
    if (link.short) throw new HttpError("请先解析短链接再下载", 400);
    if (link.platform === "youtube")
      return fallback(
        "YouTube 视频需要在本机下载；下方提供安装步骤和可直接复制的下载指令。",
      );
    if (!link.bvid || !Number.isSafeInteger(cid) || cid <= 0)
      throw new HttpError("请先解析视频并选择分 P", 400);
    // Both identifiers were parsed from the official platform; the playback API validates availability.
    let playData;
    try {
      try {
        playData = await biliWbiJson("/x/player/wbi/playurl", {
          bvid: link.bvid,
          cid,
          qn,
          fnval: 1,
          fnver: 0,
          fourk: 0,
          platform: "html5",
        });
      } catch {
        playData = await biliJson(
          `/x/player/playurl?bvid=${link.bvid}&cid=${cid}&qn=${qn}&fnval=1&fnver=0&fourk=0&platform=html5`,
        );
      }
    } catch (e) {
      if (e instanceof HttpError && e.status === 400) throw e;
      return fallback(
        "平台暂未提供可直接下载的视频流，请使用本机下载；如提示登录，可按下方说明使用浏览器登录状态。",
      );
    }
    const parts = Array.isArray(playData?.durl) ? playData.durl : [];
    if (!parts.length)
      return fallback("该视频需要合并音视频或登录后下载，请使用本机下载。");
    const part = parts[0];
    const size =
      Number.isSafeInteger(part?.size) && part.size > 0 ? part.size : 0;
    const actualQuality = Number(playData.quality) || qn;
    if (parts.length > 1)
      return fallback(
        "视频包含多个片段，网页直接保存需要合并；请使用本机下载。",
        { parts: parts.length, size, quality: actualQuality },
      );
    let videoUrl;
    let backups: string[] = [];
    try {
      videoUrl = trustedAsset(part.url, "media");
      if (Array.isArray(part.backup_url)) {
        backups = part.backup_url.flatMap((item: unknown) => {
          if (typeof item !== "string") return [];
          try {
            const asset = trustedAsset(item, "media");
            return asset.pathname.toLowerCase().endsWith(".mp4") &&
              asset.href !== videoUrl.href
              ? [asset.href]
              : [];
          } catch {
            return [];
          }
        });
      }
    } catch {
      return fallback("平台没有提供受支持的视频地址，请使用本机下载。");
    }
    if (!videoUrl.pathname.toLowerCase().endsWith(".mp4"))
      return fallback("该视频需要转换格式，请使用本机下载生成 MP4。");
    if (info === true) {
      return Response.json(
        {
          mode: "direct",
          url: videoUrl.href,
          backups,
          size,
          quality: actualQuality,
          parts: 1,
          format: typeof playData.format === "string" ? playData.format : "mp4",
          command: downloadCommand(link.url),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!size || size > PROXY_LIMIT)
      return fallback(
        !size
          ? "平台没有提供文件大小，无法安全中转。浏览器会尝试直接下载；若失败请使用本机下载。"
          : `文件约 ${(size / 1024 / 1024).toFixed(1)} MiB，超过网页中转上限 4 MiB。浏览器会直接下载；若失败请使用本机下载。`,
        { size, quality: actualQuality, direct: true },
      );
    const signal = AbortSignal.any([
      AbortSignal.timeout(50000),
      ...(req.signal ? [req.signal] : []),
    ]);
    for (const address of [videoUrl.href, ...backups]) {
      try {
        const response = await fetch(address, {
          headers: { ...biliHeaders, Range: "bytes=0-" },
          redirect: "error",
          signal,
        });
        const result = await transferMp4(response, {
          expectedSize: size,
          maxBytes: PROXY_LIMIT,
          signal,
        });
        return new Response(result.blob, {
          headers: {
            "Content-Type": "video/mp4",
            "Content-Disposition": `attachment; filename="${link.bvid}.mp4"`,
            "Cache-Control": "no-store",
            "X-Download-Mode": "proxy",
            "X-Video-Quality": String(actualQuality),
            "X-Video-Size": String(result.bytes),
            "Content-Length": String(result.bytes),
          },
        });
      } catch {
        if (signal.aborted) break;
      }
    }
    return fallback("视频传输未通过完整性验证，请重新下载或使用本机下载。");
  } catch (e) {
    return errorResponse(e);
  }
}
