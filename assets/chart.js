// Minimal SVG line chart with a log y-axis, for equity curves that span ×1 to ×100.
// Follows the dataviz rules: 2px lines, solid hairline grid, end-dot + direct value label per
// series, legend kept by the caller, crosshair tooltip on pointer and keyboard (← →).

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

// "nice" multiples for a log axis: 0.25 0.5 1 2 5 10 20 50 ...
function logTicks(min, max) {
  const out = [];
  for (let p = Math.floor(Math.log10(min)) - 1; p <= Math.ceil(Math.log10(max)) + 1; p++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** p;
      if (v >= min && v <= max) out.push(v);
    }
  }
  return out.length > 6 ? out.filter((_, i) => i % 2 === 0) : out;
}

export const pctLabel = (x) => {
  const p = (x - 1) * 100;
  const a = Math.abs(p);
  // two significant digits above 1,000% keeps labels short without "K" shorthand
  const body = a >= 1000 ? (Math.round(a / 10 ** (Math.floor(Math.log10(a)) - 1)) * 10 ** (Math.floor(Math.log10(a)) - 1)).toLocaleString("en-US") : Math.round(a);
  return `${p >= 0 ? "+" : "−"}${body}%`;
};

const escText = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// push labels apart vertically so none overlap (min gap px), keeping their order
function spread(items, gap, lo, hi) {
  items.sort((a, b) => a.y - b.y);
  for (let i = 1; i < items.length; i++) items[i].y = Math.max(items[i].y, items[i - 1].y + gap);
  const over = items.length ? items[items.length - 1].y - hi : 0;
  if (over > 0) items.forEach((it) => (it.y -= over));
  for (let i = items.length - 2; i >= 0; i--) items[i].y = Math.min(items[i].y, items[i + 1].y - gap);
  items.forEach((it) => (it.y = Math.max(lo, it.y)));
  return items;
}

// "nice" linear ticks: about n values on 1/2/5 × 10^k steps
function linTicks(min, max, n = 5) {
  const raw = (max - min) / n, mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(+v.toFixed(10));
  return out;
}

/**
 * series: [{label, color, points: [[unixSeconds, value], ...], dash?}] — dash draws a dashed
 * line (used for a neutral baseline).
 * opts.mode: "return" (default) normalises every line to its first point on a log axis and labels
 * returns; "value" plots raw values on a linear axis, labelled with opts.format.
 */
export function lineChart(container, series, opts = {}) {
  const valueMode = opts.mode === "value";
  const fmt = opts.format || ((v) => Math.round(v).toLocaleString("en-US"));
  const label = valueMode ? fmt : pctLabel;
  container.innerHTML = "";
  // draw at the real pixel width so text stays legible on phones
  const W = Math.max(280, Math.round(container.clientWidth || 640));
  const H = Math.round(Math.min(W > 700 ? 400 : 320, Math.max(220, W * 0.5)));
  const pad = { l: 2, r: 70, t: 18, b: 24 };
  const norm = series.map((s) => {
    const base = s.points[0][1];
    return { ...s, pts: s.points.map(([t, v]) => [t, valueMode ? v : v / base]) };
  });
  const all = norm.flatMap((s) => s.pts);
  const t0 = Math.min(...all.map((p) => p[0]));
  const t1 = Math.max(t0 + 86400, ...all.map((p) => p[0]));   // a single day still gets a width
  const lo = Math.min(...all.map((p) => p[1])), hi = Math.max(...all.map((p) => p[1]));
  const span = valueMode ? Math.max(hi - lo, Math.abs(hi) * 0.02 || 1) : 0;
  const vmin = valueMode ? (lo >= 0 ? Math.max(0, lo - span * 0.15) : lo - span * 0.15) : lo * 0.9;
  const vmax = valueMode ? hi + span * 0.15 : hi * 1.1;
  const lmin = Math.log(vmin), lmax = Math.log(vmax);
  const x = (t) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = valueMode
    ? (v) => pad.t + (1 - (v - vmin) / (vmax - vmin)) * (H - pad.t - pad.b)
    : (v) => pad.t + (1 - (Math.log(v) - lmin) / (lmax - lmin)) * (H - pad.t - pad.b);

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", tabindex: 0,
    "aria-label": `${valueMode ? "數值走勢" : "累積報酬（對數刻度）"}：${norm.map((s) => `${s.label} ${label(s.pts.at(-1)[1])}`).join("，")}。用左右鍵逐點查看。` });
  const grid = el("g", { class: "grid" }), axis = el("g", { class: "axis" });
  // y ticks sit just above their gridline on the left, leaving the right margin to end labels
  for (const v of valueMode ? linTicks(vmin, vmax) : logTicks(vmin, vmax)) {
    grid.append(el("line", { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), "stroke-width": 1 }));
    const tx = el("text", { x: pad.l + 2, y: y(v) - 4 });
    tx.textContent = label(v);
    axis.append(tx);
  }
  const xTick = (t, text) => {
    const tx = el("text", { x: x(t), y: H - 6, "text-anchor": "middle" });
    tx.textContent = text;
    axis.append(tx);
  };
  const y0 = new Date(t0 * 1000).getUTCFullYear(), y1 = new Date(t1 * 1000).getUTCFullYear();
  if (t1 - t0 > 400 * 86400) {
    const step = y1 - y0 > 6 && W < 520 ? 2 : 1;
    for (let yr = y0 + 1; yr <= y1; yr += step) xTick(Date.UTC(yr, 0, 1) / 1000, yr);
  } else {
    // under a year and a bit: month/day labels at both ends, months in between when they fit
    const md = (t) => { const d = new Date(t * 1000); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
    const months = [];
    for (let d = new Date(t0 * 1000); ; ) {
      d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
      if (d.getTime() / 1000 >= t1) break;
      months.push(d.getTime() / 1000);
    }
    const room = Math.floor((W - pad.l - pad.r) / 56);
    const every = Math.max(1, Math.ceil(months.length / Math.max(1, room - 2)));
    months.filter((_, i) => i % every === 0).forEach((t) => {
      if (x(t) - x(t0) > 40 && x(t1) - x(t) > 40) xTick(t, `${new Date(t * 1000).getUTCMonth() + 1}月`);
    });
    const first = el("text", { x: pad.l, y: H - 6 }); first.textContent = md(t0); axis.append(first);
    if (t1 - t0 >= 86400 * 2 || norm[0].pts.length > 1) {
      const last = el("text", { x: x(t1), y: H - 6, "text-anchor": "end" }); last.textContent = md(t1); axis.append(last);
    }
  }
  svg.append(grid);

  // draw the first series (the subject) last so it sits on top
  for (const s of [...norm].reverse()) {
    const d = s.pts.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join("");
    svg.append(el("path", { d, fill: "none", stroke: s.color, "stroke-width": 2,
      "stroke-linejoin": "round", "stroke-linecap": "round", ...(s.dash ? { "stroke-dasharray": "5 4" } : {}) }));
  }

  svg.append(axis);  // labels sit above the lines (with a surface halo from CSS)

  // end-dots with a surface ring, and the final value as a direct label in the right margin
  const ends = el("g", { class: "end" });
  const labels = spread(norm.map((s) => ({ s, y: y(s.pts.at(-1)[1]) })), 14, pad.t, H - pad.b);
  for (const { s, y: ly } of labels) {
    const [lt, lv] = s.pts.at(-1);
    ends.append(el("circle", { cx: x(lt), cy: y(lv), r: 4, fill: s.color, stroke: "var(--bg)", "stroke-width": 2 }));
    const tx = el("text", { x: W - pad.r + 8, y: ly + 4 });
    tx.textContent = label(lv);
    ends.append(tx);
  }
  svg.append(ends);

  const cursor = el("line", { y1: pad.t, y2: H - pad.b, stroke: "var(--ink-3)", "stroke-width": 1, opacity: 0 });
  const dots = norm.map((s) => el("circle", { r: 4, fill: s.color, stroke: "var(--bg)", "stroke-width": 2, opacity: 0 }));
  svg.append(cursor, ...dots);
  container.append(svg);

  const tip = document.createElement("div");
  tip.className = "tip";
  tip.hidden = true;
  container.append(tip);

  const times = norm[0].pts.map((p) => p[0]);
  let idx = times.length - 1;
  const show = (i) => {
    idx = Math.max(0, Math.min(times.length - 1, i));
    const at = times[idx];
    const rows = norm.map((s) => {
      let best = s.pts[0];
      for (const p of s.pts) if (Math.abs(p[0] - at) < Math.abs(best[0] - at)) best = p;
      return { s, p: best };
    });
    cursor.setAttribute("x1", x(at)); cursor.setAttribute("x2", x(at)); cursor.setAttribute("opacity", 1);
    rows.forEach(({ p }, k) => { dots[k].setAttribute("cx", x(p[0])); dots[k].setAttribute("cy", y(p[1])); dots[k].setAttribute("opacity", 1); });
    tip.innerHTML = `<div class="muted">${new Date(at * 1000).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "numeric", day: "numeric" })}</div>` +
      rows.map(({ s, p }) => `<div><span style="color:${s.color}" aria-hidden="true">●</span> ${escText(s.label)} <b class="num">${label(p[1])}</b></div>`).join("");
    tip.hidden = false;
    const r = svg.getBoundingClientRect();
    const px = (x(at) / W) * r.width;
    tip.style.left = `${Math.min(Math.max(px - tip.offsetWidth / 2, 0), r.width - tip.offsetWidth)}px`;
    tip.style.top = "-8px";
    tip.style.transform = "translateY(-100%)";
  };
  const hide = () => { tip.hidden = true; cursor.setAttribute("opacity", 0); dots.forEach((d) => d.setAttribute("opacity", 0)); };
  const fromPointer = (clientX) => {
    const r = svg.getBoundingClientRect();
    const t = t0 + ((((clientX - r.left) / r.width) * W - pad.l) / (W - pad.l - pad.r)) * (t1 - t0);
    let best = 0;
    for (let i = 0; i < times.length; i++) if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i;
    show(best);
  };
  svg.addEventListener("pointermove", (e) => fromPointer(e.clientX));
  svg.addEventListener("pointerdown", (e) => fromPointer(e.clientX));
  // on touch the tooltip stays after the finger lifts so the value can be read; mouse hides on leave
  svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
  svg.addEventListener("focus", () => show(idx));
  svg.addEventListener("blur", hide);
  svg.addEventListener("keydown", (e) => {
    const stepN = e.shiftKey ? 13 : 1;
    if (e.key === "ArrowLeft") { show(idx - stepN); e.preventDefault(); }
    if (e.key === "ArrowRight") { show(idx + stepN); e.preventDefault(); }
    if (e.key === "Home") { show(0); e.preventDefault(); }
    if (e.key === "End") { show(times.length - 1); e.preventDefault(); }
  });
  return norm;
}

/**
 * Donut of shares. slices: [{label, color, value}]. Shares are printed as direct labels in the
 * legend the caller renders; the ring itself carries a 2px surface gap between slices.
 */
export function donutChart(container, slices, centerTop = "", centerBottom = "") {
  container.innerHTML = "";
  const S = 200, R = 92, r = 62, c = S / 2;
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  const svg = el("svg", { viewBox: `0 0 ${S} ${S}`, role: "img",
    "aria-label": `資產比例：${slices.map((s) => `${s.label} ${Math.round((s.value / total) * 100)}%`).join("，")}` });
  let a0 = -Math.PI / 2;
  const pt = (rad, a) => `${(c + rad * Math.cos(a)).toFixed(2)},${(c + rad * Math.sin(a)).toFixed(2)}`;
  for (const s of slices.filter((s) => s.value > 0)) {
    const frac = s.value / total;
    const a1 = a0 + frac * Math.PI * 2;
    if (frac >= 0.9999) {
      svg.append(el("circle", { cx: c, cy: c, r: (R + r) / 2, fill: "none", stroke: s.color, "stroke-width": R - r }));
    } else {
      const big = a1 - a0 > Math.PI ? 1 : 0;
      svg.append(el("path", { fill: s.color, stroke: "var(--bg)", "stroke-width": 2, "stroke-linejoin": "round",
        d: `M${pt(R, a0)}A${R},${R} 0 ${big} 1 ${pt(R, a1)}L${pt(r, a1)}A${r},${r} 0 ${big} 0 ${pt(r, a0)}Z` }));
    }
    a0 = a1;
  }
  const t1 = el("text", { x: c, y: c - 2, "text-anchor": "middle", class: "donut-top" });
  t1.textContent = centerTop;
  const t2 = el("text", { x: c, y: c + 18, "text-anchor": "middle", class: "donut-bottom" });
  t2.textContent = centerBottom;
  svg.append(t1, t2);
  container.append(svg);
}
