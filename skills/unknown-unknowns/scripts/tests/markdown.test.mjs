import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderMarkdown, renderText } from '../page/markdown.mjs';

test('raw HTML shows as text', () => {
  const html = renderMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)> "quotes" & \'single\'');
  assert.doesNotMatch(html, /<script|<img/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&quot;quotes&quot; &amp; &#39;single&#39;/);
});

test('only safe link targets become links', () => {
  const html = renderMarkdown('[a](javascript:alert(1)) [b](JaVaScRiPt:x) [c](data:text/html,x) [d](https://example.com/a_(b)) [e](files/x.html) [f](mailto:a@b.c)');
  assert.doesNotMatch(html, /javascript|data:/i);
  assert.match(html, /<a href="https:\/\/example\.com\/a_\(b\)" target="_blank" rel="noopener noreferrer">d<\/a>/);
  assert.match(html, /<a href="files\/x\.html"/);
  assert.match(html, /<a href="mailto:a@b\.c"/);
  const breakout = renderMarkdown('[x]("onmouseover=alert(1))');
  assert.doesNotMatch(breakout, /href="[^"]*"[^>]*onmouseover/);
});

test('inline marks render', () => {
  assert.equal(
    renderMarkdown('**bold**, *italic*, _also_, `a <b>` and snake_case_name'),
    '<p><strong>bold</strong>, <em>italic</em>, <em>also</em>, <code>a &lt;b&gt;</code> and snake_case_name</p>',
  );
  assert.match(renderMarkdown('See https://example.com/path.'), /<a href="https:\/\/example\.com\/path"[^>]*>https:\/\/example\.com\/path<\/a>\./);
});

test('blocks render: paragraphs, headings, lists, code and quotes', () => {
  const html = renderMarkdown([
    '# Title', '', 'One line', 'next line', '', '- a', '- b', '  - nested', '', '1. first', '2. second',
    '', '```js', 'const x = "<y>";', '```', '', '> quoted',
  ].join('\n'));
  assert.equal(html, [
    '<h3>Title</h3>',
    '<p>One line<br>next line</p>',
    '<ul><li>a</li><li>b\n<ul><li>nested</li></ul></li></ul>',
    '<ol><li>first</li><li>second</li></ol>',
    '<pre><code>const x = &quot;&lt;y&gt;&quot;;</code></pre>',
    '<blockquote><p>quoted</p></blockquote>',
  ].join('\n'));
});

test('text files become one escaped code block', () => {
  assert.equal(renderText('a <b>\n&c'), '<pre><code>a &lt;b&gt;\n&amp;c</code></pre>');
});
