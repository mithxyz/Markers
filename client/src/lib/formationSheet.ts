import type { Dancer, StageConfig } from '$lib/types';
import type { ResolvedPlacement } from '$lib/formations';
import { formatTime } from '$lib/utils/timecode';

/**
 * Build + open a printable formation sheet (Phase 3c / 8b) — one stage diagram per
 * placement (resolved with its definition's positions), rendered as self-contained
 * inline SVG in a new window, then print().
 * Self-contained (no app CSS) so the print is robust across browsers.
 */
export function printFormationSheet(opts: {
  projectName: string;
  trackName: string;
  placements: ResolvedPlacement[];
  dancers: Dancer[];
  stage: StageConfig;
}) {
  const { projectName, trackName, placements, dancers, stage } = opts;
  const byId = new Map(dancers.map((d) => [d.id, d]));
  const token = (d: Dancer) => d.label || d.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const esc = (s: string) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));

  const W = 360;
  const H = Math.round(W * (stage?.depth > 0 && stage?.width > 0 ? stage.depth / stage.width : 0.62));

  const svg = (p: ResolvedPlacement) => {
    const tokens = (p.positions || [])
      .map((pos) => {
        const d = byId.get(pos.dancer_id);
        if (!d) return '';
        return `<g transform="translate(${(pos.x * W).toFixed(1)},${(pos.y * H).toFixed(1)})">
          <circle r="13" fill="${d.color}" stroke="#fff" stroke-width="1.5"/>
          <text y="4" text-anchor="middle" font-size="11" font-weight="700" fill="#111">${esc(token(d))}</text></g>`;
      })
      .join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      <rect x="0" y="0" width="${W}" height="${H}" fill="#fafafa" stroke="#999"/>
      <line x1="${W / 2}" y1="0" x2="${W / 2}" y2="${H}" stroke="#e5e5e5"/>
      <line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#e5e5e5"/>
      <text x="${W / 2}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#aaa">DOWNSTAGE</text>
      ${tokens}</svg>`;
  };

  const cards = [...placements]
    .sort((a, b) => a.time - b.time)
    .map(
      (p, i) => `<figure class="card">
        <figcaption>${i + 1}. ${esc(p.name)} <span>${formatTime(p.time)}${p.beat != null ? ` · beat ${Math.round(p.beat)}` : ''}</span></figcaption>
        ${svg(p)}</figure>`
    )
    .join('');

  const roster = dancers
    .map((d) => `<span class="d"><i style="background:${d.color}"></i>${esc(token(d))} — ${esc(d.name)}</span>`)
    .join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(trackName)} — formations</title>
    <style>
      body{font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:24px}
      h1{font-size:18px;margin:0 0 2px} h2{font-size:13px;font-weight:400;color:#666;margin:0 0 12px}
      .roster{margin:0 0 16px;display:flex;flex-wrap:wrap;gap:10px}
      .d{display:inline-flex;align-items:center;gap:5px;font-size:12px}
      .d i{width:12px;height:12px;border-radius:50%;display:inline-block}
      .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
      .card{margin:0;border:1px solid #ddd;border-radius:6px;padding:8px;break-inside:avoid}
      figcaption{font-weight:600;margin-bottom:6px;display:flex;justify-content:space-between}
      figcaption span{font-weight:400;color:#888}
      @media print{ body{margin:0} @page{margin:14mm} }
    </style></head><body>
    <h1>${esc(projectName)} — ${esc(trackName)}</h1>
    <h2>${placements.length} formation${placements.length === 1 ? '' : 's'}</h2>
    <div class="roster">${roster}</div>
    <div class="grid">${cards}</div>
    <script>window.onload=function(){setTimeout(function(){window.print()},200)}<\/script>
    </body></html>`;

  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  return true;
}
