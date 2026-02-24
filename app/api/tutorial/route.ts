import { NextRequest } from 'next/server'

export const maxDuration = 60

/* ─── API Keys ─── */
const BIBIGPT_TOKEN = process.env.BIBIGPT_API_TOKEN || ''
const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY || ''
const SILICONFLOW_BASE = 'https://api.siliconflow.cn/v1'

/**
 * 模型自动进化铁律：保持使用 SiliconFlow 平台最新最佳免费模型
 * 当前：Qwen3-8B（免费，支持 OpenAI 格式）
 * 升级路径：关注 https://siliconflow.cn/models 的免费模型列表
 * 替换时只需修改下方 MODEL 常量
 */
const SILICONFLOW_MODEL = 'Qwen/Qwen3-8B'

/* ─── Think block filter ─── */
function stripThinkBlocks(text: string): string {
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
}

/* ═══════════════════════════════════════════════════════════
   Engine 1: BibiGPT — 主引擎
   一次调用完成字幕提取+AI总结，用户会员直接用
   ═══════════════════════════════════════════════════════════ */
async function generateViaBibiGPT(videoUrl: string, customPrompt?: string): Promise<string | null> {
    if (!BIBIGPT_TOKEN) return null

    try {
        const body: Record<string, unknown> = {
            url: videoUrl,
            includeDetail: true,
            promptConfig: {
                showEmoji: true,
                detailLevel: 800,
                outputLanguage: 'zh-CN',
                ...(customPrompt ? { customPrompt } : {}),
            },
        }

        const resp = await fetch('https://api.bibigpt.co/api/v1/summarizeWithConfig', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${BIBIGPT_TOKEN}`,
            },
            body: JSON.stringify(body),
        })

        if (!resp.ok) {
            // POST 失败时降级到 GET
            const getResp = await fetch(
                `https://api.bibigpt.co/api/open/${BIBIGPT_TOKEN}?url=${encodeURIComponent(videoUrl)}`,
                { redirect: 'follow' }
            )
            if (!getResp.ok) return null
            const getData = await getResp.json()
            if (getData.success && getData.summary) {
                return stripThinkBlocks(getData.summary)
            }
            return null
        }

        const data = await resp.json()
        if (data.success && data.summary) {
            return stripThinkBlocks(data.summary)
        }
        return null
    } catch {
        return null
    }
}

/* ═══════════════════════════════════════════════════════════
   Engine 2: SiliconFlow — 备用引擎
   本地字幕+Qwen3-8B 生成教程（当 BibiGPT 挂了或没配置时用）
   ═══════════════════════════════════════════════════════════ */
async function generateViaSiliconFlow(
    subtitleText: string,
    title: string,
): Promise<ReadableStream | null> {
    if (!SILICONFLOW_API_KEY || !subtitleText) return null

    const prompt = `你是一位顶级教学内容设计师。根据以下 B 站视频的字幕内容，生成一篇**结构清晰、适合零基础小白**的图文教程。

## 视频信息
- 标题：${title || '未知'}

## 字幕原文
${subtitleText.slice(0, 8000)}

## 教程生成要求
1. **标题**：取一个吸引小白的标题
2. **前言**：一段话概括这个视频讲了什么，让小白知道学完能获得什么
3. **核心知识点**：提炼 3-7 个关键知识点，每个知识点包含：
   - 知识点标题
   - 通俗易懂的解释（用类比、举例）
   - 实操步骤（如果有的话）
4. **常见问题**：预判小白可能遇到的 2-3 个问题，给出解答
5. **总结**：一句话总结核心收获

## 格式要求
- 使用 Markdown 格式
- 用 emoji 让内容更生动
- 语言亲切，像朋友在教你
- 避免专业术语，如果必须用则附上解释
- 不要输出任何思考过程（<think>标签内容），直接输出教程内容`

    const apiResp = await fetch(`${SILICONFLOW_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SILICONFLOW_API_KEY}`,
        },
        body: JSON.stringify({
            model: SILICONFLOW_MODEL,
            messages: [
                { role: 'system', content: '你是一位专业的教学内容设计师，擅长将视频内容转化为通俗易懂的图文教程。直接输出内容，不要输出思考过程。' },
                { role: 'user', content: prompt },
            ],
            stream: true,
            temperature: 0.7,
            max_tokens: 4096,
        }),
    })

    if (!apiResp.ok) return null

    // 转发 SSE 流（OpenAI 格式 → 我们的格式），过滤 <think> 块
    const encoder = new TextEncoder()
    let inThinkBlock = false

    return new ReadableStream({
        async start(controller) {
            const reader = apiResp.body?.getReader()
            if (!reader) { controller.close(); return }

            const decoder = new TextDecoder()
            let buffer = ''

            try {
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break

                    buffer += decoder.decode(value, { stream: true })
                    const lines = buffer.split('\n')
                    buffer = lines.pop() || ''

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const jsonStr = line.slice(6).trim()
                            if (jsonStr === '[DONE]') continue
                            try {
                                const parsed = JSON.parse(jsonStr)
                                const text = parsed?.choices?.[0]?.delta?.content
                                if (text) {
                                    let filtered = text
                                    if (inThinkBlock) {
                                        const endIdx = filtered.indexOf('</think>')
                                        if (endIdx !== -1) {
                                            filtered = filtered.slice(endIdx + 8)
                                            inThinkBlock = false
                                        } else {
                                            continue
                                        }
                                    }
                                    const startIdx = filtered.indexOf('<think>')
                                    if (startIdx !== -1) {
                                        const before = filtered.slice(0, startIdx)
                                        const afterStart = filtered.slice(startIdx + 7)
                                        const endInSame = afterStart.indexOf('</think>')
                                        if (endInSame !== -1) {
                                            filtered = before + afterStart.slice(endInSame + 8)
                                        } else {
                                            filtered = before
                                            inThinkBlock = true
                                        }
                                    }
                                    if (filtered) {
                                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: filtered })}\n\n`))
                                    }
                                }
                            } catch { /* skip malformed JSON */ }
                        }
                    }
                }
            } catch { /* stream closed */ }

            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
        },
    })
}

/* ═══════════════════════════════════════════════════════════
   Route Handler — 双引擎调度
   优先 BibiGPT（一键出结果），失败走 SiliconFlow（流式）
   ═══════════════════════════════════════════════════════════ */
export async function POST(req: NextRequest) {
    try {
        const { subtitleUrl, title, description, videoUrl } = await req.json()

        // ─── 引擎 1: BibiGPT（有视频 URL 时优先）───
        const resolvedUrl = videoUrl || ''
        if (resolvedUrl && BIBIGPT_TOKEN) {
            const result = await generateViaBibiGPT(resolvedUrl)
            if (result) {
                // BibiGPT 返回完整文本，我们模拟 SSE 分块发送
                const encoder = new TextEncoder()
                const chunkSize = 20 // 每次发送 20 字符，模拟流式效果
                const readable = new ReadableStream({
                    async start(controller) {
                        for (let i = 0; i < result.length; i += chunkSize) {
                            const chunk = result.slice(i, i + chunkSize)
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
                            // 微延迟让前端有打字机效果
                            await new Promise(r => setTimeout(r, 15))
                        }
                        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
                        controller.close()
                    },
                })
                return new Response(readable, {
                    headers: {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive',
                    },
                })
            }
        }

        // ─── 引擎 2: SiliconFlow Fallback ───
        let subtitleText = ''
        if (subtitleUrl) {
            try {
                const resp = await fetch(subtitleUrl)
                const data = await resp.json()
                if (data.body && Array.isArray(data.body)) {
                    subtitleText = data.body
                        .map((item: { content: string }) => item.content)
                        .join('\n')
                }
            } catch { /* 字幕获取失败 */ }
        }
        if (!subtitleText && description) {
            subtitleText = description
        }

        if (!subtitleText) {
            return new Response(
                JSON.stringify({ error: '该视频没有字幕，无法生成教程。请选择有字幕的视频。' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            )
        }

        if (!SILICONFLOW_API_KEY) {
            return new Response(
                JSON.stringify({ error: 'AI 服务未配置。' }),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            )
        }

        const stream = await generateViaSiliconFlow(subtitleText, title || '')
        if (!stream) {
            return new Response(
                JSON.stringify({ error: 'SiliconFlow API 调用失败' }),
                { status: 502, headers: { 'Content-Type': 'application/json' } }
            )
        }

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        })
    } catch (e: unknown) {
        return new Response(
            JSON.stringify({ error: `教程生成失败: ${e instanceof Error ? e.message : String(e)}` }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        )
    }
}
