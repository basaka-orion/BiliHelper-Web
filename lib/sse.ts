// Preserves UTF-8 and frames split across network chunks, including a final frame without a newline.
export async function readSSE(body: ReadableStream<Uint8Array>, onData: (data: string) => void) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const process = (line: string) => { if (line.startsWith('data:')) onData(line.slice(5).trim()) }
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) process(line.replace(/\r$/, ''))
      if (done) { if (buffer) process(buffer); break }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

// Tags may be split into individual tokens; retain incomplete prefixes until the next chunk.
export class ThinkFilter {
  private buffer = ''
  private thinking = false
  push(text: string, flush = false) {
    this.buffer += text
    let output = ''
    while (this.buffer) {
      const tag = this.thinking ? '</think>' : '<think>'
      const index = this.buffer.indexOf(tag)
      if (index >= 0) {
        if (!this.thinking) output += this.buffer.slice(0, index)
        this.buffer = this.buffer.slice(index + tag.length)
        this.thinking = !this.thinking
        continue
      }
      let keep = 0
      if (!flush) for (let i = 1; i < tag.length; i++) if (this.buffer.endsWith(tag.slice(0, i))) keep = i
      if (!this.thinking) output += this.buffer.slice(0, this.buffer.length - keep)
      this.buffer = keep ? this.buffer.slice(-keep) : ''
      break
    }
    return output
  }
}
