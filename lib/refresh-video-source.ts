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
  selectedLanguage?: string,
) {
  if (video.platform !== "bilibili") return { video, selected };
  const originalLanguage =
    selected === "auto"
      ? undefined
      : (selectedLanguage ?? video.subtitles[Number(selected)]?.lan);
  const link = parseVideoLink(video.url);
  const part = video.pages?.find((item) => item.page === link.page);
  const browserIdentityVerified =
    link.page === 1 || (part?.cid === video.cid && Number(video.cid) > 0);
  let freshVideo: VideoInfo | undefined;
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
  const results = await Promise.allSettled([
    browserIdentityVerified && video.bvid && video.cid
      ? browserLookup(video.bvid, video.cid, bounded)
      : Promise.reject(new Error("当前节标识尚未取得")),
    cloudLookup(video.url, bounded).then((fresh) => {
      const newLink = parseVideoLink(fresh.url);
      const newPart = fresh.pages?.find((item) => item.page === link.page);
      if (
        newLink.url !== link.url ||
        (fresh.selectedPage || 1) !== link.page ||
        !Number.isSafeInteger(fresh.cid) ||
        Number(fresh.cid) <= 0 ||
        (link.page > 1 && newPart?.cid !== fresh.cid)
      )
        throw new Error("字幕来源与当前节不一致");
      freshVideo = fresh;
      return fresh.subtitles;
    }),
  ]);
  if (signal.aborted) throw new Error("请求已停止");
  let captions: Captions = [];
  const identityChanged = freshVideo && freshVideo.cid !== video.cid;
  for (const result of identityChanged ? results.slice(1) : results) {
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
  if (
    !captions.length &&
    browserIdentityVerified &&
    results.every((item) => item.status === "rejected")
  )
    captions = video.subtitles;
  const index = originalLanguage
    ? captions.findIndex((item) => item.lan === originalLanguage)
    : -1;
  return {
    video: {
      ...video,
      ...freshVideo,
      subtitles: captions,
      hasSubtitles: captions.length > 0,
    },
    selected: selected === "auto" || index < 0 ? "auto" : String(index),
  };
}
