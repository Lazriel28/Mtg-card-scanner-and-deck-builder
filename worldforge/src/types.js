'use strict';
// WorldForge card-type engine (M2 groundwork).
// setTypeInRaw never clobbers other frontmatter keys and creates the block
// only when needed. Empty newType removes the key (note becomes untyped).
//
// guessTypeFromContent: when a note has no explicit type:, the category is
// inferred from the NOTE ITSELF — its text and its tags — never from the
// folder it happens to sit in. Moving a note between folders can't change
// what it is.

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

// Score keyword sets against the note body + tags. Ordered checks: the most
// distinctive signals win, and ties keep the first match (character, then
// location, item, lore). Returns a canonical type or null.
const SIGNALS = [
  ['character', [
    /\b(he|she|they) (is|are) (a|an|the)\b/i,
    /\bborn\b/i, /\bage[d]?\b/i, /\bpersonality\b/i, /\bappearance\b/i,
    /\bbackstory\b/i, /\bmotivation(s)?\b/i, /\bgoals?\b/i, /\ballies?\b/i,
    /\benem(y|ies)\b/i, /\bshe\/her\b/i, /\bhe\/him\b/i, /\bnpc\b/i, /\bportrait\b/i,
    /\bskills?\b/i, /\boccupation\b/i, /\bfamily\b/i, /\bwife\b/i, /\bhusband\b/i,
    /\bdaughter\b/i, /\bson\b/i, /\btribe\b/i, /\bclan\b/i, /\bspecies\b/i, /\bloyalt(y|ies)\b/i,
  ]],
  ['location', [
    /\b(located|situated)\b/i, /\bpopulation\b/i, /\bclimate\b/i, /\bgeography\b/i,
    /\b(government|governed)\b/i, /\bdistrict(s)?\b/i, /\bmap\b/i, /\bcoordinates\b/i,
    /\bregion\b/i, /\bcity\b/i, /\btown\b/i, /\bvillage\b/i, /\bkingdom\b/i,
    /\bcapital\b/i, /\bfortress\b/i, /\bcave\b/i, /\bforest\b/i, /\bmountain(s)?\b/i,
    /\briver\b/i, /\bsea\b/i, /\bcoast\b/i, /\bharbo(u)?r\b/i, /\bcontinent\b/i,
    /\bnotable places\b/i, /\blandmarks?\b/i,
  ]],
  ['item', [
    /\bweapon\b/i, /\bsword\b/i, /\bblade\b/i, /\barmor(ry)?\b/i, /\bshield\b/i,
    /\bartifact\b/i, /\brelic\b/i, /\bpowers?(ed)? by\b/i, /\bweight\b/i,
    /\bmaterial(s)?\b/i, /\bforged\b/i, /\bcrafted\b/i, /\binventory\b/i,
    /\bvehicle\b/i, /\bship\b/i, /\bengine(s)?\b/i, /\bprice\b/i, /\bworth\b/i,
    /\bcapability|capabilities\b/i, /\bspecifications?\b/i, /\bprototype\b/i,
  ]],
  ['lore', [
    /\bhistory\b/i, /\blegend(s|ary)?\b/i, /\bmyth(s|ology)?\b/i, /\breligion\b/i,
    /\bgod(s)?\b/i, /\bdeity|deities\b/i, /\bprophecy|prophecies\b/i, /\bwar(s)?\b/i,
    /\btimeline\b/i, /\bera\b/i, /\bdynasty\b/i, /\bculture\b/i, /\btradition(s)?\b/i,
    /\blanguage(s)?\b/i, /\bmagic (system|school)\b/i, /\bfaction(s)?\b/i,
    /\borganization\b/i, /\bgovernment type\b/i, /\bconcordat\b/i, /\bprotocol\b/i,
  ]],
];

// Words that talk *about* the document itself, not the subject — ignoring
// these keeps, say, a comparison note from inheriting a wrong type.
const STOP_SIGNALS = [
  /\bthis (note|page|entry|file)\b/i, /\bsee also\b/i, /\btable of contents\b/i,
];

function guessTypeFromContent(body, tags) {
  const text = String(body || '').slice(0, 4000);
  if (!text.trim() && !(tags && tags.length)) return null;

  const scores = [0, 0, 0, 0];
  for (const [ti, [, patterns]] of SIGNALS.entries()) {
    for (const re of patterns) {
      const m = re.exec(text);
      if (!m) continue;
      if (STOP_SIGNALS.some(s => s.test(m[0]))) continue;
      scores[ti] += 1;
    }
  }
  // Tags are strong: #character is nearly a declaration.
  if (tags && tags.length) {
    const t = tags.map(x => String(x).toLowerCase());
    const idx = ['character', 'location', 'item', 'lore'].map(k => t.indexOf(k));
    idx.forEach((pos, i) => { if (pos !== -1) scores[i] += 4; });
  }
  const best = Math.max(...scores);
  if (best < 2) return null; // not enough signal — stay untyped
  return SIGNALS[scores.indexOf(best)][0];
}

module.exports = { setTypeInRaw, getTypeFromRaw, guessTypeFromContent };
