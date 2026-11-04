import { buildIndex, classify, searchFoods } from "./classify.js";
import { prepareImage } from "./image.js";

const $app = document.getElementById("app");
const MODELS = [
  ["claude-opus-5-5", "Opus 5.5（最準，預設）"],
  ["claude-sonnet-5-5", "Sonnet 5.5（較便宜）"],
  ["claude-haiku-5-5", "Haiku 5.5（最便宜，可能較不準）"],
];
const LEVEL_UI = {
  high: { emoji: "🔴", title: "高腹敏", badge: "高" },
  conditional: { emoji: "🟡", title: "有條件", badge: "有條件" },
  low: { emoji: "🟢", title: "低腹敏", badge: "低" },
  unknown: { emoji: "⚪", title: "無法確定", badge: "未知" },
};

let index = null;
let state = { view: "home", detections: [], dish: "", previewUrl: "", loading: false, error: "", query: "", mode: "meal" };
let abortCtl = null;

// ---- storage ----
function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
const getKey = () => lsGet("fodmap.apiKey") || "";
const getModel = () => lsGet("fodmap.model") || MODELS[0][0];

// ---- helpers ----
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function go(view) { state.view = view; render(); window.scrollTo(0, 0); }

// ---- render ----
function render() {
  if (!index) { $app.innerHTML = `<p class="center muted">載入中…</p>`; return; }
  ({ home: renderHome, result: renderResult, search: renderSearch, settings: renderSettings })[state.view]();
}

function renderHome() {
  const noKey = !getKey();
  $app.innerHTML = `
    <div class="topbar"><span style="width:44px"></span><span></span>
      <button class="icon-btn" id="goSettings" aria-label="設定">⚙️</button></div>
    <div class="hero"><h1>腹敏拍拍</h1><p>拍下餐點，快速檢查 FODMAP 腹敏食材</p></div>
    ${noKey ? `<div class="card notice">尚未設定 Anthropic API Key，請先到 ⚙️ 設定輸入金鑰才能辨識照片。<button class="btn" id="noticeSettings">前往設定</button></div>` : ""}
    <button class="btn primary big" id="btnMeal">🍱 拍食物<span class="btn-sub">料理好的或生的食材都可以</span></button>
    <button class="link-btn" id="galMeal">或從相簿選擇</button>
    <button class="btn primary big" id="btnLabel">📋 拍成分標示<span class="btn-sub">包裝背面的成分表</span></button>
    <button class="link-btn" id="galLabel">或從相簿選擇</button>
    <button class="btn" id="btnSearch">🔍 查詢食物</button>`;
  $app.querySelector("#goSettings").onclick = () => go("settings");
  const ns = $app.querySelector("#noticeSettings"); if (ns) ns.onclick = () => go("settings");
  const pick = (id, mode, input) => { $app.querySelector(id).onclick = () => { state.mode = mode; document.getElementById(input).click(); }; };
  pick("#btnMeal", "meal", "cameraInput"); pick("#galMeal", "meal", "galleryInput");
  pick("#btnLabel", "label", "cameraInput"); pick("#galLabel", "label", "galleryInput");
  $app.querySelector("#btnSearch").onclick = () => { state.query = ""; go("search"); };
}

const srcTag = (f) => (f.source === "general" ? `<span class="tag src">補充</span>` : "");

function itemHtml(it, lv, i) {
  const showDesc = it.label && it.label !== it.name;
  const lowConf = it.confidence < 0.5;
  return `<div class="card item ${lv}">
    <div><span class="badge ${lv}">${LEVEL_UI[lv].emoji} ${LEVEL_UI[lv].badge}</span><span class="name">${esc(it.name)}</span>${srcTag(it)}
      ${it.visible === false ? `<span class="tag">推測</span>` : ""}${lowConf ? `<span class="tag">不確定</span>` : ""}</div>
    ${showDesc ? `<div class="desc">模型看到：${esc(it.label)}</div>` : ""}
    ${it.note ? `<div class="note">${esc(it.note)}</div>` : ""}
    ${it.reason ? `<div class="reason">${esc(it.reason)}</div>` : ""}
    <div class="actions">
      <button data-act="remove" data-lv="${lv}" data-i="${i}">✕ 不是這個</button>
      <button data-act="change" data-lv="${lv}" data-i="${i}">改成…</button>
    </div></div>`;
}

function verdictHtml(r) {
  const v = r.verdict;
  let main;
  if (v.level === "high") main = `⚠️ 這餐含 ${v.highNames.length} 項高腹敏食物：${v.highNames.map(esc).join("、")}`;
  else if (v.level === "conditional") main = `注意份量：${v.conditionalNames.map(esc).join("、")}`;
  else main = `✅ 未發現高腹敏食物`;
  const sub = v.unknownCount ? `<span class="sub">另有 ${v.unknownCount} 項無法確定</span>` : "";
  return `<div class="card verdict ${v.level}">${main}${sub}</div>`;
}

let lastResult = null;
function renderResult() {
  let body;
  if (state.loading) {
    body = `<div class="card center"><div class="spinner"></div><div>辨識中…</div>
      <button class="btn" id="cancel">取消</button></div>`;
  } else if (state.error) {
    body = `<div class="card error">${esc(state.error)}</div>
      <button class="btn" id="back2">返回</button>`;
  } else {
    const r = (lastResult = classify(state.detections, index));
    const empty = state.detections.length === 0;
    const groups = ["high", "conditional", "low", "unknown"].map((lv) =>
      r[lv].length ? `<h2 class="group-title">${LEVEL_UI[lv].emoji} ${LEVEL_UI[lv].title}</h2>${r[lv].map((it, i) => itemHtml(it, lv, i)).join("")}` : ""
    ).join("");
    body = empty
      ? `<div class="card empty">${esc(state.dish || "沒有辨識到任何項目")}</div>
      <button class="btn primary" id="retake">重新拍攝</button>
      <button class="btn" id="addManual">＋ 手動新增食材</button>`
      : `${state.dish ? `<p class="muted">${esc(state.dish)}</p>` : ""}${verdictHtml(r)}${groups}
      <button class="btn" id="addManual">＋ 手動新增食材</button>`;
  }
  $app.innerHTML = `
    <div class="topbar"><button class="icon-btn" id="back" aria-label="返回">←</button><span class="title">${state.mode === "label" ? "成分標示分析" : "辨識結果"}</span><span style="width:44px"></span></div>
    ${state.previewUrl ? `<img class="preview" src="${state.previewUrl}" alt="食物照片">` : ""}
    ${body}
    <p class="disclaimer">${state.mode === "label"
      ? "結果由 AI 讀取成分標示，僅供參考。成分排序代表含量多寡，排在後面的通常份量較少。請以實際包裝為準。"
      : "結果由 AI 辨識，僅供參考，無法看出醬料與調味細節，不能取代營養師或醫師建議。"}</p>`;
  $app.querySelector("#back").onclick = () => { cancelRun(); go("home"); };
  const c = $app.querySelector("#cancel"); if (c) c.onclick = () => { cancelRun(); go("home"); };
  const b2 = $app.querySelector("#back2"); if (b2) b2.onclick = () => go("home");
  const rt = $app.querySelector("#retake"); if (rt) rt.onclick = () => document.getElementById("cameraInput").click();
  const am = $app.querySelector("#addManual");
  if (am) am.onclick = () => openPicker((food) => { addDetection(food.id, "手動新增"); });
  $app.querySelectorAll("button[data-act]").forEach((btn) => {
    btn.onclick = () => {
      const it = lastResult[btn.dataset.lv][+btn.dataset.i];
      if (btn.dataset.act === "remove") removeFoodId(it);
      else openPicker((food) => changeFood(it, food.id));
    };
  });
}

// An item may stem from several detections (merged); match by food_id (or by label for unknown).
function matches(d, it) {
  if (it.food_id !== "unknown") return d.food_id === it.food_id;
  return !index.byId.has(d.food_id) && it.labels.includes((d.label || "").trim());
}
function removeFoodId(it) {
  state.detections = state.detections.filter((d) => !matches(d, it));
  render();
}
function changeFood(it, newId) {
  state.detections = state.detections.map((d) => (matches(d, it) ? { ...d, food_id: newId } : d));
  render();
}
function addDetection(id, reason) {
  const f = index.byId.get(id);
  state.detections = [...state.detections, { food_id: id, label: f.name, visible: true, confidence: 1, reason }];
  render();
}

// ---- picker modal ----
function foodRow(f) {
  const lv = LEVEL_UI[f.level] || LEVEL_UI.unknown;
  return `<div><span class="badge ${f.level}">${lv.emoji} ${lv.badge}</span><span class="name">${esc(f.name)}</span>${srcTag(f)}</div>
    ${f.note ? `<div class="muted">${esc(f.note)}</div>` : ""}`;
}
function openPicker(onPick) {
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `<div class="modal"><div class="topbar"><span class="title" style="text-align:left">選擇食物</span>
    <button class="icon-btn" id="mclose" aria-label="關閉">✕</button></div>
    <input type="search" id="mq" placeholder="輸入食物名稱，例如：蒜、麵包" autocomplete="off"><div id="mlist"></div></div>`;
  document.body.appendChild(back);
  const list = back.querySelector("#mlist");
  const close = () => back.remove();
  const draw = () => {
    const q = back.querySelector("#mq").value.trim();
    const foods = q ? searchFoods(q, index) : index.foods;
    list.innerHTML = foods.length ? foods.map((f) => `<button class="pick" data-id="${esc(f.id)}">${foodRow(f)}</button>`).join("")
      : `<p class="muted">找不到符合的食物</p>`;
    list.querySelectorAll(".pick").forEach((b) => (b.onclick = () => { close(); onPick(index.byId.get(b.dataset.id)); }));
  };
  back.querySelector("#mq").oninput = draw;
  back.querySelector("#mclose").onclick = close;
  back.onclick = (e) => { if (e.target === back) close(); };
  draw();
}

// ---- search view ----
function renderSearch() {
  $app.innerHTML = `
    <div class="topbar"><button class="icon-btn" id="back" aria-label="返回">←</button><span class="title">查詢食物</span><span style="width:44px"></span></div>
    <p class="muted small">標『補充』的項目不在你原本的表格裡，是一般 FODMAP 常識。</p>
    <input type="search" id="q" placeholder="輸入食物名稱或別名" autocomplete="off" value="${esc(state.query)}">
    <div id="list"></div>`;
  $app.querySelector("#back").onclick = () => go("home");
  const q = $app.querySelector("#q");
  const list = $app.querySelector("#list");
  const row = (f) => `<div class="card item ${f.level}">${foodRow(f)}</div>`;
  const draw = () => {
    state.query = q.value;
    const t = q.value.trim();
    if (t) {
      const r = searchFoods(t, index);
      list.innerHTML = r.length ? r.map(row).join("") : `<p class="muted">找不到符合的食物</p>`;
    } else {
      list.innerHTML = index.categories.map((c) => {
        const fs = index.foods.filter((f) => f.category === c);
        return fs.length ? `<h2>${esc(c)}</h2>${fs.map(row).join("")}` : "";
      }).join("");
    }
  };
  q.oninput = draw;
  draw();
}

// ---- settings view ----
function renderSettings() {
  $app.innerHTML = `
    <div class="topbar"><button class="icon-btn" id="back" aria-label="返回">←</button><span class="title">設定</span><span style="width:44px"></span></div>
    <label for="key">Anthropic API Key</label>
    <input type="password" id="key" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-…" value="${esc(getKey())}">
    <p class="muted">金鑰只存在這台手機的瀏覽器裡。請到 Anthropic Console 為這個 App 建立專用金鑰並設定每月花費上限。</p>
    <label for="model">模型</label>
    <select id="model">${MODELS.map(([v, n]) => `<option value="${v}" ${v === getModel() ? "selected" : ""}>${n}</option>`).join("")}</select>
    <button class="btn primary" id="test">測試連線</button>
    <div class="status" id="status" role="status"></div>`;
  const key = $app.querySelector("#key"), model = $app.querySelector("#model"), status = $app.querySelector("#status");
  key.oninput = () => lsSet("fodmap.apiKey", key.value.trim());
  model.onchange = () => lsSet("fodmap.model", model.value);
  $app.querySelector("#back").onclick = () => go("home");
  $app.querySelector("#test").onclick = async () => {
    lsSet("fodmap.apiKey", key.value.trim());
    if (!key.value.trim()) { status.className = "status err"; status.textContent = "請先輸入 API Key"; return; }
    status.className = "status"; status.textContent = "測試中…";
    try {
      const { testConnection } = await import("./claude.js");
      await testConnection({ apiKey: key.value.trim(), model: model.value });
      status.className = "status ok"; status.textContent = "✅ 連線成功";
    } catch (e) {
      status.className = "status err"; status.textContent = "❌ " + (e.message || "連線失敗");
    }
  };
}

// ---- analysis flow ----
function cancelRun() { if (abortCtl) { abortCtl.abort(); abortCtl = null; } state.loading = false; }

async function handleFile(file, mode = state.mode) {
  if (!file) return;
  const apiKey = getKey();
  if (!apiKey) { go("settings"); return; }
  cancelRun();
  abortCtl = new AbortController();
  const signal = abortCtl.signal;
  state = { ...state, mode, view: "result", detections: [], dish: "", previewUrl: "", loading: true, error: "" };
  render();
  try {
    const img = await prepareImage(file);
    if (signal.aborted) return;
    state.previewUrl = img.previewUrl;
    render();
    const { analyzeImage } = await import("./claude.js");
    const res = await analyzeImage({ apiKey, model: getModel(), base64: img.base64, mediaType: img.mediaType, foods: index.foods, signal, mode });
    if (signal.aborted) return;
    state.detections = res.items; state.dish = res.dish;
  } catch (e) {
    if (signal.aborted || e.name === "AbortError") return;
    state.error = e.message || "辨識失敗，請再試一次";
  }
  state.loading = false;
  abortCtl = null;
  if (state.view === "result") render();
}

for (const id of ["cameraInput", "galleryInput"]) {
  const el = document.getElementById(id);
  el.addEventListener("change", () => { const f = el.files[0]; el.value = ""; handleFile(f, state.mode); });
}

// ---- init ----
(async function init() {
  render();
  try {
    const res = await fetch("./data/fodmap.json");
    index = buildIndex(await res.json());
  } catch (_) {
    $app.innerHTML = `<div class="card error">無法載入食物資料，請重新整理。</div>`;
    return;
  }
  render();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
})();
