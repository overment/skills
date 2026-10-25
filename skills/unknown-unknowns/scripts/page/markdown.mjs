// A small, safe Markdown renderer for notes and text files. It escapes HTML first, then renders
// paragraphs, headings, bold, italic, inline code, code blocks, links, lists and quotes.
// Links keep only http, https, mailto and relative targets. Raw HTML always shows as text.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>\s?/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/;

export function renderMarkdown(source) {
  const text = String(source ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0002]/g, '');
  return blocks(text.split('\n'));
}

/** Plain text as one code block, for logs, data and source files. */
export function renderText(source) {
  return `<pre><code>${escapeHtml(String(source ?? ''))}</code></pre>`;
}

const startsBlock = (line) => FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line);
const closesFence = (line, fence) => {
  const m = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
  return Boolean(m) && m[1][0] === fence[0] && m[1].length >= fence.length;
};

function blocks(lines) {
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    let m = line.match(FENCE);
    if (m) {
      const fence = m[1];
      const body = [];
      i++;
      while (i < lines.length && !closesFence(lines[i], fence)) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    m = line.match(HEADING);
    if (m) {
      const level = Math.min(6, m[1].length + 2); // the panel title is h2
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
      i++;
      continue;
    }

    if (RULE.test(line)) { out.push('<hr>'); i++; continue; }

    if (QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && lines[i].trim() && QUOTE.test(lines[i])) body.push(lines[i++].replace(QUOTE, ''));
      out.push(`<blockquote>${blocks(body)}</blockquote>`);
      continue;
    }

    m = line.match(ITEM);
    if (m) {
      const [html, next] = list(lines, i);
      out.push(html);
      i = next;
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && (para.length === 0 || !startsBlock(lines[i]))) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join('\n'))}</p>`);
  }
  return out.join('\n');
}

const indentOf = (line) => line.match(/^ */)[0].length;
const isOrdered = (marker) => /\d/.test(marker);

function list(lines, start) {
  const first = lines[start].match(ITEM);
  const indent = first[1].length;
  const ordered = isOrdered(first[2]);
  const items = [];
  let loose = false;
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(ITEM);
    if (m && m[1].length === indent && isOrdered(m[2]) === ordered) {
      items.push([m[3]]);
      i++;
      continue;
    }
    if (!line.trim()) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const next = lines[j];
      const nextItem = next?.match(ITEM);
      if (next !== undefined && (indentOf(next) > indent || (nextItem && nextItem[1].length === indent && isOrdered(nextItem[2]) === ordered))) {
        if (indentOf(next) > indent) items[items.length - 1].push('');
        else loose = true;
        i = j;
        continue;
      }
      break;
    }
    if (indentOf(line) > indent) {
      items[items.length - 1].push(line.slice(Math.min(indentOf(line), indent + 2)));
      i++;
      continue;
    }
    if (!startsBlock(line)) { // a lazy continuation line
      items[items.length - 1].push(line.trim());
      i++;
      continue;
    }
    break;
  }

  const tag = ordered ? 'ol' : 'ul';
  const number = ordered ? parseInt(first[2], 10) : 1;
  const startAttr = ordered && number !== 1 ? ` start="${number}"` : '';
  const html = items.map((body) => {
    let inner = blocks(body);
    if (!loose && !body.includes('')) inner = inner.replace(/^<p>([\s\S]*?)<\/p>/, '$1');
    return `<li>${inner}</li>`;
  });
  return [`<${tag}${startAttr}>${html.join('')}</${tag}>`, i];
}

function safeHref(raw) {
  const href = raw.replace(/&amp;/g, '&').trim();
  if (/^(https?:|mailto:)/i.test(href)) return raw;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('//')) return raw; // relative
  return null;
}

/** Inline Markdown on one block of text. Code spans and links become placeholders first. */
function inline(text) {
  const codes = [];
  const links = [];
  let s = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, _ticks, code) => {
    codes.push(`<code>${escapeHtml(code.trim() || code)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  const link = (label, href) => {
    const safe = safeHref(href);
    const html = safe === null ? label : `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    links.push(html);
    return `\u0001${links.length - 1}\u0001`;
  };
  s = s.replace(/\[([^\]\n]+)\]\(\s*((?:[^\s()]|\([^\s()]*\))+)(?:\s+&quot;[^\n]*?&quot;)?\s*\)/g, (_, label, href) => link(emphasis(label), href));
  s = s.replace(/&lt;(https?:\/\/[^\s&]+(?:&amp;[^\s&]+)*)&gt;/g, (_, url) => link(url, url));
  s = s.replace(/\bhttps?:\/\/[^\s<\u0000\u0001]*[^\s<.,:;!?)\]'"\u0000\u0001]/g, (url) => link(url, url));
  s = emphasis(s).replace(/\n/g, '<br>');
  s = s.replace(/\u0001(\d+)\u0001/g, (_, n) => links[n]);
  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => codes[n]);
}

function emphasis(s) {
  return s
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\p{L}\p{N}_])__(?=\S)([\s\S]*?\S)__(?![\p{L}\p{N}_])/gu, '$1<strong>$2</strong>')
    .replace(/\*(?=[^\s*])([^*\n]*?[^\s*])\*/g, '<em>$1</em>')
    .replace(/(^|[^\p{L}\p{N}_])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\p{L}\p{N}_])/gu, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
}
