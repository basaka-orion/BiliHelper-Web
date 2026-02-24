import { NextRequest } from 'next/server'

export const maxDuration = 60

const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY || ''
const SILICONFLOW_BASE = 'https://api.siliconflow.cn/v1'
const MODEL = 'Qwen/Qwen3-8B'

export async function POST(req: NextRequest) {
    try {
        const { subtitleUrl, title, description } = await req.json()

        let subtitleText = ''

        // 方式 1: 从字幕 URL 提取文本
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

        // 方式 2: 没有字幕时用描述
        if (!subtitleText && description) {
            subtitleText = description
        }

        if (!subtitleText) {
            return new Response(
                JSON.stringify({ error: '该视频没有字幕，无法生成教程。请选择有字幕的视频。' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            )
        }

        // 构建 prompt
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

        if (!SILICONFLOW_API_KEY) {
            return new Response(
                JSON.stringify({ error: 'AI 服务未配置。请在环境变量中设置 SILICONFLOW_API_KEY。' }),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            )
        }

        // 调用 SiliconFlow API（OpenAI 兼容格式，SSE 流式）
        const apiResp = await fetch(`${SILICONFLOW_BASE}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SILICONFLOW_API_KEY}`,
            },
            body: JSON.stringify({
                model: MODEL,
                messages: [
                    { role: 'system', content: '你是一位专业的教学内容设计师，擅长将视频内容转化为通俗易懂的图文教程。直接输出内容，不要输出思考过程。' },
                    { role: 'user', content: prompt },
                ],
                stream: true,
                temperature: 0.7,
                max_tokens: 4096,
            }),
        })

        if (!apiResp.ok) {
            const errText = await apiResp.text()
            return new Response(
                JSON.stringify({ error: `AI API 错误: ${errText.slice(0, 200)}` }),
                { status: 502, headers: { 'Content-Type': 'application/json' } }
            )
        }

        // 转发 SSE 流（OpenAI 格式）
        const encoder = new TextEncoder()
        const readable = new ReadableStream({
            async start(controller) {
                const reader = apiResp.body?.getReader()
                if (!reader) {
                    controller.close()
                    return
                }

                const decoder = new TextDecoder()
                let buffer = ''
                let inThinkBlock = false

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
                                        // 过滤 <think>...</think> 思考过程
                                        let filtered = text
                                        if (inThinkBlock) {
                                            const endIdx = filtered.indexOf('</think>')
                                            if (endIdx !== -1) {
                                                filtered = filtered.slice(endIdx + 8)
                                                inThinkBlock = false
                                            } else {
                                                continue // 跳过思考内容
                                            }
                                        }
                                        const startIdx = filtered.indexOf('<think>')
                                        if (startIdx !== -1) {
                                            const beforeThink = filtered.slice(0, startIdx)
                                            const afterStart = filtered.slice(startIdx + 7)
                                            const endInSame = afterStart.indexOf('</think>')
                                            if (endInSame !== -1) {
                                                filtered = beforeThink + afterStart.slice(endInSame + 8)
                                            } else {
                                                filtered = beforeThink
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

        return new Response(readable, {
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
