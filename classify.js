// 查表分類：純函式，無 DOM
export function buildIndex(db, cholDb) {
  const foods = db.foods || [];
  const byId = new Map(foods.map((f) => [f.id, f]));
  const chol = new Map(Object.entries((cholDb && cholDb.foods) || {}).map(([id, c]) => [id, { level: c.level, note: c.note || "", satfat: !!c.satfat }]));
  return {
    byId, foods, categories: db.categories || [], levels: db.levels || {},
    chol, cholLevels: (cholDb && cholDb.levels) || {}, cholSource: (cholDb && cholDb.source) || "", cholThresholds: (cholDb && cholDb.thresholds) || "",
  };
}

function mergeDetections(detections) {
  const merged = new Map();
  const order = [];
  for (const d of detections || []) {
    if (!d) continue;
    const id = typeof d.food_id === "string" ? d.food_id : "unknown";
    const label = (d.label || "").trim();
    const conf = typeof d.confidence === "number" ? d.confidence : 0;
    const key = id === "unknown" ? `unknown:${label}` : id;
    let m = merged.get(key);
    if (!m) {
      m = { food_id: id, labels: [], visible: false, confidence: conf, reasons: [] };
      merged.set(key, m);
      order.push(key);
    }
    if (label && !m.labels.includes(label)) m.labels.push(label);
    if (conf > m.confidence) m.confidence = conf;
    if (d.visible === true) m.visible = true;
    const r = (d.reason || "").trim();
    if (r && !m.reasons.includes(r)) m.reasons.push(r);
  }
  return order.map((k) => merged.get(k));
}

export function classify(detections, index) {
  const out = { high: [], conditional: [], low: [], unknown: [] };
  for (const m of mergeDetections(detections)) {
    const food = index.byId.get(m.food_id);
    const base = {
      food_id: m.food_id,
      label: m.labels.join("、"),
      labels: m.labels,
      visible: m.visible,
      confidence: m.confidence,
      reason: m.reasons.join("；"),
      source: (food && food.source) || "table",
    };
    if (food && out[food.level] && food.level !== "unknown") {
      out[food.level].push({ ...base, name: food.name, note: food.note || "", level: food.level });
    } else {
      out.unknown.push({ ...base, food_id: "unknown", name: base.label || "未知食物", note: "", level: "unknown", source: "table" });
    }
  }
  out.verdict = {
    level: out.high.length ? "high" : out.conditional.length ? "conditional" : "low",
    highNames: out.high.map((i) => i.name),
    conditionalNames: out.conditional.map((i) => i.name),
    unknownCount: out.unknown.length,
  };
  return out;
}

export function cholOf(foodId, index) {
  return index.chol.get(foodId) || { level: "unknown", note: "", satfat: false };
}

export function classifyCholesterol(detections, index) {
  const out = { high: [], moderate: [], low: [], none: [], unknown: [] };
  for (const m of mergeDetections(detections)) {
    const food = index.byId.get(m.food_id);
    const label = m.labels.join("、");
    const c = food ? cholOf(m.food_id, index) : { level: "unknown", note: "", satfat: false };
    const lv = out[c.level] ? c.level : "unknown";
    out[lv].push({ food_id: food ? m.food_id : "unknown", name: food ? food.name : label || "未知食物", label, level: lv, note: c.note, satfat: c.satfat });
  }
  const names = (a) => a.map((i) => i.name);
  out.verdict = {
    level: out.high.length ? "high" : out.moderate.length ? "moderate" : "low",
    highNames: names(out.high),
    moderateNames: names(out.moderate),
    satfatNames: names(["high", "moderate", "low", "none", "unknown"].flatMap((k) => out[k]).filter((i) => i.satfat)),
    unknownCount: out.unknown.length,
  };
  return out;
}

export function searchFoods(query, index) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];
  return index.foods.filter(
    (f) =>
      f.name.toLowerCase().includes(q) ||
      (f.aliases || []).some((a) => a.toLowerCase().includes(q))
  );
}
