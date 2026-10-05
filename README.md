# BiliHelper

解析 B 站 / YouTube 视频，生成基于实际视频内容的学习笔记，提供下载方式。

## 运行与验证

```sh
npm ci
npm run dev
npm test
npm run typecheck
npm run build
```

`npm test` 覆盖分享链接清理、分 P、伪造域名、资源代理限制、下载命令转义、跨字节 SSE 与跨块思考标签过滤。

## 环境变量

- `BIBIGPT_API_TOKEN`：自动提取视频内容并生成笔记。保留在服务端。
- `SILICONFLOW_API_KEY`：分析平台字幕或用户粘贴的字幕，及自动提取失败后的备用服务。
- `SILICONFLOW_MODEL`：可选，默认 `Qwen/Qwen3-8B`。

没有配置 AI 服务时，解析和下载指令仍可使用；AI 区显示配置错误及重试入口。默认先尝试 BibiGPT；用户指定平台字幕或粘贴文本时直接使用字幕分析服务。不会将简介伪装为字幕。

## 功能边界

- B 站 BV / av、分享文本、b23 短链接、分 P；YouTube watch、短链接、Shorts、embed、live。
- 云端平台 API 不可用时尝试视频页面，再通过浏览器访问 B 站官方 JSONP API；不依赖第三方 B 站解析站。服务部署于香港区域。平台自身的登录、版权、区域和验证限制仍然适用。
- 小型单段 MP4 可以通过网页下载；大文件、分段视频、YouTube 和受限视频提供本机 yt-dlp 流程。最高画质合并及音频转换需要 FFmpeg。
- 最近解析记录仅保存在浏览器 localStorage，可清空。字幕文本与生成笔记不会写入本地解析记录。
- AI 请求有超时、停止、来源标记、失败重试及 Markdown 导出。导出中保留来源链接及未完成警告。
- 图片和字幕代理只接受指定平台的 HTTPS 资源，不跟随资源重定向。

## 部署

通过仓库的 Vercel 集成部署。`vercel.json` 指定 `hkg1`；不要将 API 密钥提交进仓库。预览环境需要单独配置 AI 环境变量。
