import { donutChart, lineChart, pctLabel } from "./chart.js?v=20261107170404";

const app = document.getElementById("app");
let cache = {};
const load = (name) => (cache[name] ??= fetch(`data/${name}.json`, { cache: "no-cache" })
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${name}.json（HTTP ${r.status}）`)))));

const STALE_HOURS = 6;  // reports come every 2h; three missed slots means something is off

// ---------- formatting ----------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? esc(u) : "#");
const pct = (x, digits = 0) => (x == null ? "—"
  : `${x >= 0 ? "+" : ""}${(x * 100).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`);
const signCls = (x) => (x == null ? "" : x >= 0 ? "up" : "down");
const money = (x) => x.toLocaleString("en-US", { minimumFractionDigits: x < 10000 ? 2 : 0, maximumFractionDigits: x < 10000 ? 2 : 0 });
const twTime = (iso) => new Date(iso).toLocaleString("zh-TW", {
  timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
});
const twDate = (iso) => new Date(iso).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "numeric", day: "numeric" });
const hoursSince = (iso) => (Date.now() - new Date(iso).getTime()) / 3.6e6;

const STANCE = { "偏多": "up", "觀望": "warn", "偏空": "down" };
const RISK = { low: ["低", "up"], medium: ["中", "warn"], high: ["高", "down"] };
const IMPACT = { bullish: ["up", "利多"], bearish: ["down", "利空"], neutral: ["", "中性"] };
const isCandidate = (c) => c.status.startsWith("Testnet");
const shortStatus = (c) => c.status.replace("Testnet 候選 ", "");

// older reports used {view, reason} before the stance format
const stanceOf = (v) => v.stance ? v : { stance: v.view, action: v.reason, watch: "" };

function position(sig) {
  const exp = sig.exposure ?? (sig.holding ? 1 : 0);
  return { exp, label: exp < 0.05 ? "空手" : `持有 ${Math.round(exp * 100)}%`, votes: sig.votes != null ? `${sig.votes}/4 看多` : "" };
}

const impactDot = (impact) => {
  const [cls, label] = IMPACT[impact] || IMPACT.neutral;
  return `<span class="dot ${cls}" aria-hidden="true"></span><span class="sr-only">${label}：</span>`;
};

// ---------- pages ----------

async function overview() {
  const [latest, strategies] = await Promise.all([load("latest"), load("strategies")]);
  const r = latest.report;
  if (!r) return { title: "總覽", html: `<p class="empty">還沒有報告，第一份報告產生後會出現在這裡。</p>` };
  const a = r.analysis, m = r.market;
  const s = Math.max(-5, Math.min(5, a.sentiment ?? 0));
  const [riskTxt, riskCls] = RISK[a.risk_level] || ["—", ""];
  const fg = m.fear_greed;
  const age = hoursSince(latest.generated_at);
  // A, B, C in order, so rows read the same on every coin
  const candidates = strategies.cards.filter(isCandidate).sort((x, y) => shortStatus(x).localeCompare(shortStatus(y)));

  // one block per coin: price, then each candidate's position (the page's main job), then the AI stance
  const today = Object.entries(m.assets).map(([sym, x]) => {
    const v = stanceOf(a.assets?.[sym] || {});
    const strat = candidates.map((c) => {
      const sig = latest.signals[c.id]?.[sym];
      if (!sig) return "";
      const p = position(sig);
      const detail = p.votes || (c.id === "sma200" ? (x.above_sma200d ? "站上均線" : "跌破均線") : "");
      return `<li><a href="#/strategy/${c.id}?c=${sym}">${esc(c.name)}</a>
        <span class="votes">${detail}</span><span class="chip ${p.exp >= 0.05 ? "up" : ""}">${p.label}</span></li>`;
    }).join("");
    const held = candidates.filter((c) => (latest.signals[c.id]?.[sym]?.exposure ?? 0) >= 0.05).length;
    return `<article class="coin">
      <header class="coin-head">
        <h3 class="sym">${esc(sym)}</h3>
        <span class="price-val">${money(x.price)}</span>
        <span class="num ${signCls(x.change_pct)}">${x.change_pct >= 0 ? "+" : ""}${x.change_pct.toFixed(2)}%</span>
        <span class="muted">24h</span>
      </header>
      <p class="tally">${candidates.length} 個策略中 ${held} 個持有、${candidates.length - held} 個空手</p>
      <ul class="coin-strats" aria-label="${esc(sym)} 策略部位">${strat}</ul>
      ${v.stance ? `<div class="coin-ai"><span class="chip ${STANCE[v.stance] || ""}">AI ${esc(v.stance)}</span>
        <div><p>${esc(v.action)}</p>${v.watch ? `<p class="watch">${esc(v.watch)}</p>` : ""}</div></div>` : ""}
    </article>`;
  }).join("");

  const risks = a.risks || [];
  const news = a.news || [];
  const newsItem = (n) => `<li class="news-item">${impactDot(n.impact)}<div><a class="news-title" href="${safeUrl(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>
    <div>${esc(n.summary)}</div><div class="news-meta">${esc(n.source)}</div></div></li>`;
  const more = (items, shown, render, label) => items.length > shown
    ? `<details class="more"><summary>${label}（還有 ${items.length - shown} 則）</summary><ul class="list">${items.slice(shown).map(render).join("")}</ul></details>` : "";

  return { title: "總覽", html: `
    <section class="hero">
      <p class="eyebrow">AI 市場報告 · ${twTime(r.created_at)}</p>
      <h1 tabindex="-1">${esc(a.headline)}</h1>
      <div class="hero-meta">
        <div class="meter" role="meter" aria-valuemin="-5" aria-valuemax="5" aria-valuenow="${s}" aria-label="市場情緒 ${s}（-5 悲觀到 +5 樂觀）">
          <span class="meter-label">情緒</span>
          <div class="meter-track" aria-hidden="true"><div class="meter-dot" style="left:${((s + 5) / 10) * 100}%"></div></div>
          <span class="num">${s > 0 ? "+" : ""}${s}</span>
        </div>
        <span class="chip ${riskCls}">風險 ${riskTxt}</span>
        ${fg ? `<span class="chip">恐懼貪婪 <span class="num">${fg.value}</span></span>` : ""}
        ${age > STALE_HOURS ? `<span class="chip warn">資料已 ${Math.floor(age)} 小時未更新</span>` : ""}
      </div>
    </section>
    <section>
      <h2 class="sr-only">今天的策略部位</h2>
      <div class="coins">${today}</div>
      <p class="caption">百分比是撥給程式那筆資金的建議部位，「看多」是四個指標中偏多的票數。這三個是準備先在幣安測試網（Testnet）模擬交易的策略，目前尚未實際下單。點策略名稱看規則。</p>
    </section>
    <section>
      <h2>接下來注意</h2>
      ${a.summary ? `<p>${esc(a.summary)}</p>` : ""}
      <p class="muted">${esc(a.sentiment_reason)}</p>
      <p class="caption">情緒 -5 悲觀 ~ +5 樂觀；恐懼貪婪指數 0 極度恐懼 ~ 100 極度貪婪。</p>
    </section>
    ${paperSection(latest.paper)}
    ${risks.length ? `<section><h2>風險</h2><ul class="list">${risks.slice(0, 2).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      ${more(risks, 2, (x) => `<li>${esc(x)}</li>`, "更多風險")}</section>` : ""}
    <section><h2>重點新聞</h2>
      <ul class="list">${news.slice(0, 3).map(newsItem).join("") || "<li class='muted'>這段時間沒有重大新聞</li>"}</ul>
      ${more(news, 3, newsItem, "更多新聞")}</section>` };
}

// Testnet sleeves: one row per strategy with each coin's equity and the combined return
function paperSection(paper) {
  if (!paper?.sleeves?.length) return "";
  const byStrat = {};
  for (const r of paper.sleeves) (byStrat[r.label] ??= []).push(r);
  const rows = Object.entries(byStrat).sort(([a], [b]) => a.localeCompare(b)).map(([label, rs]) => {
    const eq = rs.reduce((t, r) => t + r.equity, 0), budget = rs.reduce((t, r) => t + r.budget, 0);
    return `<tr><td>${esc(label)}</td>${rs.sort((a, b) => a.symbol.localeCompare(b.symbol)).map((r) =>
      `<td class="r num">${r.equity.toFixed(2)}<div class="muted small">${Math.round(r.exposure * 100)}% 在幣</div></td>`).join("")}
      <td class="r num ${signCls(eq / budget - 1)}">${pct(eq / budget - 1, 1)}</td></tr>`;
  }).join("");
  const coins = [...new Set(paper.sleeves.map((r) => r.symbol))].sort();
  const trades = (paper.trades || []).slice(0, 5).map((t) =>
    `<li><span class="num muted small">${twTime(t.time)}</span> ${t.side === "buy" ? "買進" : "賣出"} ${esc(t.symbol)}
      <span class="num">${Number(t.qty).toFixed(5)} @ ${money(t.price)}</span> <span class="muted small">${esc(t.strategy)}</span></li>`).join("");
  return `<section>
    <h2>模擬帳戶</h2>
    <p class="caption" style="margin:0 0 10px">${paper.mode === "binance" ? "幣安測試網" : "用 MAX 即時買賣價模擬成交"}、假資金，每個策略每個幣各 ${paper.sleeves[0].budget} USDT。${paper.started ? "" : "尚未開始交易。"}</p>
    <div class="table-scroll"><table class="fixed">
      <colgroup><col style="width:34%"><col><col><col></colgroup>
      <thead><tr><th>策略</th>${coins.map((c) => `<th class="r">${c}（USDT）</th>`).join("")}<th class="r">合計報酬</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${trades ? `<h3 class="sub-h">最近成交</h3><ul class="list">${trades}</ul>` : ""}
  </section>`;
}

function kpis(card) {
  return `<div class="kpi-head">驗證期 年化 / 最大回撤</div>` + Object.entries(card.assets).map(([sym, x]) => `
    <div class="kpi"><div class="k">${esc(sym)}</div>
      <div class="v num"><span class="${signCls(x.test.cagr)}">${pct(x.test.cagr)}</span> / <span class="down">${pct(x.test.mdd)}</span></div></div>`).join("");
}

async function strategies() {
  const d = await load("strategies");
  const cards = d.cards.map((c) => `
    <a class="card" href="#/strategy/${c.id}">
      <div class="card-top"><h2 class="card-title">${esc(c.name)}</h2><span class="chip ${isCandidate(c) ? "accent" : ""}">${esc(c.status)}</span></div>
      <div class="tags">${c.tags.map(esc).join(" · ")}</div>
      <p>${esc(c.summary)}</p>
      <div class="kpis">${kpis(c)}</div>
    </a>`).join("");

  const dcaTable = (label, rows) => `
    <h3 class="sub-h">${label}</h3>
    <div class="table-scroll"><table class="fixed">
      <colgroup><col style="width:40%"><col><col><col></colgroup>
      <thead><tr><th>策略</th><th class="r">BTC</th><th class="r">ETH</th><th class="r">各半</th></tr></thead>
      <tbody>${Object.entries(rows).map(([name, r]) => `<tr><td>${esc(name)}</td>${["BTC", "ETH", "各半"].map((k) =>
        `<td class="r num"><span class="${signCls(r[k].roi)}">${pct(r[k].roi)}</span><div class="muted small">${r[k].worst >= 0 ? "未虧損" : pct(r[k].worst)}</div></td>`).join("")}</tr>`).join("")}
      </tbody></table></div>`;

  return { title: "策略", html: `
    <section>
      <p class="eyebrow">回測 · ${twDate(d.start)} 起 · 本金 ${d.capital} USDT · 6 小時 K 線</p>
      <h1 tabindex="-1">策略</h1>
      <p class="lede">卡片上的數字都是 ${twDate(d.split)} 之後的驗證期，挑參數時沒看過這段資料。已扣 0.1% 手續費與 0.05% 滑價。</p>
    </section>
    <section><div class="cards">${cards}</div></section>
    <section>
      <h2>每週存 ${d.weekly} USDT 的情境</h2>
      <p class="lede">大字是報酬率，小字是過程中最大帳面虧損（相對當時已投入的本金）。握著不賣就是一般定投。</p>
      ${dcaTable("驗證期（2023 起）", d.dca.test)}
      ${dcaTable("全期間", d.dca.full)}
    </section>
    <section>
      <h2>名詞解釋</h2>
      <dl class="glossary">
        <dt>驗證期 / 訓練期</dt><dd>2018–2022 用來挑參數（訓練期），2023 之後完全沒參與挑選、只拿來檢驗（驗證期）。驗證期的數字比較能代表未來。</dd>
        <dt>年化報酬</dt><dd>把總報酬換算成「平均每年」的報酬率。</dd>
        <dt>最大回撤</dt><dd>從最高點跌到後來最低點的最大跌幅，代表最慘的時候帳面會少多少。</dd>
        <dt>MACD</dt><dd>快、慢兩條均線的差距；MACD 線在 0 之上代表短期趨勢強於長期。</dd>
        <dt>KD</dt><dd>收盤價在最近一段高低區間的位置；K 值大於 50 代表偏強。</dd>
        <dt>RSI</dt><dd>一段時間內上漲與下跌力道的比例；大於 50 代表買方較強。</dd>
        <dt>DMI</dt><dd>比較向上（+DI）與向下（-DI）的趨勢力道；+DI 大於 -DI 代表偏多。</dd>
        <dt>Testnet 候選</dt><dd>準備先在幣安測試網用假資金模擬交易的策略，跑一段時間沒問題才考慮真錢。</dd>
      </dl>
    </section>` };
}

// year-end cumulative return of each series: the table twin of the chart
function yearTable(norm) {
  const years = [...new Set(norm[0].pts.map(([t]) => new Date(t * 1000).getUTCFullYear()))];
  const at = (s, yr) => s.pts.filter(([t]) => new Date(t * 1000).getUTCFullYear() === yr).at(-1)?.[1];
  return `<table><thead><tr><th>年底</th>${norm.map((s) => `<th class="r">${esc(s.label)}</th>`).join("")}</tr></thead>
    <tbody>${years.map((yr) => `<tr><td class="num">${yr}</td>${norm.map((s) => {
      const v = at(s, yr); return `<td class="r num">${v == null ? "—" : pctLabel(v)}</td>`; }).join("")}</tr>`).join("")}</tbody></table>`;
}

async function strategy(id, query) {
  const [d, latest] = await Promise.all([load("strategies"), load("latest")]);
  const c = d.cards.find((x) => x.id === id);
  if (!c) return { title: "找不到策略", html: `<p class="empty">找不到這個策略。<a href="#/strategies">回到所有策略</a></p>` };
  const hold = d.cards.find((x) => x.id === "hold"), sma = d.cards.find((x) => x.id === "sma200");
  const coins = Object.keys(c.assets);
  const state = { sym: coins.includes(query.get("c")) ? query.get("c") : coins[0], period: query.get("p") === "full" ? "full" : "test" };
  const splitTs = new Date(d.split).getTime() / 1000;
  const periods = [["test", "驗證期 2023 起"], ["train", "訓練期 2018–2022"], ["full", "全期間"]];
  const metricRows = Object.entries(c.assets).flatMap(([sym, x]) => periods.map(([k, label], i) => `
    <tr class="${i === periods.length - 1 ? "group-end" : ""}">${i === 0 ? `<th scope="rowgroup" rowspan="3" class="num">${esc(sym)}</th>` : ""}<td>${label}</td>
      <td class="r num ${signCls(x[k].cagr)}">${pct(x[k].cagr)}</td>
      <td class="r num down">${pct(x[k].mdd)}</td>
      <td class="r num">${x[k].years ? Math.round(x[k].trades / x[k].years) : "—"}</td></tr>`)).join("");
  const now = coins.map((sym) => {
    const sig = latest.signals?.[c.id]?.[sym];
    if (!sig) return "";
    const p = position(sig);
    return `<span class="now-item"><b class="num">${esc(sym)}</b> <span class="chip ${p.exp >= 0.05 ? "up" : ""}">${p.label}</span>${p.votes ? ` <span class="muted">${p.votes}</span>` : ""}</span>`;
  }).join("");

  // returns a cleanup so the next route can drop this page's observer
  const mount = (root) => {
    const box = root.querySelector("#chart");
    const live = root.querySelector("#chart-live");
    let first = true;
    const draw = () => {
      if (!box.isConnected) return;
      const colorOf = (card) => card.id === "hold" ? "var(--series-hold)" : card.id === "sma200" ? "var(--series-sma)" : "var(--series-strategy)";
      const subjects = [c, ...(c.id !== "sma200" ? [sma] : []), ...(c.id !== "hold" ? [hold] : [])];
      const cut = (pts) => (state.period === "test" ? pts.filter(([t]) => t >= splitTs) : pts);
      const series = subjects.map((card) => ({ label: card.name, color: colorOf(card), points: cut(card.assets[state.sym].curve) }));
      const norm = lineChart(box, series);
      root.querySelector("#legend").innerHTML = series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join("");
      root.querySelector("#curve-table").innerHTML = yearTable(norm);
      root.querySelector("#chart-note").textContent =
        `對數刻度，每週一點，${state.period === "test" ? twDate(d.split) : twDate(d.start)} 起算 0%。可用 ← → 鍵逐點查看。`;
      root.querySelectorAll("[data-sym]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.sym === state.sym));
      root.querySelectorAll("[data-period]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.period === state.period));
      if (!first) live.textContent = `${state.sym}，${state.period === "test" ? "驗證期" : "全期間"}：` +
        norm.map((s) => `${s.label} ${pctLabel(s.pts.at(-1)[1])}`).join("，");
      first = false;
    };
    const remember = () => history.replaceState(null, "", `#/strategy/${c.id}?c=${state.sym}${state.period === "full" ? "&p=full" : ""}`);
    root.querySelector("#controls").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.sym) state.sym = b.dataset.sym;
      if (b.dataset.period) state.period = b.dataset.period;
      remember();
      draw();
    });
    let width = box.clientWidth;
    draw();
    const ro = new ResizeObserver(() => {
      if (box.isConnected && box.clientWidth && box.clientWidth !== width) { width = box.clientWidth; draw(); }
    });
    ro.observe(box);
    return () => ro.disconnect();
  };

  return { title: c.name, mount, html: `
    <a class="back" href="#/strategies">← 所有策略</a>
    <section>
      <p class="eyebrow">${c.tags.map(esc).join(" · ")}</p>
      <h1 tabindex="-1">${esc(c.name)}</h1>
      <div class="now"><span class="chip ${isCandidate(c) ? "accent" : ""}">${esc(c.status)}</span>${now}</div>
      <p class="lede">${esc(c.summary)}</p>
    </section>
    <section><h2 class="sr-only">規則</h2><ol class="steps">${c.steps.map(([t, s]) => `<li><strong>${esc(t)}</strong><span>${esc(s)}</span></li>`).join("")}</ol></section>
    <section>
      <div class="chart-head"><h2>累積報酬</h2>
        <div class="controls" id="controls">
          <div class="seg" role="group" aria-label="期間"><button data-period="test">驗證期</button><button data-period="full">全期間</button></div>
          <div class="seg" role="group" aria-label="幣種">${coins.map((s) => `<button data-sym="${s}">${s}</button>`).join("")}</div>
        </div></div>
      <div class="chart" id="chart"></div>
      <div class="legend" id="legend"></div>
      <p class="caption" id="chart-note"></p>
      <p class="sr-only" aria-live="polite" id="chart-live"></p>
      <details class="data-table"><summary>以表格檢視</summary><div class="table-scroll" id="curve-table"></div></details>
    </section>
    <section>
      <h2>績效</h2>
      <div class="table-scroll"><table class="metrics">
        <thead><tr><th scope="col"><span class="sr-only">幣種</span></th><th scope="col">期間</th><th scope="col" class="r">年化</th><th scope="col" class="r">最大回撤</th><th scope="col" class="r">每年交易</th></tr></thead>
        <tbody>${metricRows}</tbody></table></div>
    </section>
    <section class="two">
      <div><h2 class="sub-h">有利的行情</h2><p>${esc(c.good)}</p></div>
      <div><h2 class="sub-h">要承受的風險</h2><p>${esc(c.risk)}</p></div>
    </section>` };
}

async function reports() {
  const list = await load("reports");
  if (!list.length) return { title: "報告", html: `<p class="empty">還沒有報告，第一份報告產生後會出現在這裡。</p>` };
  return { title: "報告", html: `<section><h1 tabindex="-1">報告</h1><p class="lede">每 2 小時由 AI 整理新聞與行情，點一則展開。</p></section>
    <section class="flush">${list.map((r, i) => {
      const a = r.analysis, [riskTxt, riskCls] = RISK[a.risk_level] || ["—", ""];
      return `<details class="report" ${i === 0 ? "open" : ""}>
        <summary><span class="when">${twTime(r.created_at)}</span><span class="headline">${esc(a.headline)}</span>
          <span class="chip ${riskCls}">風險 ${riskTxt}</span></summary>
        <div class="body">
          <h3 class="body-h">AI 看法</h3>
          ${Object.entries(a.assets || {}).map(([sym, raw]) => { const v = stanceOf(raw);
            return `<p><b class="num">${esc(sym)}</b> <span class="chip ${STANCE[v.stance] || ""}">${esc(v.stance)}</span> ${esc(v.action)}${v.watch ? ` <span class="muted">· ${esc(v.watch)}</span>` : ""}</p>`; }).join("")}
          ${(a.risks || []).length ? `<h3 class="body-h">風險</h3><ul class="list">${a.risks.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
          ${(a.news || []).length ? `<h3 class="body-h">新聞</h3><ul class="list">${a.news.map((n) =>
            `<li class="news-item">${impactDot(n.impact)}<div><a class="news-title" href="${safeUrl(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a></div></li>`).join("")}</ul>` : ""}
        </div></details>`;
    }).join("")}</section>` };
}

// ---------- portfolio ----------

const BUCKET_COLOR = { swing: "var(--series-strategy)", crypto: "var(--series-sma)" };
// crypto strategies keep the colours they have on the strategy pages; the hold baseline is a
// neutral dashed line so three categorical colours are never exceeded
const STRAT_COLOR = { A: "var(--series-strategy)", B: "var(--series-sma)", C: "var(--series-hold)" };
const HOLD = "握著不賣";
const retLabel = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;

async function assets(_, query) {
  const d = await load("portfolio");
  const head = `<section><h1 tabindex="-1">資產</h1>
    <p class="lede">正在實驗中的兩個模擬交易（假資金）：台股波段、加密貨幣，每個交易日收盤後記錄一次。</p></section>`;
  if (!d.days?.length) return { title: "資產", html: `${head}<p class="empty">還沒有資產紀錄，第一筆會在下一個交易日收盤後產生。</p>` };

  const buckets = Object.keys(d.labels).filter((b) => d.latest[b]);
  const show = d.show_amounts;
  const fmt = (v) => show ? Math.round(v).toLocaleString("en-US") : v.toFixed(1);
  const unit = show ? "元" : "";
  const total = buckets.reduce((a, b) => a + d.latest[b].value, 0);
  const share = (v) => `${Math.round((v / total) * 100)}%`;
  const ts = d.days.map((day) => Date.parse(`${day}T14:30:00+08:00`) / 1000);
  const totals = d.days.map((_, i) => buckets.reduce((a, b) => a + (d.series[b][i] ?? 0), 0));
  const change = totals.at(-1) / totals[0] - 1;
  const pts = (vals) => vals.map((v, i) => [ts[i], v]).filter(([, v]) => v != null);

  // crypto A/B/C comparison: returns only, always public
  const cr = d.crypto || { days: [] };
  const strats = Object.keys(cr.series || {}).filter((k) => k !== HOLD);
  const cts = (cr.days || []).map((day) => Date.parse(`${day}T14:30:00+08:00`) / 1000);
  const cpts = (vals) => vals.map((v, i) => [cts[i], v == null ? null : v * 100]).filter(([, v]) => v != null);
  let pick = ["A", "B", "C"].includes(query.get("s")) ? query.get("s") : "all";
  const pos = (x) => (x == null ? "—" : x < 0.05 ? "空手" : `${Math.round(x * 100)}%`);
  const cryptoHtml = !strats.length ? "" : `
    <section>
      <div class="chart-head"><h2>加密貨幣策略比較</h2>
        <div class="controls"><div class="seg" role="group" aria-label="顯示策略" id="crypto-pick">
          <button data-pick="all">全部</button>${strats.map((lab) => `<button data-pick="${lab[0]}">${esc(lab[0])}</button>`).join("")}
        </div></div></div>
      <div class="chart" id="crypto-chart"></div>
      <div class="legend" id="crypto-legend"></div>
      <div class="table-scroll"><table class="metrics"><thead><tr><th scope="col">策略（BTC、ETH 欄為目前持倉）</th><th scope="col" class="r">報酬</th>
        <th scope="col" class="r">BTC</th><th scope="col" class="r">ETH</th></tr></thead>
        <tbody id="crypto-rows">${strats.map((lab) => { const x = cr.latest[lab] || {};
          return `<tr data-s="${lab[0]}"><td>${esc(lab)}</td><td class="r num ${signCls(x.return)}">${pct(x.return, 1)}</td>
            <td class="r num">${pos(x.BTC)}</td><td class="r num">${pos(x.ETH)}</td></tr>`; }).join("")}
        <tr><td>${HOLD}</td><td class="r num ${signCls(cr.series[HOLD].at(-1))}">${pct(cr.series[HOLD].at(-1), 1)}</td>
          <td class="r num">50%</td><td class="r num">50%</td></tr></tbody></table></div>
      <p class="caption">每個策略各約 6 萬台幣（BTC、ETH 各半），${esc(cr.days[0])} 起算；上面資產比例裡的加密貨幣是三者平均。${HOLD}是同一天把錢一半買 BTC、一半買 ETH 放著不動，當比較基準。</p>
    </section>`;

  const legend = buckets.map((b) => `<li><i style="background:${BUCKET_COLOR[b]}"></i>
    <span>${esc(d.labels[b])}</span><b class="num">${share(d.latest[b].value)}</b>
    <span class="muted num">${fmt(d.latest[b].value)}${unit}</span></li>`).join("");
  // per-bucket holdings: code on top, name under it, share of the bucket on the right
  const details = buckets.map((b) => {
    const rows = Object.entries(d.latest[b].detail).filter(([, v]) => Math.abs(v) > 1e-9).sort((x, y) => y[1] - x[1]);
    const sum = d.latest[b].value || 1;
    return `<div class="holdings"><h3 class="sub-h"><i style="background:${BUCKET_COLOR[b]}"></i>${esc(d.labels[b])}</h3><ul>${rows.map(([k, v]) => {
      const [code, ...rest] = k.split(" ");
      return `<li><div><b class="num">${esc(code)}</b>${rest.length ? `<span>${esc(rest.join(" "))}</span>` : ""}</div>
        <span class="num pct">${Math.round((v / sum) * 100)}%</span>${show ? `<span class="muted num">${fmt(v)}</span>` : ""}</li>`;
    }).join("")}</ul></div>`;
  }).join("");

  const mount = (root) => {
    donutChart(root.querySelector("#donut"), buckets.map((b) => ({ label: d.labels[b], color: BUCKET_COLOR[b], value: d.latest[b].value })),
      fmt(total), show ? "總資產（元）" : "總資產指數");
    const box = root.querySelector("#chart");
    const draw = () => {
      if (!box.isConnected) return;
      lineChart(box, [{ label: "總資產", color: "var(--ink)", points: pts(totals) },
        ...buckets.map((b) => ({ label: d.labels[b], color: BUCKET_COLOR[b], points: pts(d.series[b]) }))],
        { mode: "value", format: fmt });
    };
    const cbox = root.querySelector("#crypto-chart");
    const drawCrypto = () => {
      if (!cbox || !cbox.isConnected) return;
      const picked = (lab) => pick === "all" || lab.startsWith(pick);
      const series = [...strats.filter(picked).map((lab) => ({ label: lab, color: STRAT_COLOR[lab[0]], points: cpts(cr.series[lab]) })),
        { label: HOLD, color: "var(--ink-3)", dash: true, points: cpts(cr.series[HOLD]) }];
      lineChart(cbox, series, { mode: "value", format: retLabel });
      root.querySelector("#crypto-legend").innerHTML = series.map((x) =>
        `<span><i class="${x.dash ? "dash" : ""}" style="background:${x.color}"></i>${esc(x.label)}</span>`).join("");
      root.querySelectorAll("#crypto-rows tr[data-s]").forEach((tr) => (tr.hidden = !picked(tr.dataset.s)));
      root.querySelectorAll("[data-pick]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.pick === pick));
    };
    root.querySelector("#crypto-pick")?.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-pick]");
      if (!b) return;
      pick = b.dataset.pick;
      history.replaceState(null, "", pick === "all" ? "#/assets" : `#/assets?s=${pick}`);
      drawCrypto();
    });
    let width = box.clientWidth;
    draw();
    drawCrypto();
    const ro = new ResizeObserver(() => {
      if (box.isConnected && box.clientWidth && box.clientWidth !== width) { width = box.clientWidth; draw(); drawCrypto(); }
    });
    ro.observe(box);
    return () => ro.disconnect();
  };

  const note = show ? "金額為新台幣，加密貨幣以 MAX 的 USDT/TWD 匯率換算。"
    : `金額不公開：以第一天（${d.days[0]}）總資產 = 100 換算，比例與漲跌幅不變。`;
  return { title: "資產", mount, html: `${head}
    <section>
      <div class="chart-head"><h2>資產比例</h2><span class="muted small">${d.days.at(-1)}</span></div>
      <div class="alloc"><div class="donut" id="donut"></div><ul class="alloc-legend">${legend}</ul></div>
    </section>
    <section>
      <div class="chart-head"><h2>總資產走勢</h2><span class="num ${signCls(change)}">${pct(change, 1)}</span></div>
      <div class="chart" id="chart"></div>
      <div class="legend"><span><i style="background:var(--ink)"></i>總資產</span>${buckets.map((b) =>
        `<span><i style="background:${BUCKET_COLOR[b]}"></i>${esc(d.labels[b])}</span>`).join("")}</div>
      <p class="caption">${note}</p>
    </section>
    ${cryptoHtml}
    <section><h2>各部位持股</h2><div class="holdings-grid">${details}</div></section>` };
}

// ---------- router ----------

const routes = [
  [/^\/?$/, "overview", overview],
  [/^\/strategies$/, "strategies", strategies],
  [/^\/strategy\/([\w-]+)$/, "strategies", strategy],
  [/^\/reports$/, "reports", reports],
  [/^\/assets$/, "assets", assets],
];

let firstRender = true;
let cleanup = null;  // tear-down returned by the previous page's mount()

async function render() {
  const [path, qs = ""] = (location.hash.slice(1) || "/").split("?");
  let tab = "overview", page = overview, arg;
  for (const [re, t, fn] of routes) {
    const m = path.match(re);
    if (m) { tab = t; page = fn; arg = m[1]; break; }
  }
  document.querySelectorAll(".tabs a").forEach((a) =>
    a.dataset.tab === tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));

  cleanup?.();
  cleanup = null;
  app.setAttribute("aria-busy", "true");
  app.innerHTML = `<p class="empty">載入中…</p>`;
  try {
    const out = await page(arg, new URLSearchParams(qs));
    app.innerHTML = out.html;
    document.title = out.title === "總覽" ? "Trident" : `${out.title} · Trident`;
    cleanup = out.mount?.(app) || null;
  } catch (e) {
    document.title = "載入失敗 · Trident";
    app.innerHTML = `<div class="empty"><h1 tabindex="-1">資料暫時載入不了</h1>
      <p>可能是網路中斷，或網站正在更新。</p><p class="muted small">${esc(e.message)}</p>
      <button class="btn" id="retry">重新載入</button></div>`;
    document.getElementById("retry").addEventListener("click", () => { cache = {}; render(); });
  }
  app.removeAttribute("aria-busy");
  window.scrollTo(0, 0);
  // move focus to the new page's heading so keyboard and screen-reader users land on the content
  if (!firstRender) app.querySelector("h1")?.focus({ preventScroll: true });
  firstRender = false;
}

load("latest").then((l) => {
  document.getElementById("stamp").textContent = `網站更新 ${twTime(l.generated_at)}`;
}).catch(() => { document.getElementById("stamp").textContent = "更新時間無法取得"; });
window.addEventListener("hashchange", render);
render();
