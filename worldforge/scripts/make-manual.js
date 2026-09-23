'use strict';
// Renders MANUAL.md -> public/manual.html (self-contained, styled). Re-run
// after editing the manual:  node scripts/make-manual.js
const fs = require('fs');
const path = require('path');
const { renderMarkdown, esc } = require('../src/md');

const src = fs.readFileSync(path.join(__dirname, '..', 'MANUAL.md'), 'utf8');
// strip the H1 (the page template provides the title)
const body = renderMarkdown(src.replace(/^# .*?\n/, ''), () => false, null, { allowHtml: true });

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>WorldForge — Field Manual</title>
<style>
:root { --bg:#0d1117; --panel:#161b22; --border:#2d333b; --text:#dce3ea; --muted:#8b949e; --accent:#58a6ff; --wl:#79c0ff; }
* { box-sizing:border-box; } body { margin:0; font-family:'Segoe UI',system-ui,sans-serif; background:var(--bg); color:var(--text); }
header { padding:26px 34px 10px; border-bottom:1px solid var(--border); background:var(--panel); }
header h1 { font-size:22px; margin:0; color:var(--accent); } header .ver { color:var(--muted); font-size:12px; margin-top:4px; }
article { max-width:820px; margin:0 auto; padding:22px 34px 60px; line-height:1.7; font-size:14.5px; }
h2 { color:var(--wl); font-size:19px; margin:30px 0 8px; border-bottom:1px solid var(--border); padding-bottom:5px; }
h3 { font-size:15.5px; margin:18px 0 6px; }
table { border-collapse:collapse; width:100%; margin:12px 0; font-size:13.5px; }
th,td { border:1px solid var(--border); padding:7px 11px; text-align:left; vertical-align:top; }
th { background:var(--panel); color:var(--wl); }
code { font-family:Consolas,monospace; background:#21262d; padding:1px 6px; border-radius:5px; font-size:.92em; }
pre { background:#0a0d12; border:1px solid var(--border); border-radius:8px; padding:12px; overflow-x:auto; }
blockquote { border-left:3px solid var(--accent); margin:10px 0; padding:6px 14px; color:var(--muted); background:var(--panel); }
ol li, ul li { margin:4px 0; }
.swatch { display:inline-block; width:12px; height:12px; border-radius:50%; margin-right:4px; vertical-align:middle; border:1px solid #ffffff33; }
.cat { font-weight:700; }
.wl.missing { color:#f85149; opacity:.8; border-bottom:1px dashed #f8514966; }
</style></head><body>
<header><h1>◆ WorldForge — Field Manual</h1><div class="ver">Version 1.0 · updated with every new feature</div></header>
<article>${body}</article>
</body></html>`;

fs.writeFileSync(path.join(__dirname, '..', 'public', 'manual.html'), html);
console.log('manual.html written');
