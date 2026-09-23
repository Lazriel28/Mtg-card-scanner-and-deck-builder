'use strict';
// WorldForge card-type engine (M2 groundwork).
// setTypeInRaw never clobbers other frontmatter keys and creates the block
// only when needed. Empty newType removes the key (note becomes untyped).

function setTypeInRaw(raw, newType) {
  raw = String(raw || '');
  const fmMatch = /^---\n([\s\S]*?)\n---/.exec(raw);
  if (!fmMatch) {
    if (!newType) return raw;
    return `---\ntype: ${newType}\n---\n\n` + raw;
  }
  const fm = fmMatch[1];
  let newFm;
  if (newType) {
    newFm = /^type:.*$/im.test(fm)
      ? fm.replace(/^type:.*$/im, `type: ${newType}`)
      : `type: ${newType}\n` + fm;
  } else {
    newFm = fm.replace(/^type:.*\n?/im, '');
  }
  return raw.replace(fmMatch[0], '---\n' + newFm.replace(/\n+$/, '') + '\n---');
}

function getTypeFromRaw(raw) {
  const m = /^---\n([\s\S]*?)\n---/.exec(String(raw || ''));
  if (!m) return null;
  const t = /^type:\s*(.+)$/im.exec(m[1]);
  return t ? t[1].trim() : null;
}

module.exports = { setTypeInRaw, getTypeFromRaw };
