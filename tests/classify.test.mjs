import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildIndex, classify, classifyCholesterol, cholOf, searchFoods } from "../classify.js";

const db = JSON.parse(readFileSync(new URL("../data/fodmap.json", import.meta.url), "utf8"));
const cholDb = JSON.parse(readFileSync(new URL("../data/cholesterol.json", import.meta.url), "utf8"));
const index = buildIndex(db, cholDb);
const det = (food_id, extra = {}) => ({ food_id, label: food_id, visible: true, confidence: 0.9, reason: "", ...extra });

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("蒜 -> high", () => {
  const r = classify([det("garlic")], index);
  assert.equal(r.high.length, 1);
  assert.equal(r.high[0].food_id, "garlic");
});
test("高麗菜 -> low", () => {
  const r = classify([det("cabbage")], index);
  assert.equal(r.low.length, 1);
});
test("banana -> conditional (含 note)", () => {
  const r = classify([det("banana")], index);
  assert.equal(r.conditional.length, 1);
  assert.ok(r.conditional[0].note);
  assert.equal(r.verdict.level, "conditional");
});
test("未知 id -> unknown，不影響 level", () => {
  const r = classify([det("nope", { label: "神秘醬" }), det("cabbage")], index);
  assert.equal(r.unknown.length, 1);
  assert.equal(r.unknown[0].label, "神秘醬");
  assert.equal(r.verdict.level, "low");
  assert.equal(r.verdict.unknownCount, 1);
  assert.equal(classify([det("unknown", { label: "x" })], index).unknown.length, 1);
});
test("重複 id 合併", () => {
  const r = classify(
    [
      det("garlic", { label: "蒜末", visible: false, confidence: 0.4 }),
      det("garlic", { label: "蒜片", visible: true, confidence: 0.8 }),
      det("garlic", { label: "蒜末", confidence: 0.2 }),
    ],
    index
  );
  assert.equal(r.high.length, 1);
  assert.equal(r.high[0].confidence, 0.8);
  assert.equal(r.high[0].visible, true);
  assert.equal(r.high[0].label, "蒜末、蒜片");
});
test("全低 -> verdict low", () => {
  const r = classify([det("cabbage"), det("carrot")], index);
  assert.equal(r.verdict.level, "low");
  assert.deepEqual(r.verdict.highNames, []);
});
test("含 high -> verdict high 且 highNames 正確", () => {
  const r = classify([det("cabbage"), det("garlic")], index);
  assert.equal(r.verdict.level, "high");
  assert.deepEqual(r.verdict.highNames, [index.byId.get("garlic").name]);
});
test("searchFoods 蒜末 -> garlic", () => {
  assert.ok(searchFoods("蒜末", index).some((f) => f.id === "garlic"));
});
test("searchFoods 麵包 -> wheat_products", () => {
  assert.ok(searchFoods("麵包", index).some((f) => f.id === "wheat_products"));
});
test("searchFoods 不分大小寫與空字串", () => {
  assert.equal(searchFoods("", index).length, 0);
});

test("onion_powder -> high 且 source general", () => {
  const r = classify([det("onion_powder")], index);
  assert.equal(r.high.length, 1);
  assert.equal(r.high[0].source, "general");
});
test("garlic source table", () => {
  assert.equal(classify([det("garlic")], index).high[0].source, "table");
});
test("silken_tofu high; tofu low", () => {
  assert.equal(classify([det("silken_tofu")], index).high.length, 1);
  assert.equal(classify([det("tofu")], index).low.length, 1);
});
test("searchFoods 菊苣纖維 -> inulin", () => {
  assert.ok(searchFoods("菊苣纖維", index).some((f) => f.id === "inulin"));
});
test("searchFoods 毛豆 只有 edamame", () => {
  assert.deepEqual(searchFoods("毛豆", index).map((f) => f.id), ["edamame"]);
});
test("資料完整性", () => {
  const ids = db.foods.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const f of db.foods) {
    assert.ok(db.categories.includes(f.category), `${f.id} category ${f.category}`);
    assert.ok(["low", "high", "conditional"].includes(f.level), `${f.id} level ${f.level}`);
  }
});

test("膽固醇：egg -> high", () => {
  const r = classifyCholesterol([det("egg")], index);
  assert.equal(r.verdict.level, "high");
  assert.ok(r.verdict.highNames.some((n) => n.includes("蛋")));
});
test("膽固醇：egg_white -> none, verdict low", () => {
  const r = classifyCholesterol([det("egg_white")], index);
  assert.equal(r.none.length, 1);
  assert.equal(r.verdict.level, "low");
});
test("膽固醇：fresh_meat + cabbage -> moderate", () => {
  assert.equal(classifyCholesterol([det("fresh_meat"), det("cabbage")], index).verdict.level, "moderate");
});
test("膽固醇：butter -> high 且 satfat 含牛油", () => {
  const r = classifyCholesterol([det("butter")], index);
  assert.equal(r.verdict.level, "high");
  assert.ok(r.verdict.satfatNames.some((n) => n.includes("牛油")));
});
test("膽固醇：unknown 不影響 level", () => {
  const r = classifyCholesterol([det("unknown", { label: "神秘醬" }), det("cabbage")], index);
  assert.equal(r.verdict.unknownCount, 1);
  assert.equal(r.verdict.level, "low");
  assert.equal(r.unknown[0].name, "神秘醬");
});
test("膽固醇：重複 egg 只算一項", () => {
  assert.equal(classifyCholesterol([det("egg"), det("egg", { label: "荷包蛋" })], index).high.length, 1);
});
test("cholOf 查不到 -> unknown", () => {
  assert.equal(cholOf("nope", index).level, "unknown");
});
test("buildIndex 不給 cholDb 仍可用", () => {
  const idx = buildIndex(db);
  assert.equal(idx.chol.size, 0);
  assert.equal(classify([det("garlic")], idx).high.length, 1);
});
test("searchFoods 魚 -> fish；魷魚 -> squid", () => {
  assert.ok(searchFoods("魚", index).some((f) => f.id === "fish"));
  assert.ok(searchFoods("魷魚", index).some((f) => f.id === "squid"));
});
test("膽固醇資料完整性", () => {
  const ids = new Set(db.foods.map((f) => f.id));
  for (const id of ids) assert.ok(cholDb.foods[id], `missing chol ${id}`);
  for (const [id, c] of Object.entries(cholDb.foods)) {
    assert.ok(ids.has(id), `extra chol ${id}`);
    assert.ok(["high", "moderate", "low", "none"].includes(c.level), `${id} level ${c.level}`);
  }
  const seen = new Map();
  for (const f of db.foods) for (const n of new Set([f.name, ...(f.aliases || [])])) {
    assert.ok(!seen.has(n) || seen.get(n) === f.id, `名稱 ${n} 同時對應 ${seen.get(n)} 與 ${f.id}`);
    seen.set(n, f.id);
  }
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, "\n", e.message); }
}
console.log(`${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
