import type { VideoInfo } from "./workspace";
import { parseVideoLink, trustedAsset } from "./video-url";

type Captions = VideoInfo["subtitles"];

/** Empty browser captions must not prevent an independent cloud lookup. */
export async function refreshVideoSource(
  video: VideoInfo,
  selected: string,
  signal: AbortSignal,
  browserLookup: (
    bvid: string,
    cid: number,
    signal: AbortSignal,
  ) => Promise<Captions>,
  cloudLookup: (url: string, signal: AbortSignal) => Promise<VideoInfo>,
) {
  if (video.platform !== "bilibili") return { video, selected };
  const originalLanguage =
    selected === "auto" ? undefined : video.subtitles[Number(selected)]?.lan;
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
  const results = await Promise.allSettled([
    video.bvid && video.cid
      ? browserLookup(video.bvid, video.cid, bounded)
      : Promise.reject(new Error("当前节标识尚未取得")),
    cloudLookup(video.url, bounded).then((fresh) => {
      const oldLink = parseVideoLink(video.url),
        newLink = parseVideoLink(fresh.url);
      if (newLink.url !== oldLink.url || fresh.cid !== video.cid)
        throw new Error("字幕来源与当前节不一致");
      return fresh.subtitles;
    }),
  ]);
  if (signal.aborted) throw new Error("请求已停止");
  let captions: Captions = [];
  for (const result of results) {
    if (result.status !== "fulfilled" || !Array.isArray(result.value)) continue;
    for (const caption of result.value) {
      try {
        if (
          typeof caption?.lan !== "string" ||
          typeof caption?.lan_doc !== "string"
        )
          continue;
        const url = trustedAsset(caption.subtitle_url, "subtitle").href;
        if (!captions.some((item) => item.lan === caption.lan))
          captions.push({ ...caption, subtitle_url: url });
      } catch {
        /* Ignore assets outside the fixed platform allowlist. */
      }
    }
  }
  // Retain an existing selected asset if both refresh paths failed; the server will validate it.
  if (!captions.length && results.every((item) => item.status === "rejected"))
    captions = video.subtitles;
  const index = originalLanguage
    ? captions.findIndex((item) => item.lan === originalLanguage)
    : -1;
  return {
    video: { ...video, subtitles: captions, hasSubtitles: captions.length > 0 },
    selected: selected === "auto" || index < 0 ? "auto" : String(index),
  };
}
