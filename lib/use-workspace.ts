"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  emptyWorkspace,
  readWorkspace,
  serializeWorkspace,
  STORAGE_KEY,
  type Workspace,
  type LearningDocument,
} from "./workspace";

export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace);
  const current = useRef(workspace);
  const baseline = useRef<string | null>(null);
  const dirty = useRef(false);
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "failed">(
    "saved",
  );
  const [saveError, setSaveError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const write = useCallback(() => {
    if (!dirty.current) return;
    if (localStorage.getItem(STORAGE_KEY) !== baseline.current)
      throw new Error(
        "另一页面更新了笔记。为保护双方内容，本页修改尚未保存；请先导出本页笔记，再重新打开工作台。",
      );
    const serialized = serializeWorkspace(current.current);
    localStorage.setItem(STORAGE_KEY, serialized);
    baseline.current = serialized;
    dirty.current = false;
  }, []);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    try {
      write();
      setSaveStatus("saved");
      setSaveError("");
    } catch (error) {
      setSaveStatus("failed");
      setSaveError(
        error instanceof DOMException && error.name === "QuotaExceededError"
          ? "本机保存空间不足，当前修改尚未保存。请先导出笔记，再释放浏览器空间。"
          : error instanceof Error
            ? error.message
            : "本机保存失败，请导出笔记后释放浏览器空间。",
      );
    }
  }, [write]);
  const commit = useCallback(
    (change: (value: Workspace) => Workspace) => {
      const next = change(current.current);
      current.current = next;
      dirty.current = true;
      setWorkspace(next);
      setSaveStatus("saving");
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 250);
    },
    [flush],
  );
  const updateDocument = useCallback(
    (id: string, change: (value: LearningDocument) => LearningDocument) => {
      commit((value) => {
        const document = value.documents[id];
        if (!document) return value;
        return {
          ...value,
          documents: { ...value.documents, [id]: change(document) },
        };
      });
    },
    [commit],
  );
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY),
        restored = readWorkspace(raw);
      baseline.current = raw;
      current.current = restored;
      setWorkspace(restored);
    } catch {
      setSaveStatus("failed");
      setSaveError("浏览器未允许本机保存。请导出重要笔记。");
    }
    setReady(true);
    const saveOnExit = () => {
      try {
        write();
      } catch {}
    };
    const storageChanged = (event: StorageEvent) => {
      if (
        event.key !== STORAGE_KEY ||
        dirty.current ||
        Object.values(current.current.documents).some(
          (document) => document.generationState === "running",
        )
      )
        return;
      const restored = readWorkspace(event.newValue),
        activeId = current.current.activeId;
      if (activeId && restored.documents[activeId])
        restored.activeId = activeId;
      baseline.current = event.newValue;
      current.current = restored;
      setWorkspace(restored);
    };
    window.addEventListener("pagehide", saveOnExit);
    window.addEventListener("storage", storageChanged);
    return () => {
      clearTimeout(timer.current);
      saveOnExit();
      window.removeEventListener("pagehide", saveOnExit);
      window.removeEventListener("storage", storageChanged);
    };
  }, [write]);
  return {
    workspace,
    current,
    ready,
    saveStatus,
    saveError,
    commit,
    updateDocument,
    flush,
  };
}
