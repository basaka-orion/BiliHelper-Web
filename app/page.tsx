"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
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
import {
  createDocument,
  documentId,
  migrateHistory,
  type LearningDocument,
  type LearningNote,
  type VideoInfo,
} from "../lib/workspace";
import { useWorkspace } from "../lib/use-workspace";
import {
  parseTranscript,
  type SourceCue,
  type SourceEvidence,
} from "../lib/learning-source";
import { Modal } from "./components/modal";
import { DownloadPanel } from "./components/download-panel";

const EXAMPLE = "https://www.bilibili.com/video/BV1wD4y1o7AS";
function duration(seconds = 0) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
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
        ? "有笔记"
        : "未整理";
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
    url.searchParams.set("t", String(Math.floor(cue.start)));
  return url.href;
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
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState("");
  const [deleted, setDeleted] = useState<LearningDocument>();
  const [job, setJob] = useState<{ id: string; status: string } | null>(null);
  const jobRef = useRef<{ id: string; controller: AbortController } | null>(
    null,
  );
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
  const generationError = active?.draft?.error;
  const needsSource =
    !!active &&
    !active.transcript.trim() &&
    !active.video.subtitles.length &&
    (active.video.selectedPage || 1) > 1;
  const manualCharacters = useMemo(
    () =>
      parseTranscript(active?.transcript || "")
        .map((cue) => cue.text)
        .join("\n").length,
    [active?.transcript],
  );
  const currentEvidence = active?.draft?.evidence || active?.note?.evidence;
  const totalCharacters = active?.transcript.trim()
    ? manualCharacters
    : currentEvidence?.kind !== "manual"
      ? currentEvidence?.totalCharacters || 0
      : 0;
  const sourceCues = shownNote?.evidence?.cues || [];
  const matchingCues = sourceCues.filter(
    (cue) => !sourceSearch || cue.text.includes(sourceSearch),
  );
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
      if (link.platform === "bilibili" && !link.short) {
        try {
          video = await browserVideoInfo(link.url, controller.signal);
        } catch {
          if (controller.signal.aborted) return;
        }
      }
      if (!video) {
        const response = await fetch("/api/video-info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ url: value }),
        });
        const data = await response.json().catch(() => {
          throw new Error("视频服务暂不可用，请重试。");
        });
        if (!response.ok) {
          if (data.browserFallback)
            video = await browserVideoInfo(
              data.resolvedUrl || value,
              controller.signal,
            );
          else throw new Error(data.error || "视频无法打开");
        } else video = data;
      }
      if (controller.signal.aborted || !video) return;
      let metadata = video;
      const nextId = documentId(metadata.url);
      let refreshedIndex: string | undefined;
      if (refresh && metadata.platform === "bilibili") {
        const refreshed = await refreshVideoSource(
          metadata,
          current.current.documents[nextId]?.subtitleIndex || "auto",
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

  async function generate() {
    if (!active || jobRef.current || needsSource) return;
    if (active.transcript.trim() && active.transcript.trim().length < 30) {
      setSourceOpen(true);
      setNotice("请粘贴至少 30 个字符的实际视频内容。");
      return;
    }
    const snapshot = active,
      id = active.id,
      controller = new AbortController();
    jobRef.current = { id, controller };
    setJob({ id, status: "正在读取本节内容…" });
    setShowPrevious(false);
    let output = "",
      source = "",
      evidence: SourceEvidence | undefined,
      warning = "",
      completed = false;
    const generatedAt = Date.now();
    updateDocument(id, (value) => ({
      ...value,
      generationState: "running",
      updatedAt: generatedAt,
      note: value.note || (value.draft?.text ? value.draft : undefined),
      draft: { text: "", source: "", status: "partial", generatedAt },
    }));
    contentRef.current?.focus({ preventScroll: true });
    const timeout = setTimeout(() => controller.abort(), 210000);
    const storeDraft = (error?: string) =>
      updateDocument(id, (value) => ({
        ...value,
        draft: {
          text: output,
          source,
          evidence,
          status: "partial",
          error,
          generatedAt,
        },
      }));
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
        if (event.evidence) evidence = event.evidence;
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
      };
      updateDocument(id, (value) => ({
        ...value,
        note: result,
        previousNote: value.note || value.previousNote,
        draft: undefined,
        generationState: "idle",
        updatedAt: Date.now(),
      }));
    } catch (error) {
      const message = controller.signal.aborted
        ? "生成已停止或超时，已收到的内容保留。"
        : error instanceof Error
          ? error.message
          : "生成失败，请重试。";
      storeDraft(message);
      updateDocument(id, (value) => ({
        ...value,
        generationState: "interrupted",
      }));
    } finally {
      clearTimeout(timeout);
      if (jobRef.current?.controller === controller) {
        jobRef.current = null;
        setJob(null);
      }
      flush();
    }
  }

  function exportNote(item = active, note = shownNote) {
    if (!item) return;
    const title = partName(item.video);
    const cues = note?.evidence?.cues || [];
    const markdown = tutorialMarkdown(note?.text || "").replace(
      /\[([^\]]+)\]\(source:(\d+)\)/g,
      (match, label, id) =>
        cues.some((cue) => cue.id === id) ? `[${label}][^source-${id}]` : label,
    );
    const references = cues.length
      ? "\n\n## 来源原文\n\n" +
        cues
          .map(
            (cue) =>
              `[^source-${cue.id}]: ${cue.text.replace(/\n/g, "\n    ")}${cue.start !== undefined ? ` [回看 ${duration(cue.start)}](${cueUrl(item.video, cue)})` : ""}`,
          )
          .join("\n\n")
      : "";
    const text = `# ${title}\n\n来源：${item.video.url}\n\n依据：${note?.source || "未生成"}\n覆盖：${coverage(note?.evidence)}\n${note?.evidence?.limitation ? `说明：${note.evidence.limitation}\n` : ""}${note?.status === "partial" || note?.error ? `\n注意：内容未完成。${note.error || ""}\n` : ""}\n${markdown}${references}\n\n## 我的备注\n\n${item.memo || "暂无备注"}\n${item.transcript ? `\n## 待整理的输入文本\n\n${item.transcript}\n` : ""}`;
    const href = URL.createObjectURL(
        new Blob([text], { type: "text/markdown;charset=utf-8" }),
      ),
      link = window.document.createElement("a");
    link.href = href;
    link.download = `${title.replace(/[\\/:*?"<>|]/g, "_")}-学习笔记.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 10000);
  }
  async function copyNote() {
    try {
      await navigator.clipboard.writeText(
        tutorialMarkdown(shownNote?.text || ""),
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
                  把教程整理成有依据的学习笔记。
                  <br />
                  找到重点，留下理解，下次回来继续。
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
              <div className="note-preview" aria-label="笔记结构预览">
                <div className="preview-top">
                  <span className="preview-dots">● ● ●</span>
                  <span>笔记结构预览</span>
                </div>
                <div className="preview-page">
                  <div className="preview-label">
                    <FileText size={14} />
                    每一节，都有自己的笔记
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
                      <h3>本节要解决什么</h3>
                      <p>先看清这节内容的目的。</p>
                    </div>
                  </div>
                  <div className="preview-section">
                    <span>02</span>
                    <div>
                      <h3>关键知识与跟做步骤</h3>
                      <p>有原文支持，才能放心回看。</p>
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
                      {shownNote?.source ||
                        (active.transcript.trim()
                          ? "你提供的字幕文本"
                          : active.video.hasSubtitles
                            ? "当前节有平台字幕"
                            : needsSource
                              ? "当前节需要补充内容"
                              : "可尝试自动提取内容")}
                      <small>
                        {shownNote
                          ? coverage(shownNote.evidence)
                          : needsSource
                            ? "取得实际内容后再整理"
                            : "只根据读取到的内容生成"}
                      </small>
                    </span>
                    <ChevronDown size={16} />
                  </button>
                  {shownNote?.evidence?.limitation && (
                    <p className="coverage-notice">
                      {shownNote.evidence.limitation}
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
                          <button
                            className="secondary"
                            onClick={() => jobRef.current?.controller.abort()}
                          >
                            <Square size={13} />
                            停止生成
                          </button>
                        </div>
                      ) : (
                        <button
                          className={shownNote?.text ? "secondary" : "primary"}
                          disabled={!!job || opening}
                          onClick={() =>
                            needsSource ? setSourceOpen(true) : generate()
                          }
                        >
                          {needsSource ? (
                            <Plus size={16} />
                          ) : (
                            <Sparkles size={16} />
                          )}
                          {needsSource
                            ? "补充字幕"
                            : shownNote?.text
                              ? "重新生成"
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
                  {job && job.id !== active.id && (
                    <p className="small muted">
                      另一节正在生成，完成或停止后可整理这一节。
                    </p>
                  )}
                  {shownNote?.error && !generationError && (
                    <div className="notice" role="alert">
                      <strong>这份内容未完成</strong>
                      <p>{shownNote.error}</p>
                    </div>
                  )}
                  {(generationError ||
                    active.generationState === "interrupted") && (
                    <div className="notice" role="alert">
                      <strong>这次生成未完成</strong>
                      <p>
                        {generationError ||
                          "上次生成被中断，已保存的内容仍在。"}
                      </p>
                      <button
                        className="text-button"
                        disabled={!!job}
                        onClick={() =>
                          needsSource ? setSourceOpen(true) : generate()
                        }
                      >
                        {needsSource ? "补充字幕" : "重试"}
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
                    <article className="note-content">
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
                        {tutorialMarkdown(shownNote.text)}
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
                          : "把这一节留下来"}
                      </h2>
                      <p>
                        {needsSource
                          ? "目前无法读取这一节的字幕。粘贴实际字幕或转录文本，就能继续整理。"
                          : "整理本节目的、关键知识和原文中的步骤。你的笔记与备注会自动保存在这台设备。"}
                      </p>
                      <div>
                        <span>有依据的要点</span>
                        <span>可恢复的笔记</span>
                        <span>自己的理解</span>
                      </div>
                    </div>
                  )}
                  {shownNote?.text && (
                    <div className="note-tools">
                      <span className="small muted">
                        {shownNote.status === "partial"
                          ? "未完成内容"
                          : "生成完成"}{" "}
                        ·{" "}
                        {new Date(shownNote.generatedAt).toLocaleDateString(
                          "zh-CN",
                        )}
                      </span>
                      <button className="text-button" onClick={copyNote}>
                        {copied ? <Check size={15} /> : <Copy size={15} />}
                        {copied ? "已复制" : "复制笔记"}
                      </button>
                      <button
                        className="text-button"
                        onClick={() => exportNote()}
                      >
                        <ArrowDownToLine size={15} />
                        导出 Markdown
                      </button>
                    </div>
                  )}
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
          </span>
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
          <button
            className="text-button danger"
            onClick={() => setClearOpen(true)}
          >
            清除全部本机数据
          </button>
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
                  当前分 P
                  无可读取字幕，自动提取暂不支持这一节。请粘贴这一节的实际内容。
                </p>
              )}
              <label htmlFor="source-transcript">
                粘贴字幕或转录文本（也支持 SRT / VTT）
              </label>
              <textarea
                id="source-transcript"
                maxLength={60000}
                rows={7}
                disabled={active.generationState === "running"}
                placeholder="粘贴实际内容。带时间码的字幕可用于片段回看；普通文本用于核对原文。"
                value={active.transcript}
                onChange={(event) =>
                  updateDocument(active.id, (value) => ({
                    ...value,
                    transcript: event.target.value,
                    transcriptOffset: 0,
                    updatedAt: Date.now(),
                  }))
                }
              />
              <p className="small muted">
                {active.transcript.length}/60000 字符。填写后优先使用这份文本。
              </p>
              {totalCharacters > 20000 && (
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
                  disabled={!!job || needsSource}
                  onClick={() => {
                    if (active.transcript.trim() && manualCharacters < 30) {
                      setNotice("请粘贴至少 30 个字符的实际视频内容。");
                      return;
                    }
                    setSourceOpen(false);
                    generate();
                  }}
                >
                  <Sparkles size={16} />
                  {totalCharacters > 20000 ? "整理所选片段" : "生成学习笔记"}
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
            {shownNote && (
              <section className="tool-section">
                <h3>当前笔记的依据</h3>
                <p>
                  {shownNote.source || "未取得来源"} ·{" "}
                  {coverage(shownNote.evidence)}
                </p>
                {shownNote.evidence?.limitation && (
                  <p className="notice">{shownNote.evidence.limitation}</p>
                )}
                <p className="small muted">
                  文本依据不包含对全部视频画面的核验。
                </p>
                {sourceCues.length ? (
                  <>
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
                      {matchingCues.map((cue) => (
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
