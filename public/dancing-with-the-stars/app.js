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
  weight: 50,
  finalists: 4,
  recency: 40,
  damp: 0.5,        // vote share ∝ search share ^ damp
  sims: 10000,
  shareWeek: null,
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
    const buzz = D.trends.weekly[w.week] || {};
    const top = sorted[0].total;
    weekStats[w.week] = {
      n: rows.length, top, low: sorted[sorted.length - 1].total,
      fieldAvg: rows.reduce((a, r) => a + r.avg, 0) / rows.length, max: rows[0].max,
    };
    for (const r of rows) {
      const rank = 1 + sorted.filter(o => o.total > r.total).length;
      const b = buzz[r.name];
      hist[r.name].push({
        week: w.week, theme: w.theme, airdate: w.airdates[0], ...r, rank, n: rows.length,
        jShare: r.total / sumTotal, jRel: (r.total / sumTotal) * rows.length,
        bShare: b ? b.share : null, bRel: b ? b.share * rows.length : null,
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
  state.weight = store.get("dwts-weight", 50);
  $("#weight").value = state.weight;
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
  renderChips(); renderScoreChart(); renderBuzzChart();
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
  renderBuzzChart();
  renderShareSeg();
  renderShare();
  renderSim();
  renderBacktest();
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
      `${esc(fav.c.couple)} · at ${state.weight}% judges`),
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

function latestBuzz(c) {
  const h = [...M.hist[c.name]].reverse().find(x => x.bShare != null);
  return h ? h.bShare : null;
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
  const key = { avg: c => c.avg, buzz: c => latestBuzz(c) ?? 0, win: c => winOf(c.name) }[state.sort];
  const rows = [...M.cast].sort((a, b) => (a.out - b.out) || key(b) - key(a) || b.avg - a.avg);
  $("#cards").innerHTML = rows.map(c => {
    const buzz = latestBuzz(c);
    return `<button class="ccard ${c.out ? "out" : ""}" data-name="${esc(c.name)}" type="button">
      <div class="photo">${c.photo ? `<img src="${esc(c.photo)}" alt="${esc(c.name)}" loading="lazy">` : `<div class="initials">${esc(c.initials)}</div>`}
        <span class="badge ${c.out ? "" : "in"}">${c.out ? `Out · week ${c.eliminated_week}` : "Still dancing"}</span></div>
      <div class="body">
        <div><div class="nm">${esc(c.name)}</div><div class="pro">with ${esc(c.pro)}</div></div>
        <div class="note">${esc(c.notability)}</div>
        ${sparkline(c)}
        <div class="metrics">
          <div class="m"><div class="k">Avg</div><div class="v">${c.avg.toFixed(1)}</div></div>
          <div class="m ${c.out ? "" : "hide-sm"}"><div class="k">Buzz</div><div class="v">${buzz == null ? "–" : pct(buzz)}</div></div>
          ${c.out ? "" : `<div class="m"><div class="k">Win</div><div class="v">${pct(winOf(c.name))}</div></div>`}
        </div>
      </div></button>`;
  }).join("");
}

function renderBuzzChart() {
  const el = $("#buzzChart");
  const { dates, series } = D.trends.daily;
  if (!dates.length) { el.innerHTML = `<p class="muted">No search data yet.</p>`; return; }
  const idx = Object.fromEntries(dates.map((d, i) => [d, i]));
  const ser = M.cast.filter(c => series[c.name]).map(c => ({
    id: c.name, color: pinColor(c.name),
    pts: series[c.name].map((v, i) => ({ x: i, y: v, date: dates[i] })),
  }));
  const hi = Math.max(...ser.flatMap(s => s.pts.map(p => p.y)));
  const step = Math.max(1, Math.round(dates.length / (el.clientWidth < 560 ? 4 : 8)));
  const ticks = dates.map((d, i) => ({ v: i, label: fmtDate(d) })).filter((_, i) => i % step === 0);
  const events = M.weeks.flatMap(w => w.airdates.slice(0, 1).filter(d => d in idx).map(d => ({ x: idx[d], label: `W${w.week}` })));
  for (const f of M.futureWeeks) if (f.date in idx) events.push({ x: idx[f.date], label: `W${f.week}` });
  $("#buzzSub").textContent = `Daily Google search interest (${D.trends.geo}). Fetched ${fmtDate(D.trends.fetched.slice(0, 10))}.`;
  lineChart(el, {
    label: "Daily Google search interest",
    x: { domain: [0, dates.length - 1], ticks },
    y: { domain: [0, hi * 1.05], ticks: niceTicks(0, hi, 4) },
    series: ser, events, endLabels: true,
    who: id => M.byName[id],
    endValue: se => `${se.pts[se.pts.length - 1].y.toFixed(0)} today`,
    tooltip: (se, p) => {
      const c = M.byName[se.id];
      return ttHead(c, fmtDate(p.date, { weekday: "short", month: "short", day: "numeric" })) +
        `<div class="tt-row"><span>Search interest</span><b>${p.y.toFixed(1)}</b></div>`;
    },
  });
}

function shareWindows() {
  const wins = M.weeks.filter(w => D.trends.weekly[w.week]).map(w => ({
    key: String(w.week), label: `Wk ${w.week}`, title: `Week ${w.week} voting window (${w.airdates.map(d => fmtDate(d)).join(" & ")} + ${D.trends.window_days_after}d)`,
    rows: Object.entries(D.trends.weekly[w.week]).map(([n, v]) => ({ name: n, share: v.share })),
  }));
  if (Object.keys(D.trends.last7 || {}).length) {
    wins.push({ key: "last7", label: "Last 7 days", title: "Last 7 days, remaining couples",
      rows: Object.entries(D.trends.last7).map(([n, s]) => ({ name: n, share: s })) });
  }
  return wins;
}

function renderShareSeg() {
  const wins = shareWindows();
  if (!state.shareWeek || !wins.find(w => w.key === state.shareWeek)) state.shareWeek = wins.length ? wins[wins.length - 1].key : null;
  $("#shareSeg").innerHTML = wins.map(w => `<button role="radio" data-v="${w.key}" aria-checked="${w.key === state.shareWeek}">${w.label}</button>`).join("");
}

function renderShare() {
  const w = shareWindows().find(x => x.key === state.shareWeek);
  if (!w) { $("#shareBars").innerHTML = ""; return; }
  $("#shareTitle").textContent = `Share of search · ${w.title}`;
  const rows = [...w.rows].sort((a, b) => b.share - a.share);
  const max = rows[0]?.share || 1;
  $("#shareBars").innerHTML = rows.map(r => {
    const c = M.byName[r.name];
    const elimHere = c.eliminated_week && String(c.eliminated_week) === w.key;
    return `<div class="bar-row"><div class="who">${avatar(c, 24)}<span>${esc(c.couple)}${elimHere ? ` <span class="muted">✕ out</span>` : ""}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${(r.share / max) * 100}%"></div></div><div class="val">${pct(r.share, 1)}</div></div>`;
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

/** Recency-weighted strength per remaining couple, relative to the field (1 = average). */
function strengths() {
  const k = (state.recency / 100) * 1.6;
  const list = M.remaining.map(c => {
    const h = M.hist[c.name];
    let sw = 0, sj = 0, sb = 0, swb = 0;
    for (const x of h) {
      const wt = Math.exp(-k * (M.lastWeek - x.week));
      sw += wt; sj += wt * x.jRel;
      if (x.bRel > 0) { swb += wt; sb += wt * state.damp * Math.log(x.bRel); }
    }
    return { c, J: sj / sw, LT: swb ? sb / swb : Math.log(0.5), n: h.length };
  });
  // Pooled week-to-week noise, so one wild week doesn't define a couple.
  let rj = 0, rb = 0, dof = 0, dofb = 0;
  for (const s of list) for (const x of M.hist[s.c.name]) {
    rj += (x.jRel - s.J) ** 2; dof++;
    if (x.bRel > 0) { rb += (state.damp * Math.log(x.bRel) - s.LT) ** 2; dofb++; }
  }
  const sdJ = Math.max(0.04, Math.sqrt(rj / Math.max(1, dof - list.length)));
  const sdB = Math.max(0.1, Math.sqrt(rb / Math.max(1, dofb - list.length)));
  return { list, sdJ, sdB };
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

function runSim() {
  const w = state.weight / 100;
  const { list, sdJ, sdB } = strengths();
  const N = list.length;
  const sched = schedule();
  const rand = rng(35);
  const gauss = () => {
    let u = 0; while (u === 0) u = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };

  // Simple: one weighted strength per couple, softmax into odds.
  const Js = list.reduce((a, s) => a + s.J, 0), Ts = list.reduce((a, s) => a + Math.exp(s.LT), 0);
  const comp = list.map(s => N * (w * (s.J / Js) + (1 - w) * (Math.exp(s.LT) / Ts)));
  const ex = comp.map(v => Math.exp((v - 1) / 0.25));
  const exS = ex.reduce((a, b) => a + b, 0);

  // Monte Carlo: play out each remaining week; lowest combined share goes home.
  const wins = new Float64Array(N), finals = new Float64Array(N), outNext = new Float64Array(N);
  const sims = sched.length ? state.sims : 0;
  const J = new Float64Array(N), L = new Float64Array(N), cj = new Float64Array(N), cb = new Float64Array(N), cc = new Float64Array(N);
  for (let s = 0; s < sims; s++) {
    for (let i = 0; i < N; i++) {
      // Season-level uncertainty per couple: judges' trajectories diverge, and
      // how search interest converts to real votes is itself unknown.
      J[i] = list[i].J + gauss() * sdJ * 0.75;
      L[i] = list[i].LT + gauss() * (sdB / Math.sqrt(list[i].n) + 0.35);
    }
    let alive = [...Array(N).keys()];
    for (let wi = 0; wi < sched.length; wi++) {
      let sj = 0, sb = 0;
      for (const i of alive) {
        cj[i] = Math.max(0.05, J[i] + gauss() * sdJ); sj += cj[i];
        cb[i] = Math.exp(L[i] + gauss() * sdB); sb += cb[i];
      }
      for (const i of alive) cc[i] = w * (cj[i] / sj) + (1 - w) * (cb[i] / sb);
      if (sched[wi].finale) {
        let best = alive[0];
        for (const i of alive) { finals[i]++; if (cc[i] > cc[best]) best = i; }
        wins[best]++;
      } else if (sched[wi].out) {
        alive.sort((a, b) => cc[a] - cc[b]);
        const gone = alive.splice(0, sched[wi].out);
        if (wi === 0) for (const i of gone) outNext[i]++;
      }
    }
  }
  const rows = list.map((s, i) => ({
    c: s.c, J: s.J, T: Math.exp(s.LT), comp: comp[i],
    win: sims ? wins[i] / sims : 0, simple: ex[i] / exS,
    finale: sims ? finals[i] / sims : 0, outNext: sims ? outNext[i] / sims : 0,
  })).sort((a, b) => b.win - a.win || b.simple - a.simple);
  SIM = { rows, byName: Object.fromEntries(rows.map(r => [r.c.name, r])), sched, sdJ, sdB };
}

function renderSim() {
  $("#wJudges").textContent = `${state.weight}%`;
  $("#wBuzz").textContent = `${100 - state.weight}%`;
  const sched = SIM.sched;
  $("#schedule").textContent = sched.length
    ? "Assumed schedule: " + sched.map(s => s.finale ? `Finale ${fmtDate(s.date)} (${Math.min(state.finalists, M.remaining.length)} couples)` : `Wk ${s.week} ${fmtDate(s.date)}: ${s.out} out`).join(" · ")
    : "The season is over.";
  $("#simNote").textContent = `${state.sims.toLocaleString()} simulated seasons`;
  const maxWin = Math.max(...SIM.rows.map(r => r.win), 0.01), maxSimple = Math.max(...SIM.rows.map(r => r.simple), 0.01);
  $("#simTable").innerHTML =
    `<div class="sim-head"><span></span><span>Couple</span><span>Win · Monte Carlo</span><span>Win · Simple</span><span class="fin">Finale</span></div>` +
    SIM.rows.map((r, i) => `<div class="sim-row ${i === 0 ? "leader" : ""}">
      <span class="rk">${i + 1}</span>
      <span class="who" data-name="${esc(r.c.name)}">${avatar(r.c, 30)}<span>${esc(r.c.couple)}${i === 0 ? ` <span class="crown" aria-label="favorite">♛</span>` : ""}</span></span>
      <span class="cellbar"><span class="bar-track"><span class="bar-fill" style="display:block;width:${(r.win / maxWin) * 100}%"></span></span><b>${pct(r.win, r.win < 0.1 ? 1 : 0)}</b></span>
      <span class="cellbar"><span class="bar-track"><span class="bar-fill alt" style="display:block;width:${(r.simple / maxSimple) * 100}%"></span></span><b>${pct(r.simple, r.simple < 0.1 ? 1 : 0)}</b></span>
      <span class="fin">${pct(r.finale)}</span></div>`).join("");

  const next = sched[0];
  const danger = [...SIM.rows].sort((a, b) => b.outNext - a.outNext).slice(0, 4);
  $("#danger").innerHTML = next && next.out
    ? `<p class="sub tight">Week ${next.week} · ${esc(next.theme)} · ${fmtDate(next.date, { weekday: "short", month: "short", day: "numeric" })}</p>` +
      danger.map(r => `<div class="danger-row">${avatar(r.c, 30)}<span class="nm">${esc(r.c.couple)}</span><b>${pct(r.outNext)}</b></div>`).join("")
    : `<p class="sub tight">${next ? "No elimination expected next week." : "Season complete."}</p>`;
}

/** Given each week's real scores + buzz, who would this weighting have sent home? */
function backtestAt(wPct) {
  const w = wPct / 100;
  const out = [];
  for (const wk of M.weeks) {
    const gone = M.cast.filter(c => c.eliminated_week === wk.week).map(c => c.name);
    if (!gone.length) continue;
    const rows = Object.keys(wk.scores).map(n => M.hist[n].find(h => h.week === wk.week));
    const votes = r => (r.bShare || 0) ** state.damp;
    const sb = rows.reduce((a, r) => a + votes(r), 0) || 1;
    const scored = rows.map(r => ({ name: r.name, c: w * r.jShare + (1 - w) * votes(r) / sb }))
      .sort((a, b) => a.c - b.c);
    const pred = scored.slice(0, gone.length).map(r => r.name);
    out.push({ week: wk.week, gone, pred, hits: pred.filter(p => gone.includes(p)).length });
  }
  return out;
}

function renderBacktest() {
  const cur = backtestAt(state.weight);
  const total = cur.reduce((a, r) => a + r.gone.length, 0);
  const hits = cur.reduce((a, r) => a + r.hits, 0);
  if (!total) { $("#backtestLine").textContent = "No eliminations yet to test against."; return; }
  const curve = Array.from({ length: 21 }, (_, i) => ({ x: i * 5, y: backtestAt(i * 5).reduce((a, r) => a + r.hits, 0) }));
  const best = Math.max(...curve.map(p => p.y));
  const bestW = curve.filter(p => p.y === best).map(p => p.x);
  $("#backtestLine").innerHTML = `At <b>${state.weight}% judges</b>, the bottom-ranked couple matched the real elimination <b>${hits} of ${total}</b> times. Best fit so far: ${best}/${total} at ${rangeText(bestW)} judges.`;

  const el = $("#backtestChart");
  lineChart(el, {
    label: "Correct elimination calls by weighting",
    height: 150, margin: { l: 28, r: 12, b: 26, t: 10 },
    x: { domain: [0, 100], ticks: [0, 25, 50, 75, 100].map(v => ({ v, label: v === 0 ? "All buzz" : v === 100 ? "All judges" : `${v}%` })) },
    y: { domain: [0, total], ticks: niceTicks(0, total, Math.min(total, 3)).filter(Number.isInteger) },
    series: [{ id: "bt", color: "var(--bar)", pts: curve }],
    events: [{ x: state.weight }], dots: false,
    tooltip: (_, p) => `<div class="tt-row"><span>${p.x}% judges</span><b>${p.y} of ${total} correct</b></div>`,
  });
  const ev = el.querySelector(".event");
  if (ev) ev.setAttribute("class", "cur-weight");

  $("#backtestWeeks").innerHTML = cur.map(r => `<div class="bt-week"><span class="lab">Week ${r.week}</span>
    <span>${r.pred.map(n => esc(M.byName[n].couple)).join(", ")}${r.hits === r.gone.length ? "" : ` <span class="muted">(actual: ${r.gone.map(n => esc(M.byName[n].couple)).join(", ")})</span>`}</span>
    <span class="${r.hits === r.gone.length ? "ok" : "no"}" aria-label="${r.hits === r.gone.length ? "correct" : "missed"}">${r.hits === r.gone.length ? "✓" : "✗"}</span></div>`).join("");
}

function rangeText(xs) {
  const runs = [];
  for (const x of xs) {
    const last = runs[runs.length - 1];
    if (last && x - last[1] === 5) last[1] = x; else runs.push([x, x]);
  }
  return runs.map(([a, b]) => (a === b ? `${a}%` : `${a}–${b}%`)).join(", ");
}

function renderFooter() {
  const t = D.trends;
  const dt = new Date(D.updated);
  $("#sources").innerHTML = `Scores from <a href="${esc(D.source)}">Wikipedia</a>; search interest from Google Trends (${esc(t.geo)}, voting window = episode day + ${t.window_days_after} day). Photos via Wikimedia Commons. Updated ${dt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.`;
}

/* ------------------------------------------------------------------ dialog */

function openCouple(name) {
  const c = M.byName[name];
  const h = M.hist[name];
  const sim = SIM.byName[name];
  const term = D.trends.terms?.[name];
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
        </div>
      </div>
    </div>
    <div class="d-section">
      <h3>Every dance</h3>
      <div class="table-scroll"><table class="dances"><thead><tr><th>Week</th><th>Dance</th><th>Judges</th><th class="num">Score</th><th class="num">Rank</th><th class="num">Buzz</th></tr></thead><tbody>
      ${h.map(x => x.dances.map((d, i) => `<tr>
        <td>${i ? "" : `Wk ${x.week}<div class="theme">${esc(x.theme)}</div>`}</td>
        <td>${esc(d.dance)}</td><td>${d.marks.join(" · ")}</td>
        <td class="num"><b>${d.score}</b>${x.dances.length > 1 && i === x.dances.length - 1 ? `<div class="theme">week ${x.total}/${x.max}</div>` : ` <span class="theme">/ ${d.marks.length * 10}</span>`}</td>
        <td class="num">${i ? "" : `${ordinal(x.rank)}<span class="theme"> /${x.n}</span>`}</td>
        <td class="num">${i || x.bShare == null ? "" : pct(x.bShare, 1)}</td></tr>`).join("")).join("")}
      </tbody></table></div>
    </div>
    <div class="d-section">
      <h3>Search interest</h3>
      <div class="chart" id="dialogChart"></div>
      <p class="foot">Google Trends ${term ? `${term.label.startsWith("topic") ? esc(term.label) : `search term “${esc(term.term)}”`}` : ""}</p>
    </div>
    ${c.photo_credit ? `<p class="credit">Photo: <a href="${esc(c.photo_credit)}">Wikimedia Commons</a></p>` : ""}`;
  const dlg = $("#coupleDialog");
  dlg.showModal();
  $(".d-close", dlg).onclick = () => dlg.close();
  const { dates, series } = D.trends.daily;
  if (series[name]) {
    const idx = Object.fromEntries(dates.map((d, i) => [d, i]));
    const step = Math.max(1, Math.round(dates.length / 5));
    lineChart($("#dialogChart"), {
      label: `Search interest for ${c.name}`, height: 170, margin: { l: 32, r: 12 },
      x: { domain: [0, dates.length - 1], ticks: dates.map((d, i) => ({ v: i, label: fmtDate(d) })).filter((_, i) => i % step === 0) },
      y: { domain: [0, Math.max(...series[name]) * 1.08 || 1], ticks: niceTicks(0, Math.max(...series[name]) || 1, 3) },
      series: [{ id: name, color: "var(--gold)", pts: series[name].map((v, i) => ({ x: i, y: v, date: dates[i] })) }],
      events: M.weeks.map(w => w.airdates[0]).filter(d => d in idx).map((d, i) => ({ x: idx[d], label: `W${i + 1}` })),
      tooltip: (_, p) => `<div class="tt-row"><span>${fmtDate(p.date, { weekday: "short", month: "short", day: "numeric" })}</span><b>${p.y.toFixed(1)}</b></div>`,
    });
  }
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
  segBind("#shareSeg", "shareWeek", renderShare);

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
    raf = requestAnimationFrame(() => { runSim(); renderSim(); renderBacktest(); renderStats(); renderCards(); });
  };
  $("#weight").addEventListener("input", e => { state.weight = +e.target.value; store.set("dwts-weight", state.weight); resim(); });
  $("#recency").addEventListener("input", e => { state.recency = +e.target.value; resim(); });
  $("#finalists").addEventListener("change", e => { state.finalists = +e.target.value; resim(); });
  $("#sims").addEventListener("change", e => { state.sims = +e.target.value; resim(); });
  $("#damp").addEventListener("change", e => { state.damp = +e.target.value; resim(); });

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
    rt = setTimeout(() => { renderScoreChart(); renderBuzzChart(); renderBacktest(); }, 120);
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
