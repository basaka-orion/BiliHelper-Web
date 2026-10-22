import { parseVideoLink } from "./video-url";
import type { SourceEvidence } from "./learning-source";
import {
  MAX_SOURCE_CUES,
  MAX_TRANSCRIPT_CHARACTERS,
  chunkSourceCues,
} from "./learning-source";
import type { FullDocumentSection } from "./full-document";
import type { MindMapNode, MindMapSection } from "./mindmap";
import { buildMindMapUnits } from "./mindmap";

export interface VideoInfo {
  platform: string;
  title: string;
  uploader: string;
  avatar?: string;
  duration?: number;
  views?: number;
  likes?: number;
  coins?: number;
  favorites?: number;
  danmakus?: number;
  description?: string;
  thumbnail?: string;
  bvid?: string;
  cid?: number;
  aid?: number;
  url: string;
  subtitles: { lan: string; lan_doc: string; subtitle_url: string }[];
  hasSubtitles: boolean;
  subtitleNotice?: string;
  pages?: { cid: number; page: number; title: string; duration: number }[];
  selectedPage?: number;
}

export interface LearningNote {
  text: string;
  source: string;
  evidence?: SourceEvidence;
  status: "complete" | "partial";
  error?: string;
  generatedAt: number;
  mode?: "study" | "full" | "article";
  sectionCount?: number;
}

export interface FullDocumentJob {
  mode?: "full" | "article";
  status: "running" | "paused" | "error";
  source: SourceEvidence;
  totalCharacters: number;
  totalSections: number;
  sections: FullDocumentSection[];
  error?: string;
  startedAt: number;
  updatedAt: number;
}

export interface MindMapDocument {
  version: 1;
  title: string;
  source: SourceEvidence;
  sections: (MindMapSection & { index: number; cueIds: string[] })[];
  totalSections: number;
  status: "running" | "complete" | "paused" | "error";
  error?: string;
  generatedAt: number;
  updatedAt: number;
}

export interface LearningDocument {
  id: string;
  video: VideoInfo;
  transcript: string;
  transcriptOffset: number;
  subtitleIndex: string;
  memo: string;
  note?: LearningNote;
  previousNote?: LearningNote;
  draft?: LearningNote;
  noteMode: "study" | "full" | "article";
  fullJob?: FullDocumentJob;
  mindmap?: MindMapDocument;
  generationState: "idle" | "running" | "interrupted";
  scrollY: number;
  updatedAt: number;
}

export interface Workspace {
  version: 1;
  documents: Record<string, LearningDocument>;
  activeId: string | null;
}

export const STORAGE_KEY = "bili-learning-workspace-v1";
// Leave browser storage headroom for preferences and the legacy URL history.
const MAX_STORAGE_CHARACTERS = 2 * 1024 * 1024;
const MAX_EMPTY_DOCUMENTS = 24;
const MAX_READ_DOCUMENTS = 10000;
const MAX_READ_CHARACTERS = 8 * 1024 * 1024;
const MAX_MINDMAP_NODES = 18000;
const MAX_MINDMAP_CHARACTERS = 720000;
const hasOwn = (object: object, key: string) =>
  Object.prototype.hasOwnProperty.call(object, key);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const validNumber = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= Number.MAX_SAFE_INTEGER;
const text = (value: unknown, maximum = MAX_STORAGE_CHARACTERS) =>
  typeof value === "string" && value.length <= maximum ? value : undefined;

export function emptyWorkspace(): Workspace {
  return { version: 1, documents: Object.create(null), activeId: null };
}

export function documentId(url: string): string {
  return parseVideoLink(url).url;
}

function readVideo(value: unknown): VideoInfo | undefined {
  if (
    !isRecord(value) ||
    typeof value.url !== "string" ||
    !text(value.title, 1000)?.trim()
  )
    return;
  let link;
  try {
    link = parseVideoLink(value.url);
  } catch {
    return;
  }
  if (value.platform !== link.platform) return;
  const video: VideoInfo = {
    platform: link.platform,
    url: link.url,
    title: value.title as string,
    uploader: text(value.uploader, 1000) || "",
    subtitles: [],
    hasSubtitles: false,
  };
  for (const key of [
    "avatar",
    "thumbnail",
    "description",
    "subtitleNotice",
  ] as const) {
    const field = text(value[key], key === "description" ? 100000 : 4096);
    if (field !== undefined) video[key] = field;
  }
  for (const key of [
    "duration",
    "views",
    "likes",
    "coins",
    "favorites",
    "danmakus",
    "cid",
    "aid",
  ] as const) {
    if (validNumber(value[key])) video[key] = value[key] as number;
  }
  if (link.bvid) video.bvid = link.bvid;
  else if (
    typeof value.bvid === "string" &&
    /^BV[0-9A-Za-z]{10}$/.test(value.bvid)
  )
    video.bvid = value.bvid;
  if (Array.isArray(value.subtitles)) {
    video.subtitles = value.subtitles
      .slice(0, 100)
      .filter(isRecord)
      .flatMap((subtitle) => {
        const lan = text(subtitle.lan, 100),
          lanDoc = text(subtitle.lan_doc, 200),
          url = text(subtitle.subtitle_url, 4096);
        return lan && lanDoc && url
          ? [{ lan, lan_doc: lanDoc, subtitle_url: url }]
          : [];
      });
  }
  video.hasSubtitles = video.subtitles.length > 0;
  if (Array.isArray(value.pages)) {
    video.pages = value.pages
      .slice(0, 10000)
      .filter(isRecord)
      .flatMap((page) =>
        validNumber(page.cid) &&
        page.cid > 0 &&
        validNumber(page.page) &&
        Number.isInteger(page.page) &&
        page.page > 0 &&
        validNumber(page.duration) &&
        text(page.title, 1000) !== undefined
          ? [
              {
                cid: page.cid,
                page: page.page,
                title: page.title as string,
                duration: page.duration,
              },
            ]
          : [],
      );
  }
  if (link.platform === "bilibili") video.selectedPage = link.page;
  return video;
}

function readEvidence(value: unknown): SourceEvidence | undefined {
  if (
    !isRecord(value) ||
    !["manual", "subtitle", "automatic"].includes(value.kind as string) ||
    !["full", "partial", "unknown"].includes(value.coverage as string) ||
    typeof value.label !== "string" ||
    value.label.length > 1000 ||
    !Array.isArray(value.cues) ||
    value.cues.length > MAX_SOURCE_CUES
  )
    return;
  const cues: SourceEvidence["cues"] = [];
  const ids = new Set<string>();
  let characters = 0;
  for (const valueCue of value.cues) {
    if (
      !isRecord(valueCue) ||
      typeof valueCue.id !== "string" ||
      !/^[1-9]\d{0,5}$/.test(valueCue.id) ||
      ids.has(valueCue.id) ||
      typeof valueCue.text !== "string"
    )
      return;
    characters += valueCue.text.length;
    if (characters > MAX_TRANSCRIPT_CHARACTERS) return;
    const cue: SourceEvidence["cues"][number] = {
      id: valueCue.id,
      text: valueCue.text,
    };
    if (validNumber(valueCue.start)) cue.start = valueCue.start;
    if (
      validNumber(valueCue.end) &&
      (cue.start === undefined || valueCue.end >= cue.start)
    )
      cue.end = valueCue.end;
    cues.push(cue);
    ids.add(cue.id);
  }
  const evidence: SourceEvidence = {
    kind: value.kind as SourceEvidence["kind"],
    label: value.label,
    coverage: value.coverage as SourceEvidence["coverage"],
    cues,
  };
  for (const key of ["totalCharacters", "analyzedCharacters"] as const) {
    if (validNumber(value[key])) evidence[key] = value[key] as number;
  }
  const limitation = text(value.limitation, 4000);
  if (limitation !== undefined) evidence.limitation = limitation;
  return evidence;
}

function readNote(value: unknown): LearningNote | undefined {
  if (
    !isRecord(value) ||
    text(value.text) === undefined ||
    text(value.source, 1000) === undefined ||
    !["complete", "partial"].includes(value.status as string) ||
    !validNumber(value.generatedAt)
  )
    return;
  const note: LearningNote = {
    text: value.text as string,
    source: value.source as string,
    status: value.status as LearningNote["status"],
    generatedAt: value.generatedAt,
  };
  const evidence = readEvidence(value.evidence),
    error = text(value.error, 10000);
  if (evidence) note.evidence = evidence;
  if (error !== undefined) note.error = error;
  if (value.mode === "full" || value.mode === "study" || value.mode === "article")
    note.mode = value.mode;
  if (
    validNumber(value.sectionCount) &&
    Number.isInteger(value.sectionCount) &&
    value.sectionCount >= 1 &&
    value.sectionCount <= 200
  )
    note.sectionCount = value.sectionCount;
  return note;
}

function readFullJob(value: unknown, recover: boolean): FullDocumentJob | undefined {
  if (!isRecord(value)) return;
  const mode = value.mode === "article" ? "article" : "full";
  const source = readEvidence(value.source);
  if (!source || source.coverage !== "full") return;
  if (
    !validNumber(value.totalCharacters) ||
    value.totalCharacters <= 0 ||
    value.totalCharacters > MAX_TRANSCRIPT_CHARACTERS ||
    !validNumber(value.totalSections) ||
    !Number.isInteger(value.totalSections) ||
    value.totalSections < 1 ||
    value.totalSections > 200 ||
    !Array.isArray(value.sections) ||
    value.sections.length > value.totalSections ||
    !["running", "paused", "error"].includes(value.status as string)
  )
    return;
  const sections: FullDocumentSection[] = [];
  const indexes = new Set<number>();
  for (const row of value.sections) {
    if (!isRecord(row)) return;
    if (
      !validNumber(row.index) ||
      !Number.isInteger(row.index) ||
      row.index < 0 ||
      row.index >= (value.totalSections as number) ||
      indexes.has(row.index) ||
      text(row.markdown, 400000) === undefined ||
      !Array.isArray(row.cueIds) ||
      row.cueIds.length > MAX_SOURCE_CUES
    )
      return;
    const cueIds: string[] = [];
    for (const id of row.cueIds) {
      if (typeof id !== "string" || !/^[1-9]\d{0,5}$/.test(id)) return;
      cueIds.push(id);
    }
    const section: FullDocumentSection = {
      index: row.index,
      markdown: row.markdown as string,
      cueIds,
    };
    if (row.omitted === true) {
      if (mode !== "article" || section.markdown.trim()) return;
      section.omitted = true;
    }
    const warning = text(row.warning, 2000);
    if (warning !== undefined) section.warning = warning;
    sections.push(section);
    indexes.add(row.index);
  }
  sections.sort((a, b) => a.index - b.index);
  let chunks: SourceEvidence["cues"][];
  try {
    chunks = chunkSourceCues(source.cues);
  } catch {
    // Oversized legacy cues require fresh acquisition instead of reassigning ids:
    // old draft citations must never silently point at newly renumbered source text.
    return;
  }
  const firstIncomplete = sections.findIndex((section, index) => {
    const ids = chunks[index]?.map((cue) => cue.id);
    return (
      section.index !== index ||
      (!section.markdown.trim() && !section.omitted) ||
      !!section.warning ||
      !ids ||
      section.cueIds.length !== ids.length ||
      section.cueIds.some((id, cueIndex) => id !== ids[cueIndex])
    );
  });
  const boundaryChanged = value.totalSections !== chunks.length;
  // A saved index is not proof of coverage. Segmentation may change between
  // releases, so only a continuous prefix with the same source ids can resume.
  if (!recover && (firstIncomplete >= 0 || boundaryChanged)) return;
  const incompleteWarning = firstIncomplete >= 0
    ? sections[firstIncomplete].warning : undefined;
  if (firstIncomplete >= 0) sections.splice(firstIncomplete);
  const recoveryReason = incompleteWarning
    ? `先前输出未完成，将从第 ${sections.length + 1} 段重新整理。${incompleteWarning}`
    : firstIncomplete >= 0 || boundaryChanged
      ? `原文分段范围已更新，已保留 ${sections.length} 段匹配结果，将从第 ${sections.length + 1} 段继续整理（共 ${chunks.length} 段）。`
      : undefined;
  const startedAt = validNumber(value.startedAt) ? value.startedAt : Date.now();
  const updatedAt = validNumber(value.updatedAt) ? value.updatedAt : startedAt;
  const job: FullDocumentJob = {
    mode,
    status:
      recoveryReason ? "error" : recover && value.status === "running"
        ? "paused"
        : (value.status as FullDocumentJob["status"]),
    source,
    totalCharacters: value.totalCharacters as number,
    totalSections: chunks.length,
    sections,
    startedAt,
    updatedAt,
  };
  const error = text(value.error, 10000);
  if (recoveryReason) job.error = recoveryReason;
  else if (error !== undefined) job.error = error;
  return job;
}

/** Validate one API result before either rendering it or adding it to saved progress. */
export function readMindMapSection(value: unknown, allowedCueIds: string[]): MindMapSection | undefined {
  if (!isRecord(value) || value.version !== 1 || typeof value.fallback !== "boolean" ||
    !Array.isArray(value.nodes) || value.nodes.length > MAX_MINDMAP_NODES) return;
  const allowed = new Set(allowedCueIds), nodeIds = new Set<string>();
  let nodeCount = 0, characters = 0;
  const readIds = (input: unknown): string[] | undefined => {
    if (!Array.isArray(input) || input.length > allowed.size) return;
    const seen = new Set<string>();
    for (const id of input) {
      if (typeof id !== "string" || !allowed.has(id) || seen.has(id)) return;
      seen.add(id);
    }
    return Array.from(seen);
  };
  const sameIds = (first: string[], second: string[]) => {
    const other = new Set(second);
    return first.length === other.size && first.every((id) => other.has(id));
  };
  const readNode = (input: unknown, depth: number): MindMapNode | undefined => {
    if (!isRecord(input) || depth > 4 || ++nodeCount > MAX_MINDMAP_NODES ||
      typeof input.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(input.id) ||
      nodeIds.has(input.id) || !text(input.text, 9000)?.trim() ||
      !Array.isArray(input.children) || input.children.length > MAX_MINDMAP_NODES) return;
    characters += (input.text as string).length;
    if (characters > MAX_MINDMAP_CHARACTERS) return;
    const sourceIds = readIds(input.sourceIds);
    if (!sourceIds?.length) return;
    nodeIds.add(input.id);
    const children: MindMapNode[] = [];
    for (const child of input.children) {
      const node = readNode(child, depth + 1);
      if (!node) return;
      children.push(node);
    }
    if (children.length && !sameIds(sourceIds, children.flatMap((child) => child.sourceIds))) return;
    return { id: input.id, text: input.text as string, sourceIds, children };
  };
  const nodes: MindMapNode[] = [];
  for (const input of value.nodes) {
    const node = readNode(input, 1);
    if (!node) return;
    nodes.push(node);
  }
  const sourceIds = readIds(value.sourceIds);
  if (!sourceIds || !sameIds(sourceIds, nodes.flatMap((node) => node.sourceIds))) return;
  return { version: 1, nodes, sourceIds, fallback: value.fallback };
}

function readMindMap(value: unknown, recover: boolean): MindMapDocument | undefined {
  if (
    !isRecord(value) || value.version !== 1 ||
    !text(value.title, 1000)?.trim() ||
    !validNumber(value.totalSections) || !Number.isInteger(value.totalSections) ||
    value.totalSections < 1 || value.totalSections > 200 ||
    !Array.isArray(value.sections) || value.sections.length > 200 ||
    !["running", "complete", "paused", "error"].includes(value.status as string) ||
    !validNumber(value.generatedAt) || !validNumber(value.updatedAt) ||
    (value.error !== undefined && text(value.error, 10000) === undefined)
  ) return;
  const source = readEvidence(value.source);
  if (!source || source.coverage !== "full" || !source.cues.length || !isRecord(value.source)) return;
  // Evidence normalization may discard unsafe fields for old notes, but a map's
  // citations and source must round-trip without silently changing their meaning.
  for (const key of ["totalCharacters", "analyzedCharacters", "limitation"] as const)
    if (source[key] !== value.source[key]) return;
  if (source.cues.some((cue, index) => {
    const original = (value.source as Record<string, unknown>).cues;
    const row = Array.isArray(original) ? original[index] : undefined;
    return !isRecord(row) || cue.start !== row.start || cue.end !== row.end;
  })) return;
  let chunks: SourceEvidence["cues"][];
  try {
    chunks = chunkSourceCues(source.cues);
  } catch {
    return;
  }
  const sections: MindMapDocument["sections"] = [];
  const nodeIds = new Set<string>();
  let nodeCount = 0, characters = 0, invalidSection = false;
  for (const row of value.sections) {
    const index = sections.length;
    const ids = chunks[index]?.map((cue) => cue.id);
    if (!isRecord(row) || row.version !== 1 || row.index !== index || !ids ||
      !Array.isArray(row.cueIds) || row.cueIds.length !== ids.length ||
      row.cueIds.some((id, cueIndex) => id !== ids[cueIndex]) ||
      typeof row.fallback !== "boolean" || !Array.isArray(row.nodes) ||
      row.nodes.length > MAX_MINDMAP_NODES) {
      invalidSection = true;
      break;
    }
    const section = readMindMapSection(row, ids);
    if (!section || (!section.nodes.length && buildMindMapUnits(chunks[index]).length > 0)) {
      invalidSection = true;
      break;
    }
    const remaining = [...section.nodes];
    while (remaining.length) {
      const node = remaining.pop()!;
      nodeCount++;
      characters += node.text.length;
      if (nodeIds.has(node.id) || nodeCount > MAX_MINDMAP_NODES || characters > MAX_MINDMAP_CHARACTERS) {
        invalidSection = true;
        break;
      }
      nodeIds.add(node.id);
      remaining.push(...node.children);
    }
    if (invalidSection) break;
    sections.push({ ...section, index, cueIds: ids });
  }
  const boundaryChanged = value.totalSections !== chunks.length;
  const incomplete = value.status === "complete" && sections.length !== chunks.length;
  if (!recover && (invalidSection || boundaryChanged || incomplete)) return;
  const recoveryReason = invalidSection || boundaryChanged
    ? `原文分段范围或导图内容已更新，已保留 ${sections.length} 段匹配结果，将从第 ${sections.length + 1} 段重试（共 ${chunks.length} 段）。`
    : incomplete ? `先前思维导图尚未完成，已保留 ${sections.length} 段，将从第 ${sections.length + 1} 段继续整理（共 ${chunks.length} 段）。` : undefined;
  return {
    version: 1,
    title: value.title as string,
    source,
    sections,
    totalSections: chunks.length,
    status: recoveryReason ? "error" : recover && value.status === "running" ? "paused" : value.status as MindMapDocument["status"],
    ...(recoveryReason ? { error: recoveryReason } : value.error !== undefined ? { error: value.error as string } : {}),
    generatedAt: value.generatedAt,
    updatedAt: value.updatedAt,
  };
}

export function createDocument(video: VideoInfo): LearningDocument {
  const normalized = readVideo(video);
  if (!normalized)
    throw new Error("视频资料无效，无法创建笔记。请重新打开视频。");
  return {
    id: documentId(normalized.url),
    video: normalized,
    transcript: "",
    transcriptOffset: 0,
    subtitleIndex: "auto",
    memo: "",
    noteMode: "article",
    generationState: "idle",
    scrollY: 0,
    updatedAt: Date.now(),
  };
}

function readDocument(
  value: unknown,
  recover: boolean,
): LearningDocument | undefined {
  if (!isRecord(value)) return;
  const video = readVideo(value.video);
  if (!video) return;
  const document = createDocument(video);
  document.transcript = text(value.transcript) || "";
  document.memo = text(value.memo) || "";
  document.subtitleIndex =
    typeof value.subtitleIndex === "string" &&
    /^(auto|\d{1,4})$/.test(value.subtitleIndex)
      ? value.subtitleIndex
      : "auto";
  // Platform captions are fetched on demand and may have no locally pasted transcript.
  document.transcriptOffset =
    validNumber(value.transcriptOffset) &&
    Number.isInteger(value.transcriptOffset)
      ? value.transcriptOffset
      : 0;
  document.scrollY = validNumber(value.scrollY) ? value.scrollY : 0;
  document.updatedAt = validNumber(value.updatedAt) ? value.updatedAt : 0;
  // Older saved documents keep the writing mode they used before article mode existed.
  document.noteMode = value.noteMode === "article" || value.noteMode === "study"
    ? value.noteMode : "full";
  document.generationState = ["running", "interrupted"].includes(
    value.generationState as string,
  )
    ? (value.generationState as LearningDocument["generationState"])
    : "idle";
  if (recover && document.generationState === "running")
    document.generationState = "interrupted";
  for (const key of ["note", "previousNote", "draft"] as const) {
    const note = readNote(value[key]);
    if (note) document[key] = note;
  }
  const fullJob = readFullJob(value.fullJob, recover);
  if (fullJob) document.fullJob = fullJob;
  else if (recover && isRecord(value.fullJob) && document.draft) {
    const oldSource = readEvidence(value.fullJob.source);
    if (oldSource) {
      document.draft.evidence = document.draft.evidence || oldSource;
      document.draft.error = document.draft.error ||
        "先前完整文档的分段规格已更新，请重新读取原文后整理；已有草稿与其原文已保留。";
      document.generationState = "interrupted";
    }
  }
  if (recover && document.fullJob?.status === "running")
    document.fullJob.status = "paused";
  const mindmap = readMindMap(value.mindmap, recover);
  if (mindmap) document.mindmap = mindmap;
  return document;
}

function readObject(value: unknown, recover: boolean): Workspace {
  const workspace = emptyWorkspace();
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.documents))
    return workspace;
  // Iterate values into canonical URL keys; never copy arbitrary stored keys or prototypes.
  for (const key of Object.keys(value.documents).slice(0, MAX_READ_DOCUMENTS)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) continue;
    const document = readDocument(value.documents[key], recover);
    if (!document) continue;
    const existing = workspace.documents[document.id];
    if (!existing || document.updatedAt > existing.updatedAt)
      workspace.documents[document.id] = document;
  }
  if (typeof value.activeId === "string") {
    try {
      const id = documentId(value.activeId);
      if (hasOwn(workspace.documents, id)) workspace.activeId = id;
    } catch {
      /* Fall back to the most recently used valid document. */
    }
  }
  if (!workspace.activeId)
    workspace.activeId =
      Object.values(workspace.documents).sort(
        (a, b) => b.updatedAt - a.updatedAt,
      )[0]?.id || null;
  return workspace;
}

export function readWorkspace(raw: string | null): Workspace {
  if (!raw || typeof raw !== "string" || raw.length > MAX_READ_CHARACTERS)
    return emptyWorkspace();
  try {
    return readObject(JSON.parse(raw), true);
  } catch {
    return emptyWorkspace();
  }
}

export function migrateHistory(
  raw: string | null,
): { url: string; title: string }[] {
  if (!raw || typeof raw !== "string" || raw.length > 100000) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed
      .slice(0, 100)
      .filter(isRecord)
      .flatMap((item) => {
        if (!text(item.title, 1000)?.trim() || typeof item.url !== "string")
          return [];
        try {
          const url = documentId(item.url);
          if (seen.has(url)) return [];
          seen.add(url);
          return [{ url, title: item.title as string }];
        } catch {
          return [];
        }
      })
      .slice(0, 8);
  } catch {
    return [];
  }
}

function hasWork(document: LearningDocument): boolean {
  return !!(
    document.note ||
    document.previousNote ||
    document.draft ||
    document.memo ||
    document.transcript ||
    document.fullJob ||
    document.mindmap ||
    document.generationState !== "idle"
  );
}

export function serializeWorkspace(workspace: Workspace): string {
  if (
    !workspace ||
    !isRecord(workspace.documents) ||
    Object.keys(workspace.documents).length > MAX_READ_DOCUMENTS
  ) {
    throw new Error("笔记数量或格式超出本机保存范围，请先导出重要笔记。");
  }
  const safe = readObject(workspace, false);
  const seen = new Set<string>();
  for (const original of Object.values(workspace.documents)) {
    let id: string;
    try {
      id = documentId(original.video.url);
    } catch {
      throw new Error("部分视频资料无效，当前修改尚未保存。请先导出重要笔记。");
    }
    const saved = safe.documents[id];
    if (
      !saved ||
      seen.has(id) ||
      saved.transcript !== original.transcript ||
      saved.memo !== original.memo
    ) {
      throw new Error(
        "部分笔记内容超出本机保存范围，当前修改尚未保存。请先导出重要笔记。",
      );
    }
    seen.add(id);
    for (const key of ["note", "previousNote", "draft"] as const) {
      if (
        original[key] &&
        (!saved[key] ||
          saved[key]!.text !== original[key]!.text ||
          saved[key]!.source !== original[key]!.source ||
          (original[key]!.evidence && !saved[key]!.evidence))
      ) {
        throw new Error(
          "部分笔记内容超出本机保存范围，当前修改尚未保存。请先导出重要笔记。",
        );
      }
    }
    if (
      original.fullJob &&
      (!saved.fullJob ||
        saved.fullJob.sections.length !== original.fullJob.sections.length ||
        saved.fullJob.source.cues.length !==
          original.fullJob.source.cues.length)
    ) {
      throw new Error(
        "完整文档的进度超出本机保存范围，当前修改尚未保存。请先导出重要笔记。",
      );
    }
    if (original.mindmap !== undefined && !saved.mindmap) {
      throw new Error(
        "思维导图的内容或进度超出本机保存范围，当前修改尚未保存。请先导出重要笔记。",
      );
    }
  }
  const empty = Object.values(safe.documents)
    .filter((document) => !hasWork(document) && document.id !== safe.activeId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const activeIsEmpty =
    safe.activeId && !hasWork(safe.documents[safe.activeId]);
  for (const document of empty.slice(
    MAX_EMPTY_DOCUMENTS - (activeIsEmpty ? 1 : 0),
  ))
    delete safe.documents[document.id];
  let serialized = JSON.stringify(safe);
  // Only expendable metadata may be evicted. Notes and user input are never silently dropped.
  while (serialized.length > MAX_STORAGE_CHARACTERS && empty.length) {
    const document = empty.pop()!;
    delete safe.documents[document.id];
    serialized = JSON.stringify(safe);
  }
  if (serialized.length > MAX_STORAGE_CHARACTERS)
    throw new Error(
      "本机保存空间不足，当前修改尚未保存。请先导出重要笔记，再删除不需要的内容。",
    );
  return serialized;
}

export function upsertDocument(
  workspace: Workspace,
  document: LearningDocument,
): Workspace {
  const id = documentId(document.video.url);
  const documents: Workspace["documents"] = Object.assign(
    Object.create(null),
    workspace.documents,
  );
  documents[id] = { ...document, id };
  return { version: 1, documents, activeId: workspace.activeId || id };
}
