export class HttpError extends Error {
  constructor(message: string, public status = 502) { super(message) }
}
export async function readJson(response: Response, name = '上游服务') {
  if (!response.ok) throw new HttpError(`${name}暂时无法访问（${response.status}），请稍后重试`)
  const text = await response.text()
  try { return JSON.parse(text) } catch { throw new HttpError(`${name}返回了验证页面，请稍后重试`) }
}
export async function requestJson(url: string, init: RequestInit = {}, name = '上游服务', timeout = 10000) {
  try {
    return await readJson(await fetch(url, { ...init, cache: 'no-store', signal: init.signal || AbortSignal.timeout(timeout) }), name)
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(`${name}连接超时或暂时不可用，请稍后重试`)
  }
}
export const biliHeaders = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', Referer: 'https://www.bilibili.com/', Accept: 'application/json, text/plain, */*' }

export async function biliJson(path: string) {
  const cookie = `buvid3=${crypto.randomUUID().toUpperCase()}infoc; b_nut=${Math.floor(Date.now() / 1000)}`
  const data = await requestJson(`https://api.bilibili.com${path}`, { headers: { ...biliHeaders, Cookie: cookie } }, 'B 站')
  if (data.code !== 0) {
    if ([-404, 62002, 62004].includes(data.code)) throw new HttpError('视频不存在、已删除或不可公开访问', 404)
    throw new HttpError(data.code === -412 ? 'B 站暂时限制了访问，请稍后重试' : `B 站：${data.message || '暂时不可用'}`)
  }
  return data.data
}
export function errorResponse(error: unknown) {
  const status = error instanceof HttpError ? error.status : error instanceof SyntaxError ? 400 : 500
  return Response.json({ error: error instanceof HttpError ? error.message : status === 400 ? '请求格式不正确' : '服务暂时不可用，请稍后重试' }, { status })
}
