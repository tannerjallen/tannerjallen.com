"use strict";
/* Ballroom Tracker: renders data.json (built by update.py). No dependencies. */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (v, d = 0) => `${(v * 100).toFixed(d)}%`;
const fmtDate = (iso, opts = { month: "short", day: "numeric" }) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-US", opts);
const ordinal = n => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

const PIN_SLOTS = ["var(--s1)", "var(--s2)", "var(--s3)"];
const state = {
  metric: "avg",
  sort: "avg",
  pins: {},          // name -> slot index (color follows the couple, not its rank)
  jw: 50,            // judges' weight in the combined score (%); the show's rule
  finalists: 4,
  recency: 40,
  sims: 10000,
  ytWeek: null,
};

let D, M, SIM;

fetch("data.json", { cache: "no-cache" })
  .then(r => r.json())
  .then(data => { D = data; derive(); restore(); bind(); renderAll(); })
  .catch(err => {
    $("main").innerHTML = `<div class="card" style="margin-top:32px">Couldn't load data.json (${esc(err.message)}).</div>`;
  });

/* ------------------------------------------------------------------ model */

function derive() {
  const cast = D.cast.map(c => ({
    ...c,
    couple: `${c.first} & ${c.pro.split(" ")[0]}`,
    initials: c.first[0] + (c.last[0] || ""),
    out: !!c.eliminated_week,
  }));
  const byName = Object.fromEntries(cast.map(c => [c.name, c]));
  const weeks = D.weeks.filter(w => Object.keys(w.scores).length);
  const lastWeek = weeks.length ? weeks[weeks.length - 1].week : 0;
  const hist = Object.fromEntries(cast.map(c => [c.name, []]));
  const weekStats = {};

  for (const w of weeks) {
    const names = Object.keys(w.scores);
    const judges = (w.judges || ["", "", ""]).length;
    const rows = names.map(n => {
      const s = w.scores[n];
      const max = s.max || judges * 10;
      return { name: n, total: s.total, max, avg: (s.total / max) * 10, dances: s.dances };
    });
    const sumTotal = rows.reduce((a, r) => a + r.total, 0);
    const sorted = [...rows].sort((a, b) => b.total - a.total);
    const top = sorted[0].total;
    weekStats[w.week] = {
      n: rows.length, top, low: sorted[sorted.length - 1].total,
      fieldAvg: rows.reduce((a, r) => a + r.avg, 0) / rows.length, max: rows[0].max,
    };
    for (const r of rows) {
      const rank = 1 + sorted.filter(o => o.total > r.total).length;
      hist[r.name].push({
        week: w.week, theme: w.theme, airdate: w.airdates[0], ...r, rank, n: rows.length,
        jShare: r.total / sumTotal, jRel: (r.total / sumTotal) * rows.length,
        best: r.total === top, elim: byName[r.name].eliminated_week === w.week,
      });
    }
  }

  for (const c of cast) {
    const h = hist[c.name];
    c.avg = h.length ? h.reduce((a, x) => a + x.avg, 0) / h.length : 0;
    c.last = h[h.length - 1];
    c.bestWeek = h.reduce((b, x) => (!b || x.avg > b.avg ? x : b), null);
    c.weeksDanced = h.length;
  }

  const lastAir = weeks.length ? weeks[weeks.length - 1].airdates.slice(-1)[0] : "";
  const future = D.episodes.filter(e => e.date > lastAir);
  const totalWeeks = lastWeek + future.length;
  const futureWeeks = future.map((e, i) => {
    const wk = lastWeek + 1 + i;
    const sec = D.weeks.find(w => w.week === wk);
    return { week: wk, date: e.date, theme: sec ? sec.theme : e.title, finale: i === future.length - 1 };
  });

  const avgs = cast.flatMap(c => hist[c.name].map(h => h.avg));
  M = {
    cast, byName, weeks, lastWeek, hist, weekStats, futureWeeks, totalWeeks,
    remaining: cast.filter(c => !c.out),
    avgMin: Math.min(...avgs), avgMax: Math.max(...avgs),
  };
}

function restore() {
  const saved = store.get("dwts-pins", null);
  if (saved && typeof saved === "object") {
    for (const [n, slot] of Object.entries(saved)) if (M.byName[n] && slot >= 0 && slot < 3) state.pins[n] = slot;
  }
  if (!saved) {
    [...M.remaining].sort((a, b) => b.avg - a.avg).slice(0, 3).forEach((c, i) => (state.pins[c.name] = i));
  }
  const jw = store.get("dwts-jw", null);
  if (D.votes && D.votes.fits[String(jw / 100)]) state.jw = jw;
  else if (D.votes) state.jw = Math.round(D.votes.default_jw * 100);
  $("#jw").value = state.jw;
}

/* ---------------------------------------------------------------- helpers */

function avatar(c, size = 28, extra = "") {
  const cls = `avatar ${c.out ? "gray" : ""} ${extra}`;
  if (c.photo) return `<img class="${cls}" style="--size:${size}px" src="${esc(c.photo)}" alt="" loading="lazy">`;
  return `<span class="${cls}" style="--size:${size}px" aria-hidden="true">${esc(c.initials)}</span>`;
}
const pinColor = name => (name in state.pins ? PIN_SLOTS[state.pins[name]] : null);

function togglePin(name) {
  if (name in state.pins) delete state.pins[name];
  else {
    const used = new Set(Object.values(state.pins));
    let slot = [0, 1, 2].find(s => !used.has(s));
    if (slot === undefined) {
      // Replace the oldest pin: the first one inserted.
      const oldest = Object.keys(state.pins)[0];
      slot = state.pins[oldest];
      delete state.pins[oldest];
    }
    state.pins[name] = slot;
  }
  store.set("dwts-pins", state.pins);
  renderChips(); renderScoreChart(); renderYouTube();
}

const tip = $("#tooltip");
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let left = x + 16, top = y + 14;
  if (left + r.width > innerWidth - 8) left = x - r.width - 16;
  if (top + r.height > innerHeight - 8) top = y - r.height - 14;
  tip.style.left = Math.max(8, left) + "px";
  tip.style.top = Math.max(8, top) + "px";
}
const hideTip = () => (tip.hidden = true);

function heatColor(t) {
  const css = getComputedStyle(document.documentElement);
  const hex = v => v.trim().replace("#", "").match(/../g).map(h => parseInt(h, 16));
  const a = hex(css.getPropertyValue("--heat-lo")), b = hex(css.getPropertyValue("--heat-hi"));
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  return { bg: `rgb(${c.join(",")})`, ink: lum > 0.55 ? "#15172a" : "#fbf8f1" };
}

function niceTicks(lo, hi, count = 5) {
  const step0 = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= step0);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

/* -------------------------------------------------------------- line chart */

let chartSeq = 0;
function lineChart(el, cfg) {
  const W = Math.max(300, el.clientWidth);
  const narrow = W < 560;
  const H = cfg.height || Math.round(Math.min(460, Math.max(280, W * 0.48)));
  const m = { t: 14, r: cfg.endLabels ? (narrow ? 84 : 150) : 14, b: 30, l: 38, ...(cfg.margin || {}) };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const [x0, x1] = cfg.x.domain, [y0, y1] = cfg.y.domain;
  const sx = v => m.l + (x1 === x0 ? iw / 2 : ((v - x0) / (x1 - x0)) * iw);
  const sy = v => (cfg.y.invert ? m.t + ((v - y0) / (y1 - y0)) * ih : m.t + ih - ((v - y0) / (y1 - y0)) * ih);
  const id = `c${++chartSeq}`;
  const fmtY = cfg.y.fmt || (v => v);

  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(cfg.label || "")}">
    <defs><clipPath id="${id}-clip" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath></defs>`;
  for (const t of cfg.y.ticks) {
    const y = sy(t);
    s += `<line class="gridline" x1="${m.l}" x2="${m.l + iw}" y1="${y}" y2="${y}"/>
      <text class="tick-label" x="${m.l - 8}" y="${y + 4}" text-anchor="end">${esc(fmtY(t))}</text>`;
  }
  for (const ev of cfg.events || []) {
    const x = sx(ev.x);
    s += `<line class="event" x1="${x}" x2="${x}" y1="${m.t}" y2="${m.t + ih}"/>`;
    if (ev.label) s += `<text class="event-label" x="${x}" y="${m.t + 10}" text-anchor="middle">${esc(ev.label)}</text>`;
  }
  s += `<line class="baseline" x1="${m.l}" x2="${m.l + iw}" y1="${m.t + ih}" y2="${m.t + ih}"/>`;
  for (const t of cfg.x.ticks) {
    s += `<text class="tick-label" x="${sx(t.v)}" y="${H - 8}" text-anchor="middle">${esc(t.label)}</text>`;
  }

  const series = [...cfg.series].sort((a, b) => !!a.color - !!b.color);
  s += `<g class="series-layer">`;
  for (const se of series) {
    if (!se.pts.length) continue;
    const d = se.pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join("");
    s += `<g class="series ${se.color ? "pinned" : ""}" data-id="${esc(se.id)}" ${se.color ? `style="--c:${se.color}"` : ""}>
      <path d="${d}"/>`;
    if (cfg.dots) for (const p of se.pts) s += `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="${se.color ? 4 : 2.5}"/>`;
    if (se.elimAt) {
      const p = se.pts[se.pts.length - 1], x = sx(p.x), y = sy(p.y);
      s += `<path class="elim-x" d="M${x - 4},${y - 4}L${x + 4},${y + 4}M${x + 4},${y - 4}L${x - 4},${y + 4}" transform="translate(0,-11)"/>`;
    }
    s += `</g>`;
  }
  s += `</g>`;

  // Direct labels for highlighted series, nudged apart so they never collide.
  if (cfg.endLabels) {
    const labs = series.filter(se => se.color && se.pts.length).map(se => {
      const p = se.pts[se.pts.length - 1];
      return { se, x: sx(p.x), y: sy(p.y), ly: sy(p.y) };
    }).sort((a, b) => a.ly - b.ly);
    const gap = narrow ? 18 : 30;
    for (let i = 1; i < labs.length; i++) labs[i].ly = Math.max(labs[i].ly, labs[i - 1].ly + gap);
    const over = labs.length ? labs[labs.length - 1].ly - (m.t + ih) : 0;
    if (over > 0) labs.forEach(l => (l.ly -= over));
    for (const l of labs) {
      const c = cfg.who(l.se.id);
      const ax = l.x + 12;
      s += `<g style="--c:${l.se.color}">`;
      if (!narrow) {
        s += c.photo
          ? `<image href="${esc(c.photo)}" x="${ax}" y="${l.ly - 12}" width="24" height="24" preserveAspectRatio="xMidYMin slice" clip-path="url(#${id}-clip)"/>`
          : `<circle cx="${ax + 12}" cy="${l.ly}" r="12" fill="var(--surface-2)"/><text x="${ax + 12}" y="${l.ly + 4}" text-anchor="middle" font-size="10" font-weight="600">${esc(c.initials)}</text>`;
        s += `<circle class="marker-ring" cx="${ax + 12}" cy="${l.ly}" r="13"/>`;
      }
      const tx = narrow ? ax - 2 : ax + 31;
      s += `<text class="end-label" x="${tx}" y="${l.ly + (narrow ? 4 : 0)}">${esc(narrow ? c.first : c.couple)}</text>`;
      if (!narrow && cfg.endValue) s += `<text class="end-label sub-label" x="${tx}" y="${l.ly + 14}">${esc(cfg.endValue(l.se))}</text>`;
      s += `</g>`;
    }
  }
  s += `<rect class="overlay" x="0" y="0" width="${W}" height="${H}" fill="transparent"/></svg>`;
  el.innerHTML = s;

  // Hover: nearest point (with a generous radius) wins; highlights its series.
  const pts = series.flatMap(se => se.pts.map(p => ({ se, p, px: sx(p.x), py: sy(p.y) })));
  const svg = el.querySelector("svg"), layer = el.querySelector(".series-layer");
  let hovered = null;
  const setHover = id => {
    if (id === hovered) return;
    hovered = id;
    el.classList.toggle("has-hover", !!id);
    for (const g of layer.children) {
      const on = g.dataset.id === id;
      g.classList.toggle("hover", on);
      if (on) layer.appendChild(g);
    }
  };
  const move = e => {
    const r = svg.getBoundingClientRect(), k = W / r.width;
    const mx = (e.clientX - r.left) * k, my = (e.clientY - r.top) * k;
    let best = null, bd = Infinity;
    for (const q of pts) {
      const d = Math.hypot((q.px - mx) * 1.4, q.py - my);
      if (d < bd) { bd = d; best = q; }
    }
    if (!best || bd > 60) { setHover(null); hideTip(); return; }
    setHover(best.se.id);
    showTip(cfg.tooltip(best.se, best.p), e.clientX, e.clientY);
  };
  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerdown", move);
  svg.addEventListener("pointerleave", () => { setHover(null); hideTip(); });
}

function ttHead(c, sub) {
  return `<div class="tt-head">${avatar(c, 34)}<div><div class="tt-name">${esc(c.name)}</div><div class="tt-sub">${esc(sub)}</div></div></div>`;
}

/* ------------------------------------------------------------------ render */

function renderAll() {
  runSim();
  renderStats();
  renderChips();
  renderScoreChart();
  renderGrid();
  renderCards();
  renderYouTube();
  renderSim();
  renderTested();
  renderFooter();
}

function renderStats() {
  const last = M.weeks[M.weeks.length - 1];
  const next = M.futureWeeks[0];
  const ws = M.weekStats[M.lastWeek];
  const tops = M.hist && last ? Object.keys(last.scores).filter(n => last.scores[n].total === ws.top).map(n => M.byName[n]) : [];
  const lastOut = [...M.cast].filter(c => c.out).sort((a, b) => b.eliminated_week - a.eliminated_week);
  const outWk = lastOut.length ? lastOut[0].eliminated_week : null;
  const outs = lastOut.filter(c => c.eliminated_week === outWk);
  const fav = SIM.rows[0];
  const tile = (k, v, d) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;
  $("#stats").innerHTML = [
    tile("Week", `${M.lastWeek} <small>of ${M.totalWeeks}</small>`,
      next ? `Next: ${esc(next.theme)} · ${fmtDate(next.date, { weekday: "short", month: "short", day: "numeric" })}` : "Season complete"),
    tile("Still dancing", `${M.remaining.length} <small>of ${M.cast.length}</small>`,
      outs.length ? `Last out: ${outs.map(c => esc(c.couple)).join(", ")} (wk ${outWk})` : "No eliminations yet"),
    tile(`Top score · week ${M.lastWeek}`,
      `<span class="avatars">${tops.map(c => avatar(c, 30)).join("")}</span>${ws.top}<small>/ ${ws.max}</small>`,
      tops.map(c => esc(c.couple)).join(", ")),
    tile("Model favorite", `${avatar(fav.c, 30)}${pct(fav.win)}`,
      `${esc(fav.c.couple)} · Monte Carlo`),
  ].join("");
}

function renderChips() {
  const order = [...M.cast].sort((a, b) => (a.out - b.out) || b.avg - a.avg);
  const html = order.map(c => {
    const col = pinColor(c.name);
    return `<button class="chip ${c.out ? "out" : ""}" data-name="${esc(c.name)}" aria-pressed="${!!col}" style="--pin:${col || "transparent"}">
      ${avatar(c, 22)}${esc(c.couple)}${col ? `<span class="dot"></span>` : ""}</button>`;
  }).join("");
  $("#pinChips").innerHTML = html;
  $("#pinChips2").innerHTML = html;
}

function metricOf(h) {
  return state.metric === "avg" ? h.avg : state.metric === "total" ? h.total : h.rank;
}

function renderScoreChart() {
  const el = $("#scoreChart");
  const metric = state.metric;
  const series = M.cast.map(c => ({
    id: c.name,
    color: pinColor(c.name),
    elimAt: c.eliminated_week,
    pts: M.hist[c.name].map(h => ({ x: h.week, y: metricOf(h), h })),
  }));
  const ys = series.flatMap(s => s.pts.map(p => p.y));
  let y;
  if (metric === "avg") {
    const lo = Math.max(0, Math.floor(Math.min(...ys)) - 0.5);
    y = { domain: [lo, 10], ticks: niceTicks(lo, 10, 5).filter(t => t >= lo), fmt: v => v.toFixed(0) };
  } else if (metric === "total") {
    const lo = Math.floor((Math.min(...ys) - 2) / 5) * 5, hi = Math.ceil((Math.max(...ys) + 1) / 5) * 5;
    y = { domain: [lo, hi], ticks: niceTicks(lo, hi, 5) };
  } else {
    y = { domain: [1, M.cast.length], ticks: [1, 4, 8, 12, 16].filter(t => t <= M.cast.length), invert: true, fmt: v => ordinal(v) };
  }
  $("#scoresSub").textContent = {
    avg: "Average mark per judge (out of 10), so 3- and 4-judge weeks compare fairly.",
    total: "Raw weekly totals. Weeks with a guest judge are out of 40 instead of 30.",
    rank: "Leaderboard position by judges' score each week (1st = top score).",
  }[metric];
  lineChart(el, {
    label: "Judges' scores by week",
    x: { domain: [1, Math.max(2, M.lastWeek)], ticks: M.weeks.map(w => ({ v: w.week, label: `Wk ${w.week}` })) },
    y, series, dots: true, endLabels: true,
    who: id => M.byName[id],
    endValue: se => {
      const h = se.pts[se.pts.length - 1].h;
      return metric === "rank" ? `${ordinal(h.rank)} · wk ${h.week}` : `${h.avg.toFixed(1)} avg · wk ${h.week}`;
    },
    tooltip: (se, p) => {
      const c = M.byName[se.id], h = p.h;
      const ds = h.dances.map(d => `<div class="tt-row"><span>${esc(d.dance)}</span><b>${d.score} <span class="tt-sub">(${d.marks.join(", ")})</span></b></div>`).join("");
      return ttHead(c, `with ${c.pro}`) +
        `<div class="tt-sub" style="margin-bottom:4px">Week ${h.week} · ${esc(h.theme)}</div>
         <div class="tt-row"><span>Score</span><b>${h.total} / ${h.max}</b></div>
         <div class="tt-row"><span>Avg per judge</span><b>${h.avg.toFixed(2)}</b></div>
         <div class="tt-row"><span>Rank</span><b>${ordinal(h.rank)} of ${h.n}</b></div>${ds}
         ${h.elim ? `<div class="tt-sub" style="margin-top:4px;color:var(--bad)">Eliminated this week</div>` : ""}`;
    },
  });
}

function renderGrid() {
  const rows = [...M.cast].sort((a, b) => (a.out - b.out) || (a.out ? b.eliminated_week - a.eliminated_week || b.avg - a.avg : b.avg - a.avg));
  const span = Math.max(0.5, M.avgMax - M.avgMin);
  let h = `<thead><tr><th class="name-col">Couple</th>${M.weeks.map(w => `<th title="${esc(w.theme)}">Wk ${w.week}</th>`).join("")}<th>Avg</th></tr></thead><tbody>`;
  for (const c of rows) {
    h += `<tr class="${c.out ? "out" : ""}"><td class="name" data-name="${esc(c.name)}"><div class="inner">${avatar(c, 26)}<div><div>${esc(c.couple)}</div></div></div></td>`;
    for (const w of M.weeks) {
      const x = M.hist[c.name].find(e => e.week === w.week);
      if (!x) { h += `<td class="cell empty">${c.out && w.week > c.eliminated_week ? "" : "·"}</td>`; continue; }
      const col = heatColor((x.avg - M.avgMin) / span);
      const title = `Week ${w.week} · ${w.theme}: ${x.total}/${x.max} · ${x.dances.map(d => d.dance).join(" + ")}`;
      h += `<td class="cell ${x.elim ? "elim" : ""}" style="background:${col.bg};color:${col.ink}" title="${esc(title)}">${x.avg.toFixed(1)}${x.best ? "<sup>†</sup>" : ""}${x.elim ? "<sup>✕</sup>" : ""}</td>`;
    }
    h += `<td class="avgcol">${c.avg.toFixed(2)}</td></tr>`;
  }
  $("#scoreGrid").innerHTML = h + "</tbody>";
}

function sparkline(c) {
  const h = M.hist[c.name];
  if (!h.length) return "";
  const W = 200, H = 34, lo = Math.floor(M.avgMin), hi = 10;
  const sx = wk => (M.lastWeek <= 1 ? W / 2 : ((wk - 1) / (M.lastWeek - 1)) * W);
  const sy = v => H - 3 - ((v - lo) / (hi - lo)) * (H - 6);
  const field = M.weeks.map(w => [sx(w.week), sy(M.weekStats[w.week].fieldAvg)]);
  const own = h.map(x => [sx(x.week), sy(x.avg)]);
  const d = a => a.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  const lastP = own[own.length - 1];
  return `<div class="spark" title="Avg per judge by week (gold) vs. field average (gray)"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <path class="field" d="${d(field)}"/><path d="${d(own)}"/><circle cx="${lastP[0]}" cy="${lastP[1]}" r="3.5"/></svg></div>`;
}

function renderCards() {
  const winOf = n => SIM.byName[n]?.win ?? 0;
  const voteOf = n => SIM.byName[n]?.vote?.p50 ?? 0;
  const key = { avg: c => c.avg, votes: c => voteOf(c.name), win: c => winOf(c.name) }[state.sort];
  const rows = [...M.cast].sort((a, b) => (a.out - b.out) || key(b) - key(a) || b.avg - a.avg);
  $("#cards").innerHTML = rows.map(c => {
    return `<button class="ccard ${c.out ? "out" : ""}" data-name="${esc(c.name)}" type="button">
      <div class="photo">${c.photo ? `<img src="${esc(c.photo)}" alt="${esc(c.name)}" loading="lazy">` : `<div class="initials">${esc(c.initials)}</div>`}
        <span class="badge ${c.out ? "" : "in"}">${c.out ? `Out · week ${c.eliminated_week}` : "Still dancing"}</span></div>
      <div class="body">
        <div><div class="nm">${esc(c.name)}</div><div class="pro">with ${esc(c.pro)}</div></div>
        <div class="note">${esc(c.notability)}</div>
        ${sparkline(c)}
        <div class="metrics">
          <div class="m"><div class="k">Avg</div><div class="v">${c.avg.toFixed(1)}</div></div>
          ${c.out ? `<div class="m"><div class="k">Best</div><div class="v">${c.bestWeek ? c.bestWeek.avg.toFixed(1) : "–"}</div></div>`
            : `<div class="m hide-sm"><div class="k">Fan vote</div><div class="v">${pct(voteOf(c.name), 1)}</div></div>
               <div class="m"><div class="k">Win</div><div class="v">${pct(winOf(c.name))}</div></div>`}
        </div>
      </div></button>`;
  }).join("");
}

const fmtViews = v => (v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}K` : String(v));

/** YouTube views per performance (official DWTS channel). */
function ytByWeek() {
  const out = {};
  for (const v of D.youtube?.videos || []) {
    const wk = (out[v.week] ||= {});
    (wk[v.celeb] ||= []).push(v);
  }
  return out;
}

function renderYouTube() {
  const sec = $("#youtube");
  const yt = D.youtube;
  if (!yt || !yt.videos?.length) { sec.hidden = true; $("#ytTab").hidden = true; return; }
  sec.hidden = false; $("#ytTab").hidden = false;
  const byWeek = ytByWeek();
  const weeks = Object.keys(byWeek).map(Number).sort((a, b) => a - b);
  $("#ytSub").textContent = `Views of each performance video on the official Dancing with the Stars channel · ${yt.matched} of ${yt.performances} performances matched · fetched ${fmtDate(yt.fetched.slice(0, 10))}.`;

  const series = M.cast.map(c => ({
    id: c.name, color: pinColor(c.name),
    pts: weeks.filter(w => byWeek[w][c.name]).map(w => {
      const vs = byWeek[w][c.name];
      return { x: w, y: vs.reduce((a, v) => a + v.views, 0) / vs.length, vs };
    }),
  })).filter(s => s.pts.length);
  const ys = series.flatMap(s => s.pts.map(p => p.y));
  const hi = Math.max(...ys);
  lineChart($("#ytChart"), {
    label: "YouTube views per performance by week",
    x: { domain: [weeks[0], Math.max(weeks[0] + 1, weeks[weeks.length - 1])], ticks: weeks.map(w => ({ v: w, label: `Wk ${w}` })) },
    y: { domain: [0, hi * 1.05], ticks: niceTicks(0, hi, 4), fmt: fmtViews },
    series, dots: true, endLabels: true,
    who: id => M.byName[id],
    endValue: se => `${fmtViews(se.pts[se.pts.length - 1].y)} · wk ${se.pts[se.pts.length - 1].x}`,
    tooltip: (se, p) => {
      const c = M.byName[se.id];
      return ttHead(c, `Week ${p.x}`) + p.vs.map(v => `<div class="tt-row"><span>${esc(v.dance || "Performance")}</span><b>${fmtViews(v.views)}</b></div>
        <div class="tt-row"><span>likes · comments</span><b>${fmtViews(v.likes)} · ${fmtViews(v.comments)}</b></div>`).join("");
    },
  });

  if (!state.ytWeek || !byWeek[state.ytWeek]) state.ytWeek = weeks[weeks.length - 1];
  $("#ytSeg").innerHTML = weeks.map(w => `<button role="radio" data-v="${w}" aria-checked="${w === +state.ytWeek}">Wk ${w}</button>`).join("");
  const wk = byWeek[state.ytWeek];
  const rows = Object.entries(wk).map(([n, vs]) => ({ c: M.byName[n], views: vs.reduce((a, v) => a + v.views, 0) }));
  const tot = rows.reduce((a, r) => a + r.views, 0) || 1;
  rows.sort((a, b) => b.views - a.views);
  const max = rows[0]?.views || 1;
  $("#ytBars").innerHTML = rows.map(r => {
    const elimHere = r.c.eliminated_week === +state.ytWeek;
    return `<div class="bar-row"><div class="who">${avatar(r.c, 24)}<span>${esc(r.c.couple)}${elimHere ? ` <span class="muted">✕ out</span>` : ""}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${(r.views / max) * 100}%"></div></div><div class="val" title="${r.views.toLocaleString()} views">${pct(r.views / tot, 1)}</div></div>`;
  }).join("");
}

/* -------------------------------------------------------------- simulator */

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Recency-weighted judges' strength per remaining couple, relative to the field (1 = average). */
function strengths() {
  const k = (state.recency / 100) * 1.6;
  const list = M.remaining.map(c => {
    let sw = 0, sj = 0;
    for (const x of M.hist[c.name]) {
      const wt = Math.exp(-k * (M.lastWeek - x.week));
      sw += wt; sj += wt * x.jRel;
    }
    return { c, J: sj / sw };
  });
  // Pooled week-to-week noise, so one wild week doesn't define a couple.
  let rj = 0, dof = 0;
  for (const s of list) for (const x of M.hist[s.c.name]) { rj += (x.jRel - s.J) ** 2; dof++; }
  return { list, sdJ: Math.max(0.04, Math.sqrt(rj / Math.max(1, dof - list.length))) };
}

function schedule() {
  const fw = M.futureWeeks;
  if (!fw.length) return [];
  const alive = M.remaining.length;
  const nonFinale = fw.length - 1;
  const fin = Math.min(state.finalists, alive);
  const E = Math.max(0, alive - fin);
  const per = Array(nonFinale).fill(nonFinale ? Math.floor(E / nonFinale) : 0);
  for (let i = 0; i < (nonFinale ? E % nonFinale : 0); i++) per[nonFinale - 1 - i]++; // doubles come late
  return fw.map((f, i) => ({ ...f, out: f.finale ? 0 : per[i] }));
}

/** The fan-vote fit for the chosen judges' weight (precomputed by pipeline/live.py). */
const voteFit = () => D.votes?.fits[String(state.jw / 100)];

function runSim() {
  const jw = state.jw / 100;
  const { list, sdJ } = strengths();
  const N = list.length;
  const sched = schedule();
  const rand = rng(35);
  const gauss = () => {
    let u = 0; while (u === 0) u = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  const gumbel = () => { let u = 0; while (u === 0) u = rand(); return -Math.log(-Math.log(u)); };
  const V = voteFit(), tau = D.votes?.tau ?? 0.02;
  const vIdx = list.map(s => (V ? D.votes.alive.indexOf(s.c.name) : -1));
  const haveV = !!V && vIdx.every(i => i >= 0) && D.votes.alive.length === N;

  // Simple: judges' strength and posterior-mean vote share, one weighted score
  // per couple turned into odds. Nothing is played out.
  const vMean = list.map((s, i) => (haveV ? Math.exp(V.mean[vIdx[i]]) : 1));
  const vS = vMean.reduce((a, b) => a + b, 0), Js = list.reduce((a, s) => a + s.J, 0);
  const comp = list.map((s, i) => N * (jw * (s.J / Js) + (1 - jw) * (vMean[i] / vS)));
  const ex = comp.map(v => Math.exp((v - 1) / 0.1));
  const exS = ex.reduce((a, b) => a + b, 0);

  // Monte Carlo: each simulated season draws every couple's fan strength from
  // the posterior and its judges' trajectory, then plays out the remaining
  // weeks. Combined score = jw * judges' share + (1 - jw) * vote share; the
  // lowest (plus noise) goes home, the highest wins the finale.
  const wins = new Float64Array(N), finals = new Float64Array(N), outNext = new Float64Array(N);
  const sims = sched.length && haveV ? state.sims : 0;
  const m = haveV ? D.votes.alive.length : 0, z = new Float64Array(m);
  const J = new Float64Array(N), th = new Float64Array(N), cj = new Float64Array(N), ev = new Float64Array(N), cv = new Float64Array(N), cc = new Float64Array(N);
  for (let s = 0; s < sims; s++) {
    for (let k = 0; k < m; k++) z[k] = gauss();
    for (let i = 0; i < N; i++) {
      const a = vIdx[i], row = V.chol[a];
      let t = V.mean[a];
      for (let k = 0; k <= a; k++) t += row[k] * z[k];
      th[i] = t;
      J[i] = list[i].J + gauss() * sdJ * 0.75;
    }
    let alive = [...Array(N).keys()];
    for (let wi = 0; wi < sched.length; wi++) {
      const na = alive.length;
      let sj = 0, sv = 0, mx = -Infinity;
      for (const i of alive) { cj[i] = Math.max(0.05, J[i] + gauss() * sdJ); sj += cj[i]; mx = Math.max(mx, th[i]); }
      for (const i of alive) { ev[i] = Math.exp(th[i] - mx); sv += ev[i]; }
      for (const i of alive) cv[i] = na * (jw * (cj[i] / sj) + (1 - jw) * (ev[i] / sv));
      if (sched[wi].finale) {
        let best = alive[0], bv = -Infinity;
        for (const i of alive) { finals[i]++; const x = cv[i] + tau * gumbel(); if (x > bv) { bv = x; best = i; } }
        wins[best]++;
      } else if (sched[wi].out) {
        for (const i of alive) cc[i] = cv[i] - tau * gumbel();
        alive.sort((a, b) => cc[a] - cc[b]);
        const gone = alive.splice(0, sched[wi].out);
        if (wi === 0) for (const i of gone) outNext[i]++;
      }
    }
  }
  // Hedge toward even odds, as backtested (past models were overconfident).
  const h = D.votes?.hedge ?? 0, hedge = p => (1 - h) * p + h / N;
  const rows = list.map((s, i) => ({
    c: s.c, J: s.J,
    win: sims ? hedge(wins[i] / sims) : 0, simple: ex[i] / exS,
    finale: sims ? finals[i] / sims : 0, outNext: sims ? outNext[i] / sims : 0,
    vote: haveV ? V.share[s.c.name] : null,
  })).sort((a, b) => b.win - a.win || b.simple - a.simple);
  SIM = { rows, byName: Object.fromEntries(rows.map(r => [r.c.name, r])), sched, sdJ, haveV };
}

function renderSim() {
  $("#wJudges").textContent = `${state.jw}%`;
  $("#wVotes").textContent = `${100 - state.jw}%`;
  const sched = SIM.sched;
  $("#schedule").textContent = sched.length
    ? "Assumed schedule: " + sched.map(s => s.finale ? `Finale ${fmtDate(s.date)} (${Math.min(state.finalists, M.remaining.length)} couples)` : `Wk ${s.week} ${fmtDate(s.date)}: ${s.out} out`).join(" · ")
    : "The season is over.";
  $("#simNote").textContent = `${state.sims.toLocaleString()} simulated seasons`;
  const maxWin = Math.max(...SIM.rows.map(r => r.win), 0.01);
  const num = v => (v == null ? "–" : pct(v, v < 0.1 ? 1 : 0));
  $("#simTable").innerHTML =
    `<div class="sim-head"><span></span><span>Couple</span><span>Win · Monte Carlo</span><span class="sub-col" title="One weighted score per couple, no simulation">Simple</span><span class="fin">Finale</span></div>` +
    SIM.rows.map((r, i) => `<div class="sim-row ${i === 0 ? "leader" : ""}">
      <span class="rk">${i + 1}</span>
      <span class="who" data-name="${esc(r.c.name)}">${avatar(r.c, 30)}<span>${esc(r.c.couple)}${i === 0 ? ` <span class="crown" aria-label="favorite">♛</span>` : ""}</span></span>
      <span class="cellbar"><span class="bar-track"><span class="bar-fill" style="display:block;width:${(r.win / maxWin) * 100}%"></span></span><b>${pct(r.win, r.win < 0.1 ? 1 : 0)}</b></span>
      <span class="sub-col">${num(r.simple)}</span>
      <span class="fin">${pct(r.finale)}</span></div>`).join("");

  renderVotes();
  const next = sched[0];
  const danger = [...SIM.rows].sort((a, b) => b.outNext - a.outNext).slice(0, 4);
  $("#danger").innerHTML = next && next.out
    ? `<p class="sub tight">Week ${next.week} · ${esc(next.theme)} · ${fmtDate(next.date, { weekday: "short", month: "short", day: "numeric" })}</p>` +
      danger.map(r => `<div class="danger-row">${avatar(r.c, 30)}<span class="nm">${esc(r.c.couple)}</span><b>${pct(r.outNext)}</b></div>`).join("")
    : `<p class="sub tight">${next ? "No elimination expected next week." : "Season complete."}</p>`;
}

function renderVotes() {
  const el = $("#votesCard");
  if (!SIM.haveV) { el.hidden = true; return; }
  el.hidden = false;
  const rows = [...SIM.rows].sort((a, b) => b.vote.p50 - a.vote.p50);
  // Dot-and-range plot, so the axis needn't start at zero: zoom to the spread.
  const even = 1 / rows.length;
  const lo0 = Math.min(even, ...rows.map(r => r.vote.p10)) * 0.9, hi0 = Math.max(even, ...rows.map(r => r.vote.p90)) * 1.05;
  const pos = x => ((x - lo0) / (hi0 - lo0)) * 100;
  $("#votesBars").innerHTML = rows.map(r => {
    const v = r.vote;
    return `<div class="vote-row"><span class="who">${avatar(r.c, 24)}<span>${esc(r.c.couple)}</span></span>
      <span class="range" title="80% range ${pct(v.p10, 1)}–${pct(v.p90, 1)}">
        <i class="even" style="left:${pos(even)}%"></i>
        <i class="span" style="left:${pos(v.p10)}%;width:${pos(v.p90) - pos(v.p10)}%"></i>
        <i class="mid" style="left:${pos(v.p50)}%"></i></span>
      <b>${pct(v.p50, 1)}</b></div>`;
  }).join("");
  const rounds = D.votes.rounds.length;
  $("#votesTitle").textContent = `Inferred fan vote · at ${state.jw}% judges`;
  $("#votesNote").textContent = `Estimated from ${rounds} elimination${rounds === 1 ? "" : "s"}: a couple that survives low judges' scores must be getting votes. Bars show the 80% range; the tick marks an even split. Front-runners who have never been near the bottom stay close to even, because their votes haven't been tested yet.`;
}

/** How this model did on completed seasons (precomputed by pipeline/backtest.py). */
function renderTested() {
  const bt = D.backtest, el = $("#tested");
  if (!bt) { el.hidden = true; return; }
  const c = bt.model;
  const tile = (k, v, d) => `<div class="m"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;
  const W = 220, H = 46, hi = 0.6;
  const spark = path => {
    const sx = i => (path.length < 2 ? W / 2 : (i / (path.length - 1)) * W);
    const sy = p => H - 4 - (Math.min(p, hi) / hi) * (H - 8);
    const d = a => a.map((p, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(p).toFixed(1)}`).join("");
    const last = path[path.length - 1];
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <path class="field" d="${d(path.map(x => 1 / x.n))}"/><path d="${d(path.map(x => x.p))}"/>
      <circle cx="${sx(path.length - 1)}" cy="${sy(last.p)}" r="3.5"/></svg>`;
  };
  el.innerHTML = `
    <div class="card-head"><h3>Tested on seasons ${bt.seasons[0].season}–${bt.seasons[bt.seasons.length - 1].season}</h3>
      <span class="muted small-text">${bt.points} predictions, each using only what had aired so far</span></div>
    <div class="tested-tiles">
      ${tile("Favorite won", pct(bt.favorite_won), "share of weeks the model's #1 went on to win")}
      ${tile("Winner in top 2", pct(bt.winner_top2), "the eventual champion was its #1 or #2")}
      ${tile("Odds on the winner", pct(bt.p_winner), `average chance it gave the champion · even odds ≈ ${pct(bt.p_even)}`)}
    </div>
    <div class="tested-seasons">
      ${bt.seasons.map(se => {
        const last = se.path[se.path.length - 1];
        return `<div class="ts"><div class="ts-head"><b>S${se.season}</b> ${esc(se.winner)} <span class="muted">& ${esc(se.pro.split(" ")[0])}</span></div>
          <div class="spark">${spark(se.path)}</div>
          <div class="ts-foot">Before the finale: <b>${pct(last.p)}</b> · ranked #${last.rank} of ${last.n}</div></div>`;
      }).join("")}
    </div>
    <p class="foot">Gold line: the chance the model gave each season's eventual winner, week by week; gray: even odds.
      Model: today's defaults (fan votes inferred from eliminations, ${Math.round(c.jw * 100)}% judges, ${Math.round(c.hedge * 100)}% hedge toward even odds).
      Tuned on four seasons and scored on the fifth, it beat even odds (log-loss ${bt.heldout_logloss} vs ${bt.uniform_logloss}, lower is better).
      <b>Caveat:</b> five seasons is a small sample, and upset winners like Iman Shumpert (S30) still catch it out.</p>`;
}

function renderFooter() {
  const dt = new Date(D.updated);
  $("#sources").innerHTML = `Scores and results from <a href="${esc(D.source)}">Wikipedia</a>.${D.youtube ? " Performance views from the official Dancing with the Stars YouTube channel." : ""} Photos via Wikimedia Commons. Updated ${dt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.`;
}

/* ------------------------------------------------------------------ dialog */

function openCouple(name) {
  const c = M.byName[name];
  const h = M.hist[name];
  const sim = SIM.byName[name];
  const yt = ytByWeek();
  const sub = c.substitute_pro ? ` · ${esc(c.substitute_pro.name)} filled in for week ${c.substitute_pro.week}` : "";
  $("#dialogBody").innerHTML = `
    <button class="d-close" type="button" aria-label="Close">×</button>
    <div class="d-hero">
      <div class="d-photo">${c.photo ? `<img src="${esc(c.photo)}" alt="${esc(c.name)}">` : `<div class="initials">${esc(c.initials)}</div>`}</div>
      <div>
        <p class="eyebrow">${c.out ? `Eliminated · week ${c.eliminated_week}` : "Still dancing"}</p>
        <h2 class="d-name">${esc(c.name)}</h2>
        <p class="d-meta">with ${esc(c.pro)}${sub}<br><span class="muted">${esc(c.notability)}</span></p>
        <div class="d-stats">
          <div class="m"><div class="k">Avg per judge</div><div class="v">${c.avg.toFixed(2)}</div></div>
          ${c.bestWeek ? `<div class="m"><div class="k">Best</div><div class="v">${c.bestWeek.total}/${c.bestWeek.max} · wk ${c.bestWeek.week}</div></div>` : ""}
          ${sim ? `<div class="m"><div class="k">Win · MC</div><div class="v">${pct(sim.win, 1)}</div></div><div class="m"><div class="k">Finale</div><div class="v">${pct(sim.finale)}</div></div>` : ""}
          ${sim?.vote ? `<div class="m"><div class="k">Fan vote</div><div class="v">${pct(sim.vote.p50, 1)}</div></div>` : ""}
        </div>
      </div>
    </div>
    <div class="d-section">
      <h3>Every dance</h3>
      <div class="table-scroll"><table class="dances"><thead><tr><th>Week</th><th>Dance</th><th>Judges</th><th class="num">Score</th><th class="num">Rank</th>${D.youtube ? `<th class="num">Views</th>` : ""}</tr></thead><tbody>
      ${h.map(x => x.dances.map((d, i) => `<tr>
        <td>${i ? "" : `Wk ${x.week}<div class="theme">${esc(x.theme)}</div>`}</td>
        <td>${esc(d.dance)}</td><td>${d.marks.join(" · ")}</td>
        <td class="num"><b>${d.score}</b>${x.dances.length > 1 && i === x.dances.length - 1 ? `<div class="theme">week ${x.total}/${x.max}</div>` : ` <span class="theme">/ ${d.marks.length * 10}</span>`}</td>
        <td class="num">${i ? "" : `${ordinal(x.rank)}<span class="theme"> /${x.n}</span>`}</td>
        ${D.youtube ? `<td class="num">${(() => { const v = (yt[x.week]?.[name] || [])[i]; return v ? `<a href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener">${fmtViews(v.views)}</a>` : "–"; })()}</td>` : ""}</tr>`).join("")).join("")}
      </tbody></table></div>
    </div>
    ${c.photo_credit ? `<p class="credit">Photo: <a href="${esc(c.photo_credit)}">Wikimedia Commons</a></p>` : ""}`;
  const dlg = $("#coupleDialog");
  dlg.showModal();
  $(".d-close", dlg).onclick = () => dlg.close();
}

/* ------------------------------------------------------------------ events */

function segBind(id, key, after) {
  $(id).addEventListener("click", e => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    state[key] = b.dataset.v;
    $$(`${id} button`).forEach(x => x.setAttribute("aria-checked", x === b));
    after();
  });
}

function bind() {
  segBind("#metricSeg", "metric", renderScoreChart);
  segBind("#sortSeg", "sort", renderCards);
  segBind("#ytSeg", "ytWeek", renderYouTube);

  for (const id of ["#pinChips", "#pinChips2"]) {
    $(id).addEventListener("click", e => {
      const b = e.target.closest(".chip");
      if (b) togglePin(b.dataset.name);
    });
  }
  document.addEventListener("click", e => {
    const t = e.target.closest(".ccard, td.name, .sim-row .who");
    if (t) openCouple(t.dataset.name);
  });
  $("#coupleDialog").addEventListener("click", e => { if (e.target.id === "coupleDialog") e.target.close(); });

  let raf = 0;
  const resim = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { runSim(); renderSim(); renderStats(); renderCards(); });
  };
  $("#jw").addEventListener("input", e => { state.jw = +e.target.value; store.set("dwts-jw", state.jw); resim(); });
  $("#recency").addEventListener("input", e => { state.recency = +e.target.value; resim(); });
  $("#finalists").addEventListener("change", e => { state.finalists = +e.target.value; resim(); });
  $("#sims").addEventListener("change", e => { state.sims = +e.target.value; resim(); });

  $("#themeToggle").addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch { /* ignore */ }
    renderGrid();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderGrid);

  // Re-draw charts at their new width.
  let lastW = innerWidth, rt = 0;
  addEventListener("resize", () => {
    if (innerWidth === lastW) return;
    lastW = innerWidth;
    clearTimeout(rt);
    rt = setTimeout(() => { renderScoreChart(); renderYouTube(); }, 120);
  });

  // Scroll-spy for the section tabs.
  const links = $$(".tabs a");
  const io = new IntersectionObserver(entries => {
    for (const en of entries) if (en.isIntersecting) {
      links.forEach(a => a.classList.toggle("active", a.getAttribute("href") === `#${en.target.id}`));
    }
  }, { rootMargin: "-45% 0px -50% 0px" });
  $$("main .section").forEach(s => io.observe(s));
}
