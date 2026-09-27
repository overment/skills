/**
 * The only Markdown renderer. Raw HTML in the source is shown as text, and links keep only safe schemes,
 * so document text and every `about` can go into the page (and the detail panel's innerHTML) as HTML.
 */
export function safeMarkdown(md: string): string {
  const html = Bun.markdown.html(md, { noHtmlBlocks: true, noHtmlSpans: true });
  // Any scheme other than http(s) and mailto (javascript:, data:, vbscript:…) becomes a dead link.
  return html.replace(/\b(href|src)="\s*(?!https?:|mailto:)[a-z][a-z0-9+.-]*:[^"]*"/gi, '$1="#"');
}
