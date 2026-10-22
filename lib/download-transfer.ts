export interface DownloadWritable {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

interface TransferOptions {
  expectedSize: number;
  maxBytes: number;
  signal: AbortSignal;
  createWritable?: () => Promise<DownloadWritable>;
  onProgress?: (bytes: number, total: number) => void;
}

/** Save only a complete, bounded MP4 response. Failed file writes are never committed. */
export async function transferMp4(
  response: Response,
  options: TransferOptions,
) {
  const { signal, maxBytes, createWritable, onProgress } = options;
  const expected =
    Number.isSafeInteger(options.expectedSize) && options.expectedSize > 0
      ? options.expectedSize
      : 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let writable: DownloadWritable | undefined;
  const stopped = () => {
    void reader?.cancel().catch(() => {});
    void writable?.abort().catch(() => {});
  };
  const checkStopped = () => {
    if (signal.aborted) throw new DOMException("下载已停止。", "AbortError");
  };
  try {
    checkStopped();
    if (!response.ok || !response.body)
      throw new Error(`视频 CDN 返回 ${response.status}`);
    reader = response.body.getReader();
    signal.addEventListener("abort", stopped, { once: true });
    checkStopped();
    const type = response.headers
      .get("content-type")
      ?.split(";")[0]
      .trim()
      .toLowerCase();
    if (
      type &&
      ![
        "video/mp4",
        "application/mp4",
        "application/octet-stream",
        "binary/octet-stream",
      ].includes(type)
    )
      throw new Error("下载地址返回的不是 MP4 视频，请使用本机下载。");
    const length = response.headers.get("content-length");
    const declared = length === null ? 0 : Number(length);
    if (length !== null && (!Number.isSafeInteger(declared) || declared < 1))
      throw new Error("视频文件大小无效，请重新获取下载地址。");
    if (expected && declared && expected !== declared)
      throw new Error("下载地址返回了部分文件或大小不一致，请重新获取地址。");
    let total = expected || declared;
    if (response.status === 206) {
      const range = response.headers
        .get("content-range")
        ?.match(/^bytes 0-(\d+)\/(\d+)$/i);
      if (
        !range ||
        !Number.isSafeInteger(Number(range[2])) ||
        Number(range[2]) < 1 ||
        Number(range[1]) + 1 !== Number(range[2]) ||
        (total && Number(range[2]) !== total)
      )
        throw new Error("下载地址只返回了部分视频，请使用完整下载地址。");
      total = Number(range[2]);
    }
    if (total > maxBytes)
      throw new Error(
        `文件超过当前保存方式的 ${Math.round(maxBytes / 1024 / 1024)} MiB 上限，请使用本机下载。`,
      );
    if (createWritable) {
      writable = await createWritable();
      checkStopped();
    }
    const chunks: Uint8Array[] = [];
    const prefix = new Uint8Array(12);
    let prefixBytes = 0,
      bytes = 0,
      firstBoxSize = 0,
      lastProgress = 0;
    while (true) {
      checkStopped();
      const { value, done } = await reader.read();
      checkStopped();
      if (done) break;
      if (!value?.byteLength) continue;
      bytes += value.byteLength;
      if (bytes > maxBytes || (total && bytes > total))
        throw new Error(
          "视频流超过允许大小，已停止保存。请重新获取地址或使用本机下载。",
        );
      if (prefixBytes < prefix.length) {
        const take = Math.min(prefix.length - prefixBytes, value.byteLength);
        prefix.set(value.subarray(0, take), prefixBytes);
        prefixBytes += take;
        if (prefixBytes === prefix.length) {
          firstBoxSize = new DataView(prefix.buffer).getUint32(0);
          if (
            String.fromCharCode(prefix[4], prefix[5], prefix[6], prefix[7]) !==
              "ftyp" ||
            firstBoxSize < 16 ||
            firstBoxSize > maxBytes
          )
            throw new Error(
              "文件没有有效的 MP4 标识，已停止保存。请使用本机下载。",
            );
        }
      }
      if (writable) await writable.write(value);
      else chunks.push(value);
      const now = Date.now();
      if (now - lastProgress > 120) {
        lastProgress = now;
        onProgress?.(bytes, total);
      }
    }
    checkStopped();
    if (prefixBytes < prefix.length || firstBoxSize > bytes)
      throw new Error("视频文件为空或 MP4 文件头不完整，已停止保存。");
    if (total && bytes !== total)
      throw new Error(
        `文件传输不完整（收到 ${bytes} 字节，应为 ${total} 字节）。请重试。`,
      );
    if (writable) {
      await writable.close();
      checkStopped();
    }
    onProgress?.(bytes, total || bytes);
    return {
      bytes,
      blob: writable
        ? undefined
        : new Blob(chunks as BlobPart[], { type: "video/mp4" }),
    };
  } catch (error) {
    if (reader) await reader.cancel().catch(() => {});
    else await response.body?.cancel().catch(() => {});
    if (writable) await writable.abort().catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener("abort", stopped);
    reader?.releaseLock();
  }
}
