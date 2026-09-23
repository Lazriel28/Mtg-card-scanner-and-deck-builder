'use strict';
// WorldForge - shared markdown/wikilink renderer used by both the app and the exported wiki.

function splitAlias(inner) {
  const i = inner.indexOf('|');
  if (i === -1) return { target: inner.trim(), label: inner.trim() };
  return { target: inner.slice(0, i).trim(), label: inner.slice(i + 1).trim() };
}

function basenameNoExt(t) {
  const p = t.split('/');
  return p[p.length - 1].replace(/\.md$/i, '');
}

// Returns array of {type:'text'|'wikilink'|'tag'|'code', ...}
// inline code spans are extracted FIRST so [[links]] and #tags inside
// backticks render literally (this bit the manual hard).
function parseInline(text) {
  const out = [];
  const codeSplit = /(`[^`]+`)/g;
  let last = 0, cm;
  while ((cm = codeSplit.exec(text))) {
    if (cm.index > last) parsePlain(text.slice(last, cm.index), out);
    out.push({ type: 'code', text: cm[1].slice(1, -1) });
    last = cm.index + cm[1].length;
  }
  if (last < text.length) parsePlain(text.slice(last), out);
  return out;
}

function parsePlain(text, out) {
  const re = /\[\[([^\][|]*(?:\|[^\][]*)?)\]\]|\B#([\w/-]+)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) {
      const { target, label } = splitAlias(m[1]);
      out.push({ type: 'wikilink', target, label });
    } else {
      out.push({ type: 'tag', tag: m[2] });
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// inline emphasis applied AFTER escaping (so it can't create tags from user input)
function inlineFmt(escaped) {
  return escaped
    .replace(/`([^`]+)`/g, '<code class="inline">$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
}

function slugFor(target, exists) {
  const t = target.replace(/\.md$/i, '');
  if (exists) return 'page-' + t.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.html';
  return 'missing:' + t;
}

function anchorFor(tag) {
  return 'tag-' + tag.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

// block-level markdown -> html. lineLinks: fn(target, exists) -> href.
// opts.allowHtml: pass through raw inline HTML unescaped — ONLY for trusted
// author-owned content like the generated manual; never for user notes.
function renderMarkdown(src, existsFn, lineLinks, opts) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  let html = '', i = 0;
  const exists = (t) => existsFn ? existsFn(t) : true;
  const rawText = !!(opts && opts.allowHtml);

  function inlineTokens(text) {
    let out = '';
    for (const tok of parseInline(text)) {
      if (tok.type === 'text') { out += rawText ? inlineFmt(tok.text) : inlineFmt(esc(tok.text)); continue; }
      if (tok.type === 'code') { out += `<code class="inline">${rawText ? tok.text : esc(tok.text)}</code>`; continue; }
      if (tok.type === 'wikilink') {
        const ok = exists(tok.target);
        const href = lineLinks ? lineLinks(tok.target, ok) : slugFor(tok.target, ok);
        if (ok) out += `<a class="wl" href="${esc(href)}">${inlineFmt(esc(tok.label))}</a>`;
        else out += `<a class="wl missing" title="Unresolved note" data-missing="${esc(tok.target)}">${inlineFmt(esc(tok.label))}</a>`;
        continue;
      }
      out += `<a class="tagref" href="#${anchorFor(tok.tag)}">#${inlineFmt(esc(tok.tag))}</a>`;
    }
    return out;
  }

  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { const n = h[1].length; html += `<h${n}>${inlineTokens(h[2])}</h${n}>`; i++; continue; }

    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, '').trim();
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // closing fence
      html += `<pre><code${lang ? ` data-lang="${esc(lang)}"` : ''}>${esc(buf.join('\n'))}</code></pre>`;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      html += `<blockquote>${renderMarkdown(buf.join('\n'), existsFn, lineLinks)}</blockquote>`;
      continue;
    }

    if (/^\s*([-*+])\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*([-*+])\s+/.test(lines[i])) {
        items.push(inlineTokens(lines[i].replace(/^\s*([-*+])\s+/, ''))); i++;
      }
      html += `<ul>${items.map(x => `<li>${x}</li>`).join('')}</ul>`;
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(inlineTokens(lines[i].replace(/^\s*\d+[.)]\s+/, ''))); i++;
      }
      html += `<ol>${items.map(x => `<li>${x}</li>`).join('')}</ol>`;
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) { html += '<hr>'; i++; continue; }

    // tables: header row with |, next line is the ---|--- separator
    if (line.includes('|') && i + 1 < lines.length &&
        /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const splitRow = row => row.trim().replace(/^\||\|$/g, '').split('|').map(s => s.trim());
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      html += '<table><thead><tr>' + header.map(h => `<th>${inlineTokens(h)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + header.map((_, c) => `<td>${inlineTokens(r[c] || '')}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
      continue;
    }

    // paragraph
    const para = [];
    const tableAhead = li => li.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-');
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !tableAhead(lines[i]) &&
           !/^(#{1,6})\s+|^```|^>\s?|^\s*([-*+])\s+|^\s*\d+[.)]\s+|^\s*---+\s*$/.test(lines[i])) {
      para.push(lines[i]); i++;
    }
    html += `<p>${inlineTokens(para.join('\n').replace(/\n/g, '<br>'))}</p>`;
  }
  return html;
}

function extractTags(src) {
  const set = new Set();
  let m; const re = /\B#([\w/-]+)/g;
  const stripped = String(src).replace(/```[\s\S]*?```/g, ' ');
  while ((m = re.exec(stripped))) set.add(m[1]);
  return [...set];
}

module.exports = { renderMarkdown, extractTags, basenameNoExt, slugFor, anchorFor, esc, parseInline };
