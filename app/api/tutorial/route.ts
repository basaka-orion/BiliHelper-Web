import { NextRequest } from 'next/server'

export const maxDuration = 60

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''

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

        // 构建 Gemini prompt
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
- 避免专业术语，如果必须用则附上解释`

        // 调用 Gemini API（流式）
        const geminiResp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 4096,
                    },
                }),
            }
        )

        if (!geminiResp.ok) {
            const errText = await geminiResp.text()
            return new Response(
                JSON.stringify({ error: `Gemini API 错误: ${errText.slice(0, 200)}` }),
                { status: 502, headers: { 'Content-Type': 'application/json' } }
            )
        }

        // 转发 SSE 流
        const encoder = new TextEncoder()
        const readable = new ReadableStream({
            async start(controller) {
                const reader = geminiResp.body?.getReader()
                if (!reader) {
                    controller.close()
                    return
                }

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
                                    const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text
                                    if (text) {
                                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`))
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
