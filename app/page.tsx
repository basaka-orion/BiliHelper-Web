"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import dynamic from "next/dynamic";
import remarkGfm from "remark-gfm";
import {
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileText,
  Library,
  Link2,
  List,
  Network,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Undo2,
} from "lucide-react";
import { browserVideoInfo, browserSubtitles } from "../lib/browser-bili";
import { refreshVideoSource } from "../lib/refresh-video-source";
import { parseVideoLink } from "../lib/video-url";
import { readSSE } from "../lib/sse";
import { tutorialMarkdown } from "../lib/markdown";
import { articleMarkdown } from "../lib/article-export";
import { buildMindMapSection, buildMindMapUnits } from "../lib/mindmap";
import { mindMapRoot } from "../lib/mindmap-view";
import {
  createDocument,
  documentId,
  migrateHistory,
  readMindMapSection,
  type LearningDocument,
  type LearningNote,
  type VideoInfo,
  type MindMapDocument,
} from "../lib/workspace";
import { useWorkspace } from "../lib/use-workspace";
import {
  buildFullEvidence,
  chunkSourceCues,
  cuesToPlainText,
  cuesToSrt,
  normalizeFullSourceCues,
  parseTranscript,
  sourceCharacterCount,
  type SourceCue,
  type SourceEvidence,
} from "../lib/learning-source";
import {
  assembleArticle,
  assembleFullDocument,
  assemblePartialArticle,
  assemblePartialDocument,
  markdownFileName,
  type FullDocumentSection,
} from "../lib/full-document";
import { Modal } from "./components/modal";
import { DownloadPanel } from "./components/download-panel";
const MindMap = dynamic(() => import("./components/mind-map").then((module) => module.MindMap), {
  ssr: false,
  loading: () => <p className="preparing">正在载入思维导图…</p>,
});

const EXAMPLE = "https://www.bilibili.com/video/BV1wD4y1o7AS";
function duration(seconds = 0) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
function fileBaseName(title: string) {
  return title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120) || "视频";
}
function partName(video: VideoInfo) {
  return (
    video.pages?.find((part) => part.page === (video.selectedPage || 1))
      ?.title || video.title
  );
}
function partUrl(video: VideoInfo, part: number) {
  return `https://www.bilibili.com/video/${video.bvid}${part > 1 ? `?p=${part}` : ""}`;
}
function noteState(document?: LearningDocument) {
  return document?.generationState === "running"
    ? "生成中"
    : document?.draft?.text || document?.generationState === "interrupted"
      ? "未完成"
      : document?.note
        ? document.note.mode === "article"
          ? "完整文稿"
          : document.note.mode === "full"
          ? "学习笔记"
          : "有笔记"
        : "未整理";
}
function modeLabel(mode?: LearningDocument["noteMode"]) {
  return mode === "article" ? "完整文稿" : mode === "full" ? "学习笔记" : "简短摘要";
}
function coverage(evidence?: SourceEvidence) {
  return evidence?.coverage === "full"
    ? "已分析取得的全部文本"
    : evidence?.coverage === "partial"
      ? "仅分析当前片段"
      : "覆盖范围未确认";
}
function cueUrl(video: VideoInfo, cue: SourceCue) {
  const url = new URL(video.url);
  if (cue.start !== undefined)
    url.searchParams.set(
      "t",
      video.platform === "youtube"
        ? `${Math.floor(cue.start)}s`
        : String(Math.floor(cue.start)),
    );
  return url.href;
}
function saveTextFile(text: string, name: string, type = "text/markdown;charset=utf-8") {
  const href = URL.createObjectURL(new Blob([text], { type })),
    link = window.document.createElement("a");
  link.href = href;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 10000);
}
async function json(response: Response) {
  const data = await response.json().catch(() => {
    throw new Error(`服务暂不可用（${response.status}），请重试。`);
  });
  if (!response.ok)
    throw new Error(
      data.error || data.message || `请求失败（${response.status}）`,
    );
  return data;
}

export default function Home() {
  const {
    workspace,
    current,
    ready,
    saveStatus,
    saveError,
    commit,
    updateDocument,
    flush,
  } = useWorkspace();
  const document = workspace.activeId
    ? workspace.documents[workspace.activeId]
    : undefined;
  const [home, setHome] = useState(false);
  const [input, setInput] = useState("");
  const [opening, setOpening] = useState(false);
  const [inputError, setInputError] = useState("");
  const [legacy, setLegacy] = useState<{ url: string; title: string }[]>([]);
  const [filter, setFilter] = useState("");
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [selectedCue, setSelectedCue] = useState("");
  const [sourceSearch, setSourceSearch] = useState("");
  const [showPrevious, setShowPrevious] = useState(false);
  const [resultView, setResultView] = useState<"text" | "mindmap">("text");
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState("");
  const [deleted, setDeleted] = useState<LearningDocument>();
  const [job, setJob] = useState<{
    id: string;
    status: string;
    done?: number;
    total?: number;
  } | null>(null);
  const jobRef = useRef<{
    id: string;
    controller: AbortController;
    mode?: "study" | "full" | "article" | "mindmap";
  } | null>(null);
  const analyzeRef = useRef<AbortController>();
  const contentRef = useRef<HTMLElement>(null);
  const restoreScroll = useRef(false);
  const allDocuments = useMemo(
    () =>
      Object.values(workspace.documents).sort(
        (a, b) => b.updatedAt - a.updatedAt,
      ),
    [workspace.documents],
  );
  const noteDocuments = allDocuments.filter(
    (item) => item.note || item.draft?.text || item.memo || item.transcript,
  );
  const active = document && !home ? document : undefined;
  const priorNote = active?.draft ? active.note : active?.previousNote;
  const shownNote = active
    ? showPrevious && priorNote
      ? priorNote
      : active.draft?.text
        ? active.draft
        : active.note
    : undefined;
  const generationError = active?.draft?.error || active?.fullJob?.error;
  const noteMode = active?.noteMode || "full";
  const longForm = noteMode !== "study";
  const fullJobMode = active?.fullJob?.mode || "full";
  const fullSections = active?.fullJob?.sections || [];
  const canResumeFull = longForm && !!active?.fullJob && fullJobMode === noteMode;
  const outputName = modeLabel(noteMode);
  const shownArticle = shownNote?.mode === "article";
  const needsSource =
    !!active &&
    !active.transcript.trim() &&
    !active.video.subtitles.length &&
    !["bilibili", "youtube"].includes(active.video.platform);
  const manualCharacters = useMemo(
    () =>
      parseTranscript(active?.transcript || "")
        .map((cue) => cue.text)
        .join("\n").length,
    [active?.transcript],
  );
  const currentEvidence = active?.draft?.evidence || active?.note?.evidence;
  const totalCharacters =
    active?.fullJob?.totalCharacters ||
    (active?.transcript.trim()
      ? manualCharacters
      : currentEvidence?.kind !== "manual"
        ? currentEvidence?.totalCharacters || 0
        : 0);
  const sourceEvidence = (resultView === "mindmap" ? active?.mindmap?.source : undefined) || shownNote?.evidence || active?.fullJob?.source || active?.draft?.evidence;
  const mapRoot = useMemo(() => {
    const map = active?.mindmap;
    if (!map) return undefined;
    const nodes = chunkSourceCues(map.source.cues).flatMap((chunk, index) =>
      (map.sections[index] || buildMindMapSection(undefined, buildMindMapUnits(chunk), index + 1)).nodes,
    );
    return mindMapRoot(map.title, nodes);
  }, [active?.mindmap]);
  const sourceCues = sourceEvidence?.cues || [];
  const matchingCues = sourceCues.filter(
    (cue) => !sourceSearch || cue.text.includes(sourceSearch),
  );
  const visibleCues = matchingCues.slice(0, 2000);
  const sourceSrt = useMemo(() => cuesToSrt(sourceCues), [sourceCues]);
  const focusCue = sourceCues.find((cue) => cue.id === selectedCue);

  useEffect(() => {
    try {
      setLegacy(migrateHistory(localStorage.getItem("bili-history")));
    } catch {}
  }, []);
  useEffect(() => {
    if (!ready || !document || home) return;
    restoreScroll.current = true;
    const timeout = setTimeout(() => {
      window.scrollTo({
        top: document.scrollY || 0,
        behavior: "instant" as ScrollBehavior,
      });
      restoreScroll.current = false;
    }, 50);
    setShowPrevious(false);
    setResultView("text");
    setSelectedCue("");
    setFilter("");
    return () => clearTimeout(timeout);
    // Only restore when switching documents, never on streamed updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.activeId, home, ready]);
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const remember = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        const id = current.current.activeId;
        if (!id || restoreScroll.current || home) return;
        updateDocument(id, (value) => ({ ...value, scrollY: window.scrollY }));
      }, 350);
    };
    window.addEventListener("scroll", remember, { passive: true });
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("scroll", remember);
    };
  }, [current, home, updateDocument]);
  useEffect(
    () => () => {
      analyzeRef.current?.abort();
      jobRef.current?.controller.abort();
    },
    [],
  );

  const openSaved = useCallback(
    (id: string) => {
      analyzeRef.current?.abort();
      analyzeRef.current = undefined;
      setOpening(false);
      commit((value) => ({ ...value, activeId: id }));
      setHome(false);
      setInputError("");
      setLibraryOpen(false);
      setDirectoryOpen(false);
      setSourceOpen(false);
      setDownloadOpen(false);
    },
    [commit],
  );

  async function openVideo(value: string, refresh = false) {
    if (!value.trim() || !ready) return;
    analyzeRef.current?.abort();
    const controller = new AbortController();
    analyzeRef.current = controller;
    setOpening(true);
    setInputError("");
    const timeout = setTimeout(() => controller.abort(), 55000);
    try {
      const link = parseVideoLink(value);
      const id = documentId(link.url);
      if (!refresh && current.current.documents[id]) {
        openSaved(id);
        setInput("");
        return;
      }
      let video: VideoInfo | undefined;
      let serverError: unknown;
      try {
        const response = await fetch("/api/video-info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ url: value }),
        });
        const data = await response.json().catch(() => {
          throw new Error("视频服务暂不可用，请重试。");
        });
        if (response.ok) video = data;
        else throw new Error(data.error || "视频无法打开");
      } catch (error) {
        if (controller.signal.aborted) return;
        serverError = error;
        // Browser JSONP is a fallback for networks where the cloud API is blocked.
        if (link.platform === "bilibili" && !link.short) {
          try {
            video = await browserVideoInfo(link.url, controller.signal);
          } catch (browserError) {
            if (controller.signal.aborted) return;
            throw serverError instanceof Error ? serverError : browserError;
          }
        } else throw error;
      }
      if (controller.signal.aborted || !video) return;
      let metadata = video;
      const nextId = documentId(metadata.url);
      let refreshedIndex: string | undefined;
      if (refresh && metadata.platform === "bilibili") {
        const previous = current.current.documents[nextId];
        const refreshed = await refreshVideoSource(
          metadata,
          previous?.subtitleIndex || "auto",
          controller.signal,
          browserSubtitles,
          async (url, signal) =>
            json(
              await fetch("/api/video-info", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal,
                body: JSON.stringify({ url }),
              }),
            ),
          previous?.video.subtitles[Number(previous.subtitleIndex)]?.lan,
        );
        metadata = refreshed.video;
        refreshedIndex = refreshed.selected;
      }
      if (controller.signal.aborted) return;
      commit((state) => {
        const existing = state.documents[nextId];
        return {
          ...state,
          activeId: nextId,
          documents: {
            ...state.documents,
            [nextId]: existing
              ? {
                  ...existing,
                  video: metadata,
                  subtitleIndex: refreshedIndex ?? existing.subtitleIndex,
                }
              : createDocument(metadata),
          },
        };
      });
      setInput("");
      setHome(false);
      setDirectoryOpen(false);
      setLibraryOpen(false);
      setSourceOpen(false);
      setDownloadOpen(false);
    } catch (error) {
      if (analyzeRef.current === controller)
        setInputError(
          controller.signal.aborted
            ? "打开视频超时，请重试。"
            : error instanceof Error
              ? error.message
              : "视频无法打开，请重试。",
        );
    } finally {
      clearTimeout(timeout);
      if (analyzeRef.current === controller) {
        setOpening(false);
        analyzeRef.current = undefined;
      }
    }
  }


  function partialFullDocument(
    snapshot: LearningDocument,
    source: SourceEvidence,
    sections: FullDocumentSection[],
    live?: FullDocumentSection,
  ) {
    const all = (live ? [...sections, live] : sections)
      .filter((section) => section.markdown.trim() || section.omitted)
      .sort((a, b) => a.index - b.index);
    if (!all.some((section) => section.markdown.trim())) return "";
    const assemble = snapshot.noteMode === "article"
      ? assemblePartialArticle
      : assemblePartialDocument;
    try {
      return assemble({
        title: snapshot.video.title,
        partTitle: partName(snapshot.video),
        videoUrl: snapshot.video.url,
        sourceLabel: source.label,
        totalCharacters:
          source.totalCharacters || sourceCharacterCount(source.cues),
        sections: all,
        generatedAt: Date.now(),
        platform: snapshot.video.platform,
        page: snapshot.video.selectedPage || 1,
        pageCount: snapshot.video.pages?.length || 1,
      });
    } catch {
      // Streaming may temporarily contain only a heading or an unfinished code fence.
      // Keep the received text recoverable; only the final assembly decides completion.
      return all.filter((section) => !section.omitted).map((section) => section.markdown).join("\n\n") +
        "\n\n> 内容尚未整理完成，以上是已收到的部分。";
    }
  }

  async function acquireFullSource(
    snapshot: LearningDocument,
    id: string,
    controller: AbortController,
  ): Promise<SourceEvidence> {
    if (snapshot.transcript.trim()) {
      const cues = normalizeFullSourceCues(parseTranscript(snapshot.transcript));
      if (sourceCharacterCount(cues) < 30)
        throw new Error("字幕文本太短，请粘贴至少 30 个字符的实际视频内容。");
      return buildFullEvidence(cues, "manual", "你提供的字幕文本");
    }
    let sourceVideo = snapshot.video;
    let subtitleIndex = snapshot.subtitleIndex;
    if (sourceVideo.platform === "bilibili") {
      setJob({ id, status: "正在重新检查本节字幕…" });
      const refreshed = await refreshVideoSource(
        sourceVideo,
        subtitleIndex,
        controller.signal,
        browserSubtitles,
        async (url, signal) =>
          json(
            await fetch("/api/video-info", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal,
              body: JSON.stringify({ url }),
            }),
          ),
        snapshot.video.subtitles[Number(snapshot.subtitleIndex)]?.lan,
      );
      sourceVideo = refreshed.video;
      subtitleIndex = refreshed.selected;
      if (snapshot.subtitleIndex !== "auto" && subtitleIndex === "auto")
        setNotice("原先选择的字幕已不可用，已切换为自动读取本节内容。");
      updateDocument(id, (value) => ({
        ...value,
        video: sourceVideo,
        subtitleIndex,
      }));
    }
    const subtitle =
      subtitleIndex === "auto"
        ? sourceVideo.subtitles[0]
        : sourceVideo.subtitles[Number(subtitleIndex)];
    setJob({ id, status: "正在读取本节全部字幕与时间码…" });
    const response = await fetch("/api/tutorial", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        mode: "transcript",
        videoUrl: sourceVideo.url,
        title: `${snapshot.video.title} · P${snapshot.video.selectedPage || 1} ${partName(snapshot.video)}`,
        transcript: "",
        transcriptOffset: 0,
        cid: sourceVideo.cid,
        subtitleUrl: subtitle?.subtitle_url || "",
        sourceMode: subtitleIndex === "auto" ? "auto" : "subtitle",
      }),
    });
    if (!response.ok) {
      await json(response);
      throw new Error("无法读取本节完整字幕，请重试。");
    }
    if (
      !response.body ||
      !response.headers.get("content-type")?.includes("text/event-stream")
    )
      throw new Error("字幕读取服务返回格式异常，请重试。");
    let transcript: SourceEvidence | undefined;
    let completed = false;
    await readSSE(response.body, (payload) => {
      if (controller.signal.aborted) return;
      if (payload === "[DONE]") {
        completed = true;
        return;
      }
      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        return;
      }
      if (event.error) throw new Error(event.error);
      if (event.status) setJob({ id, status: event.status });
      if (event.transcript) transcript = event.transcript as SourceEvidence;
    });
    if (!completed || !transcript?.cues?.length)
      throw new Error(
        "没有取得可核对的完整原文。请刷新来源，或在「来源与视频信息」中粘贴这一节的实际字幕后重试。",
      );
    const cues = normalizeFullSourceCues(transcript.cues);
    return buildFullEvidence(cues, transcript.kind, transcript.label);
  }

  async function requestFullSection(
    snapshot: LearningDocument,
    source: SourceEvidence,
    chunk: SourceCue[],
    index: number,
    total: number,
    controller: AbortController,
    onText: (text: string) => void,
    previousContext = "",
    nextContext = "",
  ) {
    setJob({
      id: snapshot.id,
      status: `正在整理第 ${index + 1}/${total} 段…`,
      done: index,
      total,
    });
    const response = await fetch("/api/tutorial", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        mode: snapshot.noteMode === "article" ? "article-section" : "full-section",
        ...(snapshot.noteMode === "article" ? { previousContext, nextContext } : {}),
        videoUrl: snapshot.video.url,
        title: `${snapshot.video.title} · P${snapshot.video.selectedPage || 1} ${partName(snapshot.video)}`,
        sourceCues: chunk,
        sourceKind: source.kind,
        sourceLabel: source.label,
        sectionIndex: index + 1,
        sectionTotal: total,
        transcriptOffset: 0,
        cid: snapshot.video.cid,
      }),
    });
    if (!response.ok) {
      await json(response);
      throw new Error(`第 ${index + 1} 段整理失败，请重试。`);
    }
    if (
      !response.body ||
      !response.headers.get("content-type")?.includes("text/event-stream")
    )
      throw new Error("整理服务返回格式异常，请重试。");
    let output = "";
    let warning = "";
    let completed = false;
    let omitted = false;
    await readSSE(response.body, (payload) => {
      if (controller.signal.aborted) return;
      if (payload === "[DONE]") {
        completed = true;
        return;
      }
      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        return;
      }
      if (event.error) throw new Error(event.error);
      if (event.noContent && snapshot.noteMode === "article") omitted = true;
      if (event.warning) warning = event.warning;
      if (event.status)
        setJob({
          id: snapshot.id,
          status: event.status,
          done: index,
          total,
        });
      if (event.text) {
        output += event.text;
        onText(event.text);
      }
    });
    if (warning)
      throw new Error(
        `第 ${index + 1} 段未完成：${warning} 已完成的其他段落会保留，可继续重试这一段。`,
      );
    if (omitted && output.trim())
      throw new Error(`第 ${index + 1} 段文稿状态异常，请重试。`);
    if (!completed || (!output.trim() && !omitted))
      throw new Error(`第 ${index + 1} 段没有返回内容，请重试。`);
    return { text: output, warning, omitted };
  }

  async function prepareMindMap(
    snapshot: LearningDocument,
    source: SourceEvidence,
    controller: AbortController,
    resume = true,
  ): Promise<boolean> {
    const id = snapshot.id;
    const chunks = chunkSourceCues(source.cues);
    const saved = current.current.documents[id]?.mindmap;
    const sameSource = saved?.source.kind === source.kind && saved.source.label === source.label &&
      saved.source.cues.length === source.cues.length && saved.source.cues.every((cue, index) =>
        cue.id === source.cues[index].id && cue.text === source.cues[index].text &&
        cue.start === source.cues[index].start && cue.end === source.cues[index].end);
    if (resume && sameSource && saved.status === "complete") return true;
    let sections: MindMapDocument["sections"] = resume && sameSource ? [...saved.sections] : [];
    const generatedAt = resume && sameSource ? saved.generatedAt : Date.now();
    const change = (patch: Partial<MindMapDocument>) => updateDocument(id, (value) => value.mindmap?.generatedAt === generatedAt
      ? { ...value, mindmap: { ...value.mindmap, ...patch, updatedAt: Date.now() }, updatedAt: Date.now() }
      : value);
    updateDocument(id, (value) => ({ ...value, mindmap: {
      version: 1, title: partName(snapshot.video), source, sections, totalSections: chunks.length,
      status: "running", generatedAt, updatedAt: Date.now(),
    } }));
    try {
      for (let index = sections.length; index < chunks.length; index++) {
        if (controller.signal.aborted) throw new Error("已停止");
        const response = await fetch("/api/tutorial", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ mode: "mindmap-section", videoUrl: snapshot.video.url,
            title: partName(snapshot.video), cid: snapshot.video.cid,
            sourceCues: chunks[index], sourceKind: source.kind, sourceLabel: source.label,
            sectionIndex: index + 1, sectionTotal: chunks.length }),
        });
        if (!response.ok) { await json(response); throw new Error("思维导图服务暂不可用，请重试。"); }
        if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream"))
          throw new Error("思维导图返回格式异常，请重试。");
        let section: ReturnType<typeof readMindMapSection>, completed = false;
        await readSSE(response.body, (payload) => {
          if (controller.signal.aborted) return;
          if (payload === "[DONE]") { completed = true; return; }
          let event;
          try { event = JSON.parse(payload); } catch { return; }
          if (event.error || event.warning) throw new Error(event.error || event.warning);
          if (event.mindmap) {
            section = readMindMapSection(event.mindmap, chunks[index].map((cue) => cue.id));
            if (!section) throw new Error("导图结构或来源未通过核对，已完成部分保留，请重试。");
          }
        });
        if (!completed || !section) throw new Error("导图连接中断，本段尚未完成，请继续整理。");
        sections = [...sections, { ...section, index, cueIds: chunks[index].map((cue) => cue.id) }];
        change({ sections, status: "running", error: undefined });
      }
      change({ status: "complete", error: undefined });
      return true;
    } catch (error) {
      change({ status: controller.signal.aborted ? "paused" : "error", error: controller.signal.aborted
        ? "思维导图已停止，已完成的结构保留，可以继续。"
        : error instanceof Error ? error.message : "导图整理失败，已完成部分保留。" });
      return false;
    }
  }

  async function generateMindMap(resume = true) {
    if (!active || jobRef.current) return;
    if (needsSource && !active.mindmap?.source) { setSourceOpen(true); return; }
    const snapshot = active, id = active.id, controller = new AbortController();
    jobRef.current = { id, controller, mode: "mindmap" };
    setResultView("mindmap"); setNotice("");
    setJob({ id, status: "正在准备思维导图的实际来源…" });
    try {
      const existing = resume ? snapshot.mindmap?.source : undefined;
      const evidence = resume ? snapshot.note?.evidence : undefined;
      const source = existing || (snapshot.transcript.trim()
        ? await acquireFullSource(snapshot, id, controller)
        : evidence?.coverage === "full" ? buildFullEvidence(normalizeFullSourceCues(evidence.cues), evidence.kind, evidence.label)
        : await acquireFullSource(snapshot, id, controller));
      setJob({ id, status: "正在整理思维导图的主题与细节…" });
      const complete = await prepareMindMap(snapshot, source, controller, resume);
      setNotice(complete ? "思维导图已准备好，可展开分支并查看原文。" : "导图未完成，已保存进度，可继续整理。");
    } catch (error) {
      setNotice(controller.signal.aborted ? "已停止读取，已有内容保留。" : error instanceof Error ? error.message : "无法取得导图来源，请重试。");
    } finally {
      if (jobRef.current?.controller === controller) { jobRef.current = null; setJob(null); }
      flush();
    }
  }

  async function generateFull(resume = false) {
    if (!active || jobRef.current) return;
    setNotice("");
    const writingMode = active.noteMode === "article" ? "article" : "full";
    const writingName = modeLabel(writingMode);
    resume = resume && (active.fullJob?.mode || "full") === writingMode;
    if (needsSource && !(resume && active.fullJob?.source)) {
      setSourceOpen(true);
      return;
    }
    const snapshot = active,
      id = active.id,
      controller = new AbortController();
    jobRef.current = { id, controller, mode: writingMode };
    setShowPrevious(false);
    const startedAt = (resume ? snapshot.fullJob?.startedAt : undefined) || Date.now();
    let source = resume ? snapshot.fullJob?.source : undefined;
    let sections: FullDocumentSection[] = resume
      ? [...(snapshot.fullJob?.sections || [])]
      : [];
    let chunks: SourceCue[][] = [];
    let totalSections = resume ? snapshot.fullJob?.totalSections || 0 : 0;
    let unfinishedSection: FullDocumentSection | undefined;
    let mapPromise: Promise<boolean> | undefined;
    setJob({
      id,
      status: `${resume ? "继续" : "准备生成"}${writingName}…`,
      done: sections.length,
      total: totalSections,
    });
    try {
      if (!resume || !source) {
        updateDocument(id, (value) => ({
          ...value,
          noteMode: writingMode,
          generationState: "running",
          note:
            value.note ||
            (value.draft?.text
              ? {
                  ...value.draft,
                  evidence: value.draft.evidence || value.fullJob?.source,
                }
              : undefined),
          fullJob: undefined,
          draft: {
            text: "",
            source: "",
            status: "partial",
            generatedAt: startedAt,
            mode: writingMode,
            sectionCount: 0,
          },
        }));
        source = await acquireFullSource(snapshot, id, controller);
        chunks = chunkSourceCues(source.cues);
        totalSections = chunks.length;
        if (totalSections > 10)
          setNotice(
            `本节字幕较长，将分 ${totalSections} 段整理。请保持页面打开；中断后可以继续整理。`,
          );
        updateDocument(id, (value) => ({
          ...value,
          noteMode: writingMode,
          generationState: "running",
          fullJob: {
            mode: writingMode,
            status: "running",
            source: source!,
            totalCharacters:
              source!.totalCharacters || sourceCharacterCount(source!.cues),
            totalSections,
            sections: [],
            startedAt,
            updatedAt: Date.now(),
          },
          draft: {
            text: "",
            source: source!.label,
            status: "partial",
            generatedAt: startedAt,
            mode: writingMode,
            sectionCount: 0,
          },
        }));
      } else {
        chunks = chunkSourceCues(source.cues);
        if (chunks.length !== totalSections) {
          totalSections = chunks.length;
          sections = sections.filter((section) => section.index < totalSections);
        }
        updateDocument(id, (value) => ({
          ...value,
          noteMode: writingMode,
          generationState: "running",
          fullJob: value.fullJob
            ? {
                ...value.fullJob,
                mode: writingMode,
                status: "running",
                error: undefined,
                totalSections,
                sections,
                updatedAt: Date.now(),
              }
            : undefined,
          draft: {
            text: partialFullDocument(snapshot, source!, sections),
            source: source!.label,
            status: "partial",
            generatedAt: startedAt,
            mode: writingMode,
            sectionCount: sections.length,
          },
        }));
      }
      const fullSource = source;
      if (!fullSource) throw new Error("没有取得可整理的原文，请重试。");
      mapPromise = prepareMindMap(snapshot, fullSource, controller).catch(() => false);
      setJob({
        id,
        status: `共 ${totalSections} 段，开始整理…`,
        done: sections.length,
        total: totalSections,
      });
      for (let index = sections.length; index < chunks.length; index++) {
        if (controller.signal.aborted) throw new Error("已停止");
        let live = "";
        let lastPaint = 0;
        const section = await requestFullSection(
          snapshot,
          fullSource,
          chunks[index],
          index,
          chunks.length,
          controller,
          (text) => {
            live += text;
            unfinishedSection = { index, markdown: live, cueIds: [] };
            const now = Date.now();
            if (now - lastPaint < 450) return;
            lastPaint = now;
            const preview = partialFullDocument(snapshot, fullSource, sections, {
              index,
              markdown: live,
              cueIds: [],
            });
            updateDocument(id, (value) =>
              value.draft
                ? { ...value, draft: { ...value.draft, text: preview } }
                : value,
            );
          },
          sections.slice().reverse().find((section) => section.markdown.trim())?.markdown.slice(-2400) || "",
          (chunks[index + 1] || []).map((cue) => cue.text).join("\n").slice(0, 800),
        );
        sections = [
          ...sections,
          {
            index,
            markdown: section.text,
            cueIds: chunks[index].map((cue) => cue.id),
            ...(section.omitted ? { omitted: true as const } : {}),
            ...(section.warning ? { warning: section.warning } : {}),
          },
        ];
        unfinishedSection = undefined;
        updateDocument(id, (value) => ({
          ...value,
          fullJob: {
            mode: writingMode,
            status: "running",
            source: fullSource,
            totalCharacters:
              fullSource.totalCharacters ||
              sourceCharacterCount(fullSource.cues),
            totalSections: chunks.length,
            sections,
            startedAt,
            updatedAt: Date.now(),
          },
          draft: {
            text: partialFullDocument(snapshot, fullSource, sections),
            source: fullSource.label,
            status: "partial",
            generatedAt: startedAt,
            mode: writingMode,
            sectionCount: sections.length,
          },
        }));
        setJob({
          id,
          status: `第 ${index + 1}/${chunks.length} 段已整理`,
          done: index + 1,
          total: chunks.length,
        });
      }
      const warnings = sections
        .filter((section) => section.warning)
        .map((section) => `第 ${section.index + 1} 段：${section.warning}`);
      const assemble = writingMode === "article" ? assembleArticle : assembleFullDocument;
      const finalText = assemble({
        title: snapshot.video.title,
        partTitle: partName(snapshot.video),
        videoUrl: snapshot.video.url,
        sourceLabel: fullSource.label,
        totalCharacters:
          fullSource.totalCharacters || sourceCharacterCount(fullSource.cues),
        sections,
        generatedAt: startedAt,
        platform: snapshot.video.platform,
        page: snapshot.video.selectedPage || 1,
        pageCount: snapshot.video.pages?.length || 1,
      });
      const result: LearningNote = {
        text: finalText,
        source: fullSource.label,
        evidence: buildFullEvidence(
          fullSource.cues,
          fullSource.kind,
          fullSource.label,
        ),
        status: warnings.length ? "partial" : "complete",
        error: warnings.length ? warnings.join("；") : undefined,
        generatedAt: startedAt,
        mode: writingMode,
        sectionCount: sections.length,
      };
      updateDocument(id, (value) => ({
        ...value,
        note: result,
        previousNote: value.note || value.previousNote,
        draft: undefined,
        fullJob: undefined,
        generationState: "idle",
        updatedAt: Date.now(),
      }));
      setJob({ id, status: `${writingName}已保存，正在完成思维导图…` });
      const mapComplete = await mapPromise;
      setNotice(`${writingName}已保存。${mapComplete ? "思维导图也已准备好。" : "导图尚未完成，可在导图视图继续。"}`);
    } catch (error) {
      const noArticleContent = writingMode === "article" && totalSections > 0 && sections.length === totalSections && sections.every((section) => section.omitted);
      const stopped = controller.signal.aborted;
      const message = controller.signal.aborted
        ? `${writingName}已停止，已完成的部分已保存。`
        : error instanceof Error
          ? error.message
          : `${writingName}生成失败，请重试。`;
      if (mapPromise) controller.abort();
      const preview = source
        ? partialFullDocument(snapshot, source, sections, unfinishedSection)
        : sections.length
          ? sections.map((section) => section.markdown).join("\n\n---\n\n")
          : "";
      updateDocument(id, (value) => ({
        ...value,
        generationState: "interrupted",
        fullJob: noArticleContent ? undefined : source
          ? {
              mode: writingMode,
              status: stopped ? "paused" : "error",
              source,
              totalCharacters:
                source.totalCharacters || sourceCharacterCount(source.cues),
              totalSections: totalSections || chunks.length || 1,
              sections,
              error: message,
              startedAt,
              updatedAt: Date.now(),
            }
          : value.fullJob,
        draft: {
          text: preview,
          source: source?.label || value.draft?.source || "",
          status: "partial",
          error: message,
          generatedAt: startedAt,
          mode: writingMode,
          sectionCount: sections.length,
          ...(noArticleContent && source ? { evidence: source } : {}),
        },
      }));
    } finally {
      await mapPromise;
      if (jobRef.current?.controller === controller) {
        jobRef.current = null;
        setJob(null);
      }
      flush();
    }
  }

  async function generate() {
    if (!active || jobRef.current || needsSource) return;
    setNotice("");
    if (active.transcript.trim() && active.transcript.trim().length < 30) {
      setSourceOpen(true);
      setNotice("请粘贴至少 30 个字符的实际视频内容。");
      return;
    }
    const snapshot = active,
      id = active.id,
      controller = new AbortController();
    jobRef.current = { id, controller, mode: "study" };
    setJob({ id, status: "正在读取本节内容…" });
    setShowPrevious(false);
    let output = "",
      source = "",
      evidence: SourceEvidence | undefined,
      warning = "",
      completed = false;
    let mapPromise: Promise<boolean> | undefined;
    const generatedAt = Date.now();
    updateDocument(id, (value) => ({
      ...value,
      noteMode: "study",
      generationState: "running",
      fullJob: undefined,
      updatedAt: generatedAt,
      note: value.note || (value.draft?.text ? value.draft : undefined),
      draft: { text: "", source: "", status: "partial", generatedAt },
    }));
    contentRef.current?.focus({ preventScroll: true });
    const timeout = setTimeout(() => controller.abort(), 210000);
    let lastDraftAt = 0;
    const storeDraft = (error?: string) => {
      const now = Date.now();
      if (!error && now - lastDraftAt < 300) return;
      lastDraftAt = now;
      updateDocument(id, (value) => ({
        ...value,
        draft: {
          text: output,
          source,
          evidence,
          status: "partial",
          error,
          generatedAt,
          mode: "study",
        },
      }));
    };
    try {
      let sourceVideo = snapshot.video,
        subtitleIndex = snapshot.subtitleIndex;
      if (!snapshot.transcript.trim() && sourceVideo.platform === "bilibili") {
        setJob({ id, status: "正在重新检查本节字幕…" });
        const refreshed = await refreshVideoSource(
          sourceVideo,
          subtitleIndex,
          controller.signal,
          browserSubtitles,
          async (url, signal) =>
            json(
              await fetch("/api/video-info", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal,
                body: JSON.stringify({ url }),
              }),
            ),
        );
        sourceVideo = refreshed.video;
        subtitleIndex = refreshed.selected;
        if (snapshot.subtitleIndex !== "auto" && subtitleIndex === "auto")
          setNotice("原先选择的字幕已不可用，已切换为自动读取本节内容。");
        updateDocument(id, (value) => ({
          ...value,
          video: sourceVideo,
          subtitleIndex,
        }));
      }
      const subtitle =
        subtitleIndex === "auto"
          ? sourceVideo.subtitles[0]
          : sourceVideo.subtitles[Number(subtitleIndex)];
      const response = await fetch("/api/tutorial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          videoUrl: snapshot.video.url,
          title: `${snapshot.video.title} · P${snapshot.video.selectedPage || 1} ${partName(snapshot.video)}`,
          transcript: snapshot.transcript,
          transcriptOffset: snapshot.transcriptOffset,
          cid: snapshot.video.cid,
          subtitleUrl: subtitle?.subtitle_url || "",
          sourceMode: subtitleIndex === "auto" ? "auto" : "subtitle",
        }),
      });
      if (!response.ok) {
        await json(response);
        return;
      }
      if (
        !response.body ||
        !response.headers.get("content-type")?.includes("text/event-stream")
      )
        throw new Error("生成服务返回格式异常，请重试。");
      await readSSE(response.body, (payload) => {
        if (controller.signal.aborted) return;
        if (payload === "[DONE]") {
          completed = true;
          return;
        }
        let event;
        try {
          event = JSON.parse(payload);
        } catch {
          return;
        }
        if (event.error) throw new Error(event.error);
        if (event.status) setJob({ id, status: event.status });
        if (event.source) source = event.source;
        if (event.evidence) {
          evidence = event.evidence;
          if (!mapPromise && evidence?.coverage === "full" && evidence.cues?.length) {
            const mapSource = buildFullEvidence(normalizeFullSourceCues(evidence.cues), evidence.kind, evidence.label);
            mapPromise = prepareMindMap(snapshot, mapSource, controller).catch(() => false);
          }
        }
        if (event.warning) warning = event.warning;
        if (event.text) output += event.text;
        storeDraft(warning || undefined);
      });
      if (!completed || !output.trim())
        throw new Error("生成中断或没有内容，请重试。");
      const result: LearningNote = {
        text: output,
        source,
        evidence,
        status: warning ? "partial" : "complete",
        error: warning || undefined,
        generatedAt,
        mode: "study",
      };
      updateDocument(id, (value) => ({
        ...value,
        note: result,
        previousNote: value.note || value.previousNote,
        draft: undefined,
        generationState: "idle",
        updatedAt: Date.now(),
      }));
      if (mapPromise) {
        clearTimeout(timeout);
        setJob({ id, status: "笔记已保存，正在完成思维导图…" });
        await mapPromise;
      }
    } catch (error) {
      const message = controller.signal.aborted
        ? "生成已停止或超时，已收到的内容保留。"
        : error instanceof Error
          ? error.message
          : "生成失败，请重试。";
      if (mapPromise) controller.abort();
      storeDraft(message);
      updateDocument(id, (value) => ({
        ...value,
        generationState: "interrupted",
      }));
    } finally {
      clearTimeout(timeout);
      await mapPromise;
      if (jobRef.current?.controller === controller) {
        jobRef.current = null;
        setJob(null);
      }
      flush();
    }
  }

  function exportNote(item = active, note = shownNote, includeArticleSource = false) {
    if (!item) return;
    const title = partName(item.video);
    const article = note?.mode === "article";
    if (!includeArticleSource) {
      let body = articleMarkdown(note?.text || "");
      if (!body.trim().startsWith("# ")) body = `${articleMarkdown(`# ${title}`).trim()}\n\n${body}`;
      if (note?.status === "partial") body += `\n> 本文尚未整理完成：${note.error || "仅包含已保存内容。"}\n`;
      saveTextFile(body, markdownFileName(title, article ? "完整文稿" : note?.mode === "full" ? "学习笔记" : "摘要"));
      return;
    }
    const full = note?.mode === "full" || article;
    const evidence = note?.evidence || item.fullJob?.source;
    const cues = evidence?.cues || [];
    const markdown = articleMarkdown(note?.text || "");
    const references = cues.length
      ? full
        ? `\n\n## 附：完整字幕原文（可核对）\n\n` +
          cues
            .map((cue) => {
              return `- **原文 ${cue.id}** ${articleMarkdown(cue.text).trim().replace(/\n/g, "\n  ")}`;
            })
            .join("\n\n")
        : `\n\n## 来源原文\n\n` +
          cues
            .map((cue) => {
              return `[^source-${cue.id}]: ${articleMarkdown(cue.text).trim().replace(/\n/g, "\n    ")}`;
            })
            .join("\n\n")
      : "";
    const metadata = [
      `来源：${item.video.url}`,
      `依据：${note?.source || "未生成"}`,
      `覆盖：${full && note?.status === "partial" ? "已取得原文，正文尚未全部整理" : coverage(evidence)}`,
      full ? `整理方式：${article ? "完整文稿" : "学习笔记"} · ${note?.sectionCount || 0} 段` : "整理方式：简短摘要",
      evidence?.limitation ? `说明：${evidence.limitation}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const warning =
      note?.status === "partial" || note?.error
        ? `\n\n> 注意：内容未完成。${note.error || ""}\n`
        : "";
    const body =
      full && markdown.trim().startsWith("# ")
        ? markdown
        : `${articleMarkdown(`# ${title}`).trim()}\n\n${markdown}`;
    const text = `${body}\n\n> ${metadata.replace(/\n/g, "  \n> ")}\n${warning}${references}\n\n## 我的备注\n\n${item.memo || "暂无备注"}\n${
      !full && item.transcript
        ? `\n## 待整理的输入文本\n\n${articleMarkdown(item.transcript)}\n`
        : ""
    }`;
    saveTextFile(
      text,
      markdownFileName(title, article ? "完整文稿-附原文" : full ? "完整文档" : "学习笔记"),
    );
  }
  function exportCourse(source = active || document) {
    if (!source) return;
    const pages = source.video.pages || [];
    if (pages.length < 2) {
      setNotice("当前是单节视频，直接导出这一节的完整文档即可。");
      return;
    }
    const entries = pages.flatMap((part) => {
      const item =
        current.current.documents[documentId(partUrl(source.video, part.page))];
      return item?.note ? [{ part, item, note: item.note }] : [];
    });
    if (!entries.length) {
      setNotice("还没有已整理的章节。先把需要的章节整理出来，再合并导出。");
      return;
    }
    const body = entries
      .map(({ part, item, note }) => {
        const markdown = articleMarkdown(note.text).replace(/^#\s+[^\n]*\n+/, "");
        const incomplete =
          note.status === "partial"
            ? `> 本节尚未完成：${note.error || "仅包含已保存的部分内容。"}\n\n`
            : "";
        return `${articleMarkdown(`## ${part.title}`).trim()}\n\n${incomplete}${markdown}`;
      })
      .join("\n\n---\n\n");
    const completed = entries.filter(({ note }) => note.status === "complete").length;
    const text = `${articleMarkdown(`# ${source.video.title}`).trim()}\n\n${completed < entries.length ? "> 合集包含尚未完成的章节，已在各节标明。\n\n" : ""}${body}\n`;
    saveTextFile(
      text,
      markdownFileName(source.video.title, `已整理${entries.length}节`),
    );
  }

  async function copyNote() {
    try {
      await navigator.clipboard.writeText(
        shownArticle ? articleMarkdown(shownNote?.text || "") : tutorialMarkdown(shownNote?.text || ""),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice("复制失败，请选中正文手动复制，或导出笔记。");
    }
  }
  function removeDocument(item: LearningDocument) {
    if (jobRef.current?.id === item.id) {
      setNotice("请先停止这一节的生成，再删除笔记。");
      return;
    }
    setDeleted(item);
    commit((state) => {
      const documents = { ...state.documents };
      delete documents[item.id];
      return {
        ...state,
        documents,
        activeId:
          state.activeId === item.id
            ? Object.keys(documents)[0] || null
            : state.activeId,
      };
    });
  }
  function openCitation(id: string) {
    if (!sourceCues.some((cue) => cue.id === id)) return;
    setSelectedCue(id);
    setSourceOpen(true);
  }
  const directory =
    active?.video.pages?.filter(
      (part) =>
        !filter ||
        `${part.page} ${part.title}`
          .toLowerCase()
          .includes(filter.toLowerCase()),
    ) || [];
  const nextPart = active?.video.pages?.find(
    (part) => part.page === (active.video.selectedPage || 1) + 1,
  );
  const navigation = active && (
    <>
      <div className="course-caption">
        {active.video.thumbnail && (
          <img
            src={`/api/image-proxy?url=${encodeURIComponent(active.video.thumbnail)}`}
            alt=""
          />
        )}
        <span>
          {active.video.platform === "bilibili" ? "B 站" : "YouTube"}
          <br />
          <strong>{active.video.uploader}</strong>
        </span>
      </div>
      <h2 className="course-title">{active.video.title}</h2>
      <div className="course-count">
        {active.video.pages?.length || 1} 节内容 · 每次整理一节
      </div>
      {(active.video.pages?.length || 0) > 1 ? (
        <>
          <label className="search-field">
            <Search size={15} />
            <input
              aria-label="查找课程章节"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="查找这一节"
            />
          </label>
          <nav className="course-list" aria-label="课程章节">
            {directory.map((part) => {
              const stored =
                workspace.documents[
                  documentId(partUrl(active.video, part.page))
                ];
              return (
                <button
                  key={part.cid}
                  className={`course-item ${part.page === (active.video.selectedPage || 1) ? "selected" : ""}`}
                  aria-current={
                    part.page === (active.video.selectedPage || 1)
                      ? "page"
                      : undefined
                  }
                  onClick={() => openVideo(partUrl(active.video, part.page))}
                >
                  <span className="part-number">
                    {String(part.page).padStart(2, "0")}
                  </span>
                  <span>
                    <strong>{part.title}</strong>
                    <small>
                      {duration(part.duration)} · {noteState(stored)}
                    </small>
                  </span>
                </button>
              );
            })}
            {!directory.length && (
              <p className="muted small">没有匹配的章节。</p>
            )}
          </nav>
        </>
      ) : (
        <p className="muted small">当前是一节独立视频。</p>
      )}
      <button
        className="sidebar-library text-button"
        onClick={() => setLibraryOpen(true)}
      >
        <Library size={16} />
        我的笔记 <span>{noteDocuments.length}</span>
      </button>
    </>
  );

  return (
    <main className={active ? "application working" : "application"}>
      <header className="topbar">
        <button
          className="brand"
          onClick={() => {
            setHome(true);
            window.scrollTo({ top: 0 });
          }}
          aria-label="BiliHelper 首页"
        >
          <span className="brand-mark">
            <BookOpen size={20} />
          </span>
          <span>
            Bili<span className="accent">Helper</span>
            <small>视频学习笔记</small>
          </span>
        </button>
        <div className="topbar-actions">
          <span className={`save-indicator ${saveStatus}`} role="status">
            {saveStatus === "saved" ? (
              <Check size={14} />
            ) : saveStatus === "saving" ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <ShieldCheck size={14} />
            )}
            {saveStatus === "saved"
              ? "已保存在这台设备"
              : saveStatus === "saving"
                ? "保存中…"
                : "未能保存"}
          </span>
          <button
            className="secondary library-button"
            aria-label="我的笔记"
            onClick={() => setLibraryOpen(true)}
          >
            <Library size={16} />
            <span>我的笔记</span>
          </button>
        </div>
      </header>
      {!ready && (
        <p className="loading-workspace">
          <Loader2 className="spin" size={18} />
          正在打开你的工作台…
        </p>
      )}
      {ready && (
        <>
          {saveStatus === "failed" && (
            <div className="storage-warning" role="alert">
              {saveError || "本机保存失败，请导出重要笔记。"}
              <button className="text-button" onClick={flush}>
                重试保存
              </button>
              {active && (
                <button className="text-button" onClick={() => exportNote()}>
                  导出当前笔记
                </button>
              )}
            </div>
          )}
          {job && job.id !== active?.id && (
            <div className="background-job" role="status">
              <Loader2 size={15} className="spin" />
              正在整理 P{workspace.documents[job.id]?.video.selectedPage ||
                1} · {job.status}
              <button className="text-button" onClick={() => openSaved(job.id)}>
                查看进度
              </button>
              <button
                className="text-button"
                onClick={() => jobRef.current?.controller.abort()}
              >
                停止
              </button>
            </div>
          )}
          {!active ? (
            <section className="landing">
              <div className="landing-copy">
                <div className="eyebrow">
                  <span />
                  从视频，到自己的理解
                </div>
                <h1>
                  这一节，
                  <br />
                  留给下次的自己。
                </h1>
                <p className="landing-description">
                  把视频全篇整理成一篇完整文章。
                  <br />
                  保留讲述、例子和细节，只删废话与重复。
                </p>
                <form
                  className="import-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    openVideo(input);
                  }}
                >
                  <label className="link-input">
                    <Link2 size={20} />
                    <input
                      aria-label="视频链接"
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      placeholder="粘贴链接、分享文本或 BV 号"
                    />
                  </label>
                  <button
                    className="primary"
                    disabled={opening || !input.trim()}
                  >
                    {opening ? (
                      <Loader2 size={17} className="spin" />
                    ) : (
                      <ArrowRight size={17} />
                    )}
                    打开视频
                  </button>
                </form>
                {inputError && (
                  <p className="input-error" role="alert">
                    {inputError}
                  </p>
                )}
                <p className="small muted support-line">
                  支持 B 站视频、分 P、短链接与 YouTube
                </p>
                <button
                  className="text-button example-link"
                  onClick={() => openVideo(EXAMPLE)}
                >
                  试着打开一节 Python 课程 <ArrowRight size={14} />
                </button>
                {document && (
                  <button
                    className="continue-card"
                    onClick={() => openSaved(document.id)}
                  >
                    <span className="eyebrow">继续上次</span>
                    <strong>{partName(document.video)}</strong>
                    <span className="small muted">
                      P{document.video.selectedPage || 1} ·{" "}
                      {noteState(document)}
                      <ArrowRight size={15} />
                    </span>
                  </button>
                )}
              </div>
              <div className="note-preview" aria-label="完整文稿功能示意">
                <div className="preview-top">
                  <span className="preview-dots">● ● ●</span>
                  <span>完整文稿 · 功能示意</span>
                </div>
                <div className="preview-page">
                  <div className="preview-label">
                    <FileText size={14} />
                    从整段讲述，到一篇文章
                  </div>
                  <h2>
                    从看过，
                    <br />
                    到下次用得上。
                  </h2>
                  <div className="preview-source">
                    <ShieldCheck size={14} />
                    当前这一节 · 来源 · 覆盖范围
                  </div>
                  <div className="preview-section">
                    <span>01</span>
                    <div>
                      <h3>完整讲述，连贯成文</h3>
                      <p>保留原来的展开、论证和例子。</p>
                    </div>
                  </div>
                  <div className="preview-section">
                    <span>02</span>
                    <div>
                      <h3>只做必要的编辑</h3>
                      <p>去掉废话和重复，留下每一处实质细节。</p>
                    </div>
                  </div>
                  <div className="preview-memo">
                    <span>我的备注</span>
                    <p>把自己的理解也留下来。</p>
                    <div className="preview-line" />
                  </div>
                  <div className="preview-saved">
                    <Check size={13} />
                    笔记和备注，留在这台设备
                  </div>
                </div>
              </div>
              <div className="landing-bottom">
                <span>
                  <ShieldCheck size={17} />
                  根据实际内容整理
                </span>
                <span>
                  <BookOpen size={17} />
                  一节一份，可回来继续
                </span>
                <span>
                  <ArrowDownToLine size={17} />
                  随时导出 Markdown
                </span>
              </div>
              {legacy.length > 0 && (
                <details className="legacy-history">
                  <summary>之前打开过的视频</summary>
                  {legacy.map((item) => (
                    <button
                      className="text-button"
                      key={item.url}
                      onClick={() => openVideo(item.url)}
                    >
                      {item.title}
                      <ArrowRight size={13} />
                    </button>
                  ))}
                </details>
              )}
            </section>
          ) : (
            <>
              <div className="workspace-toolbar">
                <form
                  className="compact-import"
                  onSubmit={(event) => {
                    event.preventDefault();
                    openVideo(input);
                  }}
                >
                  <Plus size={16} />
                  <input
                    aria-label="视频链接"
                    placeholder="打开其他视频：链接或 BV 号"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                  />
                  <button
                    className="text-button"
                    disabled={opening || !input.trim()}
                  >
                    {opening ? <Loader2 size={15} className="spin" /> : "打开"}
                  </button>
                </form>
                <button
                  className="text-button"
                  onClick={() => setSourceOpen(true)}
                >
                  来源与视频信息 <ExternalLink size={14} />
                </button>
              </div>
              {inputError && (
                <p className="input-error workspace-error" role="alert">
                  {inputError}
                </p>
              )}
              <div className="workspace">
                <aside className="course-sidebar">{navigation}</aside>
                <section
                  className="learning-document"
                  ref={contentRef}
                  tabIndex={-1}
                  aria-label="当前节学习笔记"
                >
                  <div className="document-kicker">
                    <span>
                      P{String(active.video.selectedPage || 1).padStart(2, "0")}{" "}
                      <span className="muted">
                        / {active.video.pages?.length || 1}
                      </span>
                    </span>
                    <span>
                      {active.video.duration
                        ? duration(active.video.duration)
                        : "时长未提供"}
                    </span>
                    {(active.video.pages?.length || 0) > 1 && (
                      <button
                        className="directory-button text-button"
                        onClick={() => setDirectoryOpen(true)}
                      >
                        <List size={16} />
                        课程目录
                      </button>
                    )}
                  </div>
                  <h1 className="document-title">{partName(active.video)}</h1>
                  <button
                    className="source-strip"
                    onClick={() => {
                      setSelectedCue("");
                      setSourceOpen(true);
                    }}
                  >
                    <ShieldCheck size={16} />
                    <span>
                      {shownNote?.source || sourceEvidence?.label ||
                        (active.transcript.trim()
                          ? "你提供的字幕文本"
                          : active.video.hasSubtitles
                            ? "当前节有平台字幕"
                            : needsSource
                              ? "当前节需要补充内容"
                              : "可尝试自动提取内容")}
                      <small>
                        {shownNote
                          ? `${active.fullJob ? "已读取原文，正文尚未全部完成" : coverage(shownNote.evidence)}${
                              shownNote.mode === "full" || shownNote.mode === "article"
                                ? active.fullJob
                                  ? ` · 已完成 ${fullSections.length}/${active.fullJob.totalSections} 段`
                                  : ` · ${shownNote.sectionCount || 0} 段`
                                : ""
                            }`
                          : active.fullJob
                            ? `完整整理中 · 已完成 ${fullSections.length}/${active.fullJob.totalSections} 段`
                            : needsSource
                              ? "取得实际内容后再整理"
                              : "只根据读取到的内容生成"}
                      </small>
                    </span>
                    <ChevronDown size={16} />
                  </button>
                  {(shownNote?.evidence || active.fullJob?.source)?.limitation && (
                    <p className="coverage-notice">
                      {
                        (shownNote?.evidence || active.fullJob?.source)!
                          .limitation
                      }
                    </p>
                  )}
                  <div className="note-mode-switch" role="group" aria-label="整理方式">
                    <button
                      className={noteMode === "article" ? "active" : ""}
                      disabled={active.generationState === "running"}
                      aria-pressed={noteMode === "article"}
                      onClick={() => updateDocument(active.id, (value) => ({ ...value, noteMode: "article" }))}
                    >
                      完整文稿 <span className="mode-new">新</span>
                      <small>全篇写成文章，只删废话和重复</small>
                    </button>
                    <button
                      className={noteMode === "full" ? "active" : ""}
                      disabled={active.generationState === "running"}
                      aria-pressed={noteMode === "full"}
                      onClick={() =>
                        updateDocument(active.id, (value) => ({
                          ...value,
                          noteMode: "full",
                        }))
                      }
                    >
                      学习笔记
                      <small>按主题、知识和步骤整理</small>
                    </button>
                    <button
                      className={noteMode === "study" ? "active" : ""}
                      disabled={active.generationState === "running"}
                      aria-pressed={noteMode === "study"}
                      onClick={() =>
                        updateDocument(active.id, (value) => ({
                          ...value,
                          noteMode: "study",
                        }))
                      }
                    >
                      简短摘要
                      <small>只看要点，每次一个片段</small>
                    </button>
                  </div>
                  {noteMode === "article" && (
                    <p className="small muted">
                      完整保留优先：无法确认的删改保留原文，少量口语可能保留。
                    </p>
                  )}
                  <div className="document-actions">
                    <div>
                      {active.generationState === "running" ? (
                        <div className="generation-status" role="status">
                          <Loader2 size={17} className="spin" />
                          <span>
                            {job?.id === active.id ? job.status : "正在整理…"}
                          </span>
                          {!!job?.total && (
                            <span className="job-count">
                              {job.done || 0}/{job.total}
                            </span>
                          )}
                          <button
                            className="secondary"
                            onClick={() => jobRef.current?.controller.abort()}
                          >
                            <Square size={13} />
                            停止整理
                          </button>
                          {!!job?.total && (
                            <progress
                              className="job-progress"
                              value={job.done || 0}
                              max={job.total}
                            />
                          )}
                        </div>
                      ) : (
                        <button
                          className={shownNote?.text ? "secondary" : "primary"}
                          disabled={!!job || opening}
                          onClick={() => {
                            if (needsSource && !canResumeFull) {
                              setSourceOpen(true);
                            } else if (longForm) {
                              generateFull(canResumeFull);
                            } else {
                              generate();
                            }
                          }}
                        >
                          {needsSource ? (
                            <Plus size={16} />
                          ) : (
                            <Sparkles size={16} />
                          )}
                          {needsSource
                            ? "补充字幕"
                            : longForm
                              ? canResumeFull
                                ? `继续整理 · ${fullSections.length}/${active.fullJob?.totalSections || "?"} 段`
                                : shownNote?.text && shownNote.mode === noteMode
                                  ? `重新生成${outputName}`
                                  : `生成${outputName}`
                              : shownNote?.text
                                ? "重新生成学习笔记"
                                : active.transcriptOffset > 0 ||
                                    totalCharacters > 20000
                                  ? "整理所选片段"
                                  : "生成学习笔记"}
                        </button>
                      )}
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setDownloadOpen(true)}
                    >
                      <ArrowDownToLine size={15} />
                      保存视频
                    </button>
                  </div>
                  <div className="result-view-switch" role="tablist" aria-label="内容视图" onKeyDown={(event) => {
                    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                    event.preventDefault();
                    const view = event.key === "Home" ? "text" : event.key === "End" ? "mindmap" : resultView === "text" ? "mindmap" : "text";
                    setResultView(view);
                    event.currentTarget.querySelector<HTMLButtonElement>(view === "text" ? "#text-view-tab" : "#map-view-tab")?.focus();
                  }}>
                    <button id="text-view-tab" role="tab" tabIndex={resultView === "text" ? 0 : -1} aria-selected={resultView === "text"} aria-controls="text-view" onClick={() => setResultView("text")}><FileText size={16} />正文</button>
                    <button id="map-view-tab" role="tab" tabIndex={resultView === "mindmap" ? 0 : -1} aria-selected={resultView === "mindmap"} aria-controls="map-view" onClick={() => setResultView("mindmap")}><Network size={16} />思维导图{active.mindmap?.status === "running" && <Loader2 size={13} className="spin" />}</button>
                  </div>
                  {resultView === "mindmap" ? <section id="map-view" role="tabpanel" aria-labelledby="map-view-tab">
                    <div className="mindmap-state">
                      <div role="status">
                        {active.mindmap ? <>
                          <strong>{active.mindmap.status === "complete" ? "思维导图已完成" : active.mindmap.status === "running" ? "正在细化主题与层级" : "思维导图尚未完成"}</strong>
                          <p>{active.mindmap.source.label} · 已完成 {active.mindmap.sections.length}/{active.mindmap.totalSections} 段{active.mindmap.status !== "complete" ? "，可先浏览原文结构" : ""}</p>
                          {active.mindmap.status === "running" && <progress value={active.mindmap.sections.length} max={active.mindmap.totalSections} />}
                          {active.mindmap.error && <p className="map-error">{active.mindmap.error}</p>}
                          {active.mindmap.status === "complete" && active.mindmap.sections.some((section) => section.fallback) && <p>部分分支按原文组织，细节均可查看依据。</p>}
                        </> : <><strong>把这一节的内容，展开看清楚</strong><p>{job?.id === active.id ? "取得实际字幕后会自动准备导图。" : "根据当前节的实际字幕，逐层展开主题、例子、操作与条件。"}</p></>}
                      </div>
                      <div className="mindmap-state-actions">
                        {job?.id === active.id ? <button className="text-button" onClick={() => jobRef.current?.controller.abort()}><Square size={13} />停止本次解析</button>
                          : <button className="secondary" disabled={!!job} onClick={() => void generateMindMap(active.mindmap?.status !== "complete")}><Network size={15} />{active.mindmap ? active.mindmap.status === "complete" ? "重新生成导图" : "继续整理导图" : shownNote?.evidence?.coverage === "full" ? "从已保存原文生成导图" : "读取视频并生成导图"}</button>}
                      </div>
                    </div>
                    {mapRoot?.children.length ? <MindMap key={active.id} root={mapRoot} complete={active.mindmap?.status === "complete"} onSource={openCitation} />
                      : active.mindmap?.status === "complete" ? <div className="empty-document"><Network size={30} /><h2>没有可整理的实质内容</h2><p>这份来源仅包含可略去的寒暄。原文仍可在内容来源中核对。</p></div>
                      : <div className="empty-document"><Network size={30} /><h2>先有真实内容，再展开结构</h2><p>解析后会形成可缩放、折叠、搜索和核对来源的详细导图。</p></div>}
                  </section> : <div id="text-view" role="tabpanel" aria-labelledby="text-view-tab">
                  {shownNote?.text && (shownNote.mode || "study") !== noteMode && !job && (
                    <p className="mode-result-notice">
                      下面是已保存的{modeLabel(shownNote.mode)}。选择方式只影响下次生成；新内容生成成功后，可查看上一版。
                    </p>
                  )}
                  {job && job.id !== active.id && (
                    <p className="small muted">
                      另一节正在生成，完成或停止后可整理这一节。
                    </p>
                  )}
                  {active.fullJob && !canResumeFull && !job && (
                    <p className="mode-result-notice">
                      {modeLabel(fullJobMode)}还有未完成的进度。
                      <button className="text-button" onClick={() => updateDocument(active.id, (value) => ({ ...value, noteMode: fullJobMode }))}>
                        切回继续
                      </button>
                      开始新的生成会替换这份进度。
                    </p>
                  )}
                  {active.fullJob && canResumeFull &&
                    active.generationState !== "running" &&
                    fullSections.length > 0 && (
                      <div className="notice full-job-notice" role="status">
                        <strong>
                          {outputName}已完成 {fullSections.length}/
                          {active.fullJob.totalSections} 段
                        </strong>
                        <p>
                          {active.fullJob.error ||
                            "继续整理只会处理尚未完成的段落，不会重复调用已完成内容。"}
                          继续整理会沿用上次来源；修改材料后会开始新的整理。
                        </p>
                        <button
                          className="text-button"
                          disabled={!!job}
                          onClick={() => generateFull(false)}
                        >
                          重新开始
                        </button>
                        <button
                          className="text-button"
                          onClick={() => setSourceOpen(true)}
                        >
                          检查内容来源
                        </button>
                      </div>
                    )}
                  {shownNote?.error && !generationError && (
                    <div className="notice" role="alert">
                      <strong>这份内容未完成</strong>
                      <p>{shownNote.error}</p>
                    </div>
                  )}
                  {(generationError ||
                    active.generationState === "interrupted") &&
                    !(canResumeFull && fullSections.length > 0) && (
                    <div className="notice" role="alert">
                      <strong>这次生成未完成</strong>
                      <p>
                        {generationError ||
                          "上次生成被中断，已保存的内容仍在。"}
                      </p>
                      <button
                        className="text-button"
                        disabled={!!job}
                        onClick={() => {
                          if (needsSource) setSourceOpen(true);
                          else if (longForm)
                            generateFull(canResumeFull);
                          else generate();
                        }}
                      >
                        {needsSource
                          ? "补充字幕"
                          : longForm
                            ? `重试${outputName}`
                            : "重试"}
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setSourceOpen(true)}
                      >
                        检查内容来源
                      </button>
                    </div>
                  )}
                  {priorNote && (
                    <div className="version-switch">
                      <span>
                        {showPrevious
                          ? "正在查看上一版"
                          : active.draft?.text
                            ? "未完成草稿 · 原笔记已保留"
                            : "当前版本"}
                      </span>
                      <button
                        className="text-button"
                        onClick={() => setShowPrevious((value) => !value)}
                      >
                        <Undo2 size={14} />
                        {showPrevious ? "查看当前内容" : "查看上一版"}
                      </button>
                    </div>
                  )}
                  {shownNote?.text ? (
                    <article className={`note-content${shownArticle ? " article-prose" : ""}`} aria-label={shownArticle ? "完整文稿正文" : "笔记正文"}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        urlTransform={(url) =>
                          /^source:\d+$/.test(url)
                            ? url
                            : defaultUrlTransform(url)
                        }
                        components={{
                          a: ({ href, children }) =>
                            href?.startsWith("source:") ? (
                              sourceCues.some(
                                (cue) => cue.id === href.slice(7),
                              ) ? (
                                <button
                                  className="citation"
                                  onClick={() => openCitation(href.slice(7))}
                                >
                                  {children}
                                  <ExternalLink size={11} />
                                </button>
                              ) : (
                                <span>{children}</span>
                              )
                            ) : (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {children}
                              </a>
                            ),
                        }}
                      >
                        {shownArticle
                          ? articleMarkdown(shownNote.text).replace(/^#\s+[^\n]*\n+/, "")
                          : tutorialMarkdown(shownNote.text)}
                      </ReactMarkdown>
                    </article>
                  ) : active.generationState === "running" ? (
                    <div className="preparing">
                      <div className="skeleton-line" />
                      <div className="skeleton-line" />
                      <div className="skeleton-line short" />
                      <p>取得实际内容后，笔记会出现在这里。</p>
                    </div>
                  ) : (
                    <div className="empty-document">
                      <BookOpen size={30} />
                      <h2>
                        {needsSource
                          ? "先把这一节的内容补上"
                          : noteMode === "article"
                            ? "把整段讲述，写成一篇文章"
                          : noteMode === "full"
                            ? "把这一节完整整理下来"
                            : "把这一节留下来"}
                      </h2>
                      <p>
                        {needsSource
                          ? "目前无法读取这一节的字幕。粘贴实际字幕或转录文本，就能继续整理。"
                          : noteMode === "article"
                            ? "保留原来的讲述、例子、推导和所有细节，只去掉寒暄、广告与重复。长视频逐段处理，最后连成一篇完整文稿。"
                          : noteMode === "full"
                            ? "逐段整理全部字幕，生成一份完整、可核对、可导出的 Markdown 文档。你的备注会自动保存在这台设备。"
                            : "整理本节目的、关键知识和原文中的步骤。你的笔记与备注会自动保存在这台设备。"}
                      </p>
                      <div>
                        <span>
                          {longForm ? "覆盖全部字幕" : "有依据的要点"}
                        </span>
                        <span>可恢复的笔记</span>
                        <span>自己的理解</span>
                      </div>
                    </div>
                  )}
                  {shownNote?.text && (
                    <div className="note-tools">
                      <span className="small muted">
                        {shownArticle
                          ? shownNote.status === "partial" ? "文稿未完成" : "完整文稿"
                          : shownNote.mode === "full"
                          ? `完整文档 · ${shownNote.sectionCount || 0} 段`
                          : shownNote.status === "partial"
                            ? "未完成内容"
                            : "生成完成"}{" "}
                        ·{" "}
                        {new Date(shownNote.generatedAt).toLocaleDateString(
                          "zh-CN",
                        )}
                      </span>
                      <button className="text-button" onClick={copyNote}>
                        {copied ? <Check size={15} /> : <Copy size={15} />}
                        {copied ? "已复制" : shownArticle ? "复制文稿" : "复制笔记"}
                      </button>
                      <button
                        className="text-button"
                        onClick={() => exportNote()}
                      >
                        <ArrowDownToLine size={15} />
                        {shownArticle
                          ? "导出文稿"
                          : shownNote.mode === "full"
                          ? "导出 Markdown"
                          : "导出 Markdown"}
                      </button>
                      {shownNote?.text && (
                        <button className="text-button" onClick={() => exportNote(active, shownNote, true)}>
                          导出核对稿（附原文）
                        </button>
                      )}
                    </div>
                  )}
                  </div>}
                  <section className="personal-memo">
                    <label htmlFor="personal-memo">
                      <span className="memo-icon">✎</span>
                      <strong>我的备注</strong>
                      <span>留下自己的理解</span>
                    </label>
                    <textarea
                      id="personal-memo"
                      value={active.memo}
                      maxLength={20000}
                      rows={4}
                      placeholder="这一节对我有什么用？记录自己的理解、实践结果，或下次要试的事。"
                      onChange={(event) =>
                        updateDocument(active.id, (value) => ({
                          ...value,
                          memo: event.target.value,
                          updatedAt: Date.now(),
                        }))
                      }
                    />
                    <div className="small muted">
                      独立保存，重新生成也会保留。
                      {active.memo.length > 18000 &&
                        ` ${active.memo.length}/20000`}
                    </div>
                  </section>
                  {nextPart && (
                    <button
                      className="next-lesson"
                      onClick={() =>
                        openVideo(partUrl(active.video, nextPart.page))
                      }
                    >
                      <span className="small muted">
                        下一节 · P{nextPart.page}
                        <strong>{nextPart.title}</strong>
                      </span>
                      <ArrowRight size={20} />
                    </button>
                  )}
                </section>
              </div>
            </>
          )}
        </>
      )}
      <footer className="footer">
        <span>BiliHelper · 看过的内容，也可以留下来。</span>
        <span>笔记保存在本机 · 支持 Markdown 导出</span>
      </footer>
      {job && (
        <div className="generation-dock">
          <Loader2 size={16} className="spin" />
          <span>
            P{workspace.documents[job.id]?.video.selectedPage || 1} ·{" "}
            {job.status}
            {job.total ? ` · ${job.done || 0}/${job.total} 段` : ""}
          </span>
          {!!job.total && (
            <progress
              className="job-progress"
              value={job.done || 0}
              max={job.total}
            />
          )}
          {job.id !== active?.id && (
            <button className="text-button" onClick={() => openSaved(job.id)}>
              查看笔记
            </button>
          )}
          <button
            className="text-button"
            aria-label="停止当前生成"
            onClick={() => jobRef.current?.controller.abort()}
          >
            停止
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button className="text-button" onClick={() => setNotice("")}>
            知道了
          </button>
        </div>
      )}
      {deleted && (
        <div className="toast" role="status">
          已删除这一份笔记
          <button
            className="text-button"
            onClick={() => {
              const item = deleted;
              commit((state) => ({
                ...state,
                documents: { ...state.documents, [item.id]: item },
                activeId: item.id,
              }));
              setDeleted(undefined);
              setHome(false);
            }}
          >
            <Undo2 size={14} />
            撤销
          </button>
          <button className="text-button" onClick={() => setDeleted(undefined)}>
            关闭
          </button>
        </div>
      )}
      <Modal
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        title="我的笔记"
      >
        <p className="muted small">
          笔记、备注和输入草稿保存在这台设备，暂不跨设备同步。
        </p>
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="查找我的笔记"
            placeholder="按视频或节名称查找"
            value={librarySearch}
            onChange={(event) => setLibrarySearch(event.target.value)}
          />
        </label>
        <div className="library-list">
          {allDocuments
            .filter((item) =>
              `${item.video.title} ${partName(item.video)} ${item.memo}`
                .toLowerCase()
                .includes(librarySearch.toLowerCase()),
            )
            .map((item) => (
              <div className="library-item" key={item.id}>
                <button onClick={() => openSaved(item.id)}>
                  <span>
                    P{item.video.selectedPage || 1} · {noteState(item)}
                  </span>
                  <strong>{partName(item.video)}</strong>
                  <small>
                    {item.video.uploader} ·{" "}
                    {new Date(item.updatedAt).toLocaleDateString("zh-CN")}
                  </small>
                </button>
                <button
                  className="icon-button"
                  aria-label={`导出 ${partName(item.video)}`}
                  onClick={() =>
                    exportNote(item, item.draft?.text ? item.draft : item.note)
                  }
                >
                  <ArrowDownToLine size={17} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`删除 ${partName(item.video)}`}
                  onClick={() => removeDocument(item)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
          {!allDocuments.length && (
            <div className="empty-library">
              <Library size={26} />
              <p>还没有笔记。先打开一节视频。</p>
            </div>
          )}
        </div>
        {allDocuments.length > 0 && (
          <div className="library-footer">
            {(active || document)?.video.pages &&
              ((active || document)!.video.pages?.length || 0) > 1 && (
                <button
                  className="text-button"
                  onClick={() => exportCourse(active || document)}
                >
                  <ArrowDownToLine size={15} />
                  导出这门课程已整理的章节
                </button>
              )}
            <button
              className="text-button danger"
              onClick={() => setClearOpen(true)}
            >
              清除全部本机数据
            </button>
          </div>
        )}
      </Modal>
      <Modal
        open={directoryOpen}
        onClose={() => setDirectoryOpen(false)}
        title="课程目录"
      >
        {navigation}
      </Modal>
      <Modal
        open={sourceOpen}
        onClose={() => setSourceOpen(false)}
        title="内容来源与视频信息"
      >
        {active && (
          <>
            <div className="source-video">
              <h3>{active.video.title}</h3>
              <p className="muted">
                P{active.video.selectedPage || 1} · {partName(active.video)}
              </p>
              <a
                className="text-button"
                href={active.video.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                打开原视频 <ExternalLink size={14} />
              </a>
              <p className="small muted">
                {active.video.uploader} ·{" "}
                {active.video.duration
                  ? duration(active.video.duration)
                  : "时长未提供"}
              </p>
              <details>
                <summary>视频简介</summary>
                <p className="description">
                  {active.video.description || "暂无简介"}
                </p>
              </details>
            </div>
            {focusCue && (
              <div className="focused-cue">
                <span className="eyebrow">这条内容的出处</span>
                <p>{focusCue.text}</p>
                {focusCue.start !== undefined ? (
                  <a
                    className="text-button"
                    href={cueUrl(active.video, focusCue)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    回看 {duration(focusCue.start)} 的片段{" "}
                    <ExternalLink size={14} />
                  </a>
                ) : (
                  <p className="small muted">这段原文没有可靠时间信息。</p>
                )}
              </div>
            )}
            <section className="tool-section">
              <h3>用于下一次整理的材料</h3>
              <p className="small muted">
                修改这里不会覆盖已有笔记。个人备注也会保留。
              </p>
              <label htmlFor="subtitle-source">字幕来源</label>
              <select
                id="subtitle-source"
                value={active.subtitleIndex}
                disabled={active.generationState === "running"}
                onChange={(event) =>
                  updateDocument(active.id, (value) => ({
                    ...value,
                    subtitleIndex: event.target.value,
                    transcriptOffset: 0,
                    draft: value.draft
                      ? {
                          ...value.draft,
                          evidence: value.draft.evidence || value.fullJob?.source,
                        }
                      : undefined,
                    fullJob: undefined,
                  }))
                }
              >
                <option value="auto">自动读取当前节内容</option>
                {active.video.subtitles.map((subtitle, index) => (
                  <option key={subtitle.lan + index} value={index}>
                    {subtitle.lan_doc} · 平台字幕
                  </option>
                ))}
              </select>
              {active.video.subtitleNotice && (
                <p className="small muted">{active.video.subtitleNotice}</p>
              )}
              {needsSource && (
                <p className="notice">
                  当前视频没有可读取的平台字幕。请粘贴这一节的实际内容，再开始整理。
                </p>
              )}
              <label htmlFor="source-transcript">
                粘贴字幕或转录文本（也支持 SRT / VTT）
              </label>
              <textarea
                id="source-transcript"
                maxLength={240000}
                rows={7}
                disabled={active.generationState === "running"}
                placeholder="粘贴实际内容。带时间码的字幕可用于片段回看；普通文本用于核对原文。"
                value={active.transcript}
                onChange={(event) =>
                  updateDocument(active.id, (value) => ({
                    ...value,
                    transcript: event.target.value,
                    transcriptOffset: 0,
                    draft: value.draft
                      ? {
                          ...value.draft,
                          evidence: value.draft.evidence || value.fullJob?.source,
                        }
                      : undefined,
                    fullJob: undefined,
                    updatedAt: Date.now(),
                  }))
                }
              />
              <p className="small muted">
                {active.transcript.length}/240000 字符。填写后优先使用这份文本。
              </p>
              {noteMode === "study" && totalCharacters > 20000 && (
                <div className="range-picker">
                  <label htmlFor="source-range">本次整理范围</label>
                  <select
                    id="source-range"
                    value={active.transcriptOffset}
                    disabled={active.generationState === "running"}
                    onChange={(event) =>
                      updateDocument(active.id, (value) => ({
                        ...value,
                        transcriptOffset: Number(event.target.value),
                      }))
                    }
                  >
                    {Array.from(
                      { length: Math.ceil(totalCharacters / 20000) },
                      (_, index) => (
                        <option value={index * 20000} key={index}>
                          第 {index + 1} 段 · 文本 {index * 20000 + 1}–
                          {Math.min((index + 1) * 20000, totalCharacters)} 字符
                        </option>
                      ),
                    )}
                  </select>
                  <p className="small muted">
                    每次明确整理一个片段，原始材料完整保留。字幕格式清洗后的实际范围会显示在笔记来源中。
                  </p>
                </div>
              )}
              <div className="inline-actions">
                <button
                  className="primary"
                  disabled={!!job || (needsSource && !canResumeFull)}
                  onClick={() => {
                    if (active.transcript.trim() && manualCharacters < 30) {
                      setNotice("请粘贴至少 30 个字符的实际视频内容。");
                      return;
                    }
                    setSourceOpen(false);
                    if (longForm) generateFull(canResumeFull);
                    else generate();
                  }}
                >
                  <Sparkles size={16} />
                  {longForm
                    ? canResumeFull
                      ? `继续整理${outputName}`
                      : `生成${outputName}`
                    : totalCharacters > 20000
                      ? "整理所选片段"
                      : "生成学习笔记"}
                </button>
                <button
                  className="text-button"
                  disabled={opening}
                  onClick={() => openVideo(active.video.url, true)}
                >
                  刷新可用来源
                </button>
              </div>
              <details className="subtitle-help">
                <summary>没有字幕，怎么办？</summary>
                <p>
                  可从原平台提供的字幕或转录面板复制当前这一节的文本；如果没有，可使用已有的实际转录材料。不要粘贴简介来代替字幕。
                </p>
                <p>
                  在电脑上也可尝试「保存视频」中的字幕下载指令。平台没有公开字幕时，该方法可能仍不可用。
                </p>
              </details>
            </section>
            {(shownNote || sourceEvidence) && (
              <section className="tool-section">
                <h3>当前内容的依据</h3>
                <p>
                  {shownNote?.source || sourceEvidence?.label ||
                    active.fullJob?.source.label ||
                    "未取得来源"}{" "}
                  · {active.fullJob ? `原文已读取，正文完成 ${fullSections.length}/${active.fullJob.totalSections} 段` : coverage(sourceEvidence)}
                </p>
                {sourceEvidence?.limitation && (
                  <p className="notice">
                    {sourceEvidence.limitation}
                  </p>
                )}
                <p className="small muted">
                  文本依据不包含对全部视频画面的核验。
                </p>
                {sourceCues.length ? (
                  <>
                    <div className="source-summary">
                      <span>
                        {longForm || shownNote?.mode === "full" || shownArticle
                          ? "完整字幕原文"
                          : "本次整理的原文"}
                      </span>
                      <strong>{sourceCues.length} 条</strong>
                      <span>
                        {sourceCues
                          .reduce((sum, cue) => sum + cue.text.length, 0)
                          .toLocaleString("zh-CN")}{" "}
                        字
                      </span>
                    </div>
                    <div className="inline-actions source-actions">
                      <button
                        className="text-button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              cuesToPlainText(sourceCues),
                            );
                            setNotice("原文已复制到剪贴板。");
                          } catch {
                            setNotice("复制失败，请展开原文手动选择。");
                          }
                        }}
                      >
                        <Copy size={14} />
                        复制完整原文
                      </button>
                      <button
                        className="text-button"
                        onClick={() => {
                          saveTextFile(
                            sourceSrt || cuesToPlainText(sourceCues),
                            `${fileBaseName(partName(active.video))}.${sourceSrt ? "srt" : "txt"}`,
                            "text/plain;charset=utf-8",
                          );
                        }}
                      >
                        <ArrowDownToLine size={14} />
                        {sourceSrt ? "下载 SRT 字幕" : "下载原文"}
                      </button>
                    </div>
                    <label className="search-field">
                      <Search size={15} />
                      <input
                        aria-label="查找来源原文"
                        placeholder="在本次使用的原文中查找"
                        value={sourceSearch}
                        onChange={(event) =>
                          setSourceSearch(event.target.value)
                        }
                      />
                    </label>
                    <div className="source-cues">
                      {visibleCues.map((cue) => (
                        <div
                          key={cue.id}
                          className={
                            selectedCue === cue.id ? "selected-cue" : ""
                          }
                        >
                          <span>
                            {cue.start !== undefined
                              ? duration(cue.start)
                              : `原文 ${cue.id}`}
                          </span>
                          <p>{cue.text}</p>
                          {cue.start !== undefined && (
                            <a
                              href={cueUrl(active.video, cue)}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`回看 ${duration(cue.start)} 的片段`}
                            >
                              <ExternalLink size={14} />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                    {visibleCues.length < matchingCues.length && (
                      <p className="small muted">
                        共匹配 {matchingCues.length} 条，界面只显示前{" "}
                        {visibleCues.length} 条；可搜索、复制或下载完整原文。
                      </p>
                    )}
                  </>
                ) : (
                  <p className="muted">
                    提取服务没有返回可核对的逐段原文，覆盖范围暂无法确认。
                  </p>
                )}
              </section>
            )}
          </>
        )}
      </Modal>
      <Modal
        open={downloadOpen}
        onClose={() => setDownloadOpen(false)}
        title="保存视频"
      >
        {downloadOpen && active && (
          <DownloadPanel key={active.id} video={active.video} />
        )}
      </Modal>
      <Modal
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="清除全部本机数据"
      >
        <p>
          这会删除这台设备保存的所有笔记、输入草稿和个人备注。请先导出重要内容。
        </p>
        <div className="inline-actions">
          <button className="secondary" onClick={() => setClearOpen(false)}>
            保留数据
          </button>
          <button
            className="primary destructive"
            disabled={!!job}
            onClick={() => {
              commit(() => ({ version: 1, documents: {}, activeId: null }));
              try {
                localStorage.removeItem("bili-history");
              } catch {}
              setLegacy([]);
              setDeleted(undefined);
              setClearOpen(false);
              setLibraryOpen(false);
              setHome(true);
            }}
          >
            确认清除全部数据
          </button>
        </div>
        {job && <p>请先停止生成，再清除数据。</p>}
      </Modal>
    </main>
  );
}
