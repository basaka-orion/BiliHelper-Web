// Some providers wrap the entire answer in a Markdown code fence; render its contents as a document.
// Leave actual programming examples and all nested code blocks intact.
export function tutorialMarkdown(text: string) {
  const opening = text.match(/^\s*```(?:markdown|md)[ \t]*\r?\n/i)
  if (!opening) return text
  return text.slice(opening[0].length).replace(/\r?\n```\s*$/, '')
}
