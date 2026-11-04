import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.1.0/+esm";

export const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["dish", "items"],
  properties: {
    dish: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["food_id", "label", "visible", "confidence", "reason"],
        properties: {
          food_id: { type: "string" },
          label: { type: "string" },
          visible: { type: "boolean" },
          confidence: { type: "number" },
          reason: { type: "string" },
        },
      },
    },
  },
};

const PROMPT_TEMPLATE = `你是協助腸躁症（IBS）患者的食物辨識助手。你會看到一張食物照片（可能是料理好的食物，也可能是還沒料理的生鮮食材），任務是找出照片中的食材，並把每一項對應到下方食物清單的 id。

食物清單（id | 名稱 | 別名）：
{FOOD_LIST}

規則：
1. 只負責辨識，不要判斷高低腹敏。
2. food_id 必須是清單中的 id。清單裡找不到對應的，food_id 填 "unknown"，label 寫你看到的食物名稱。
3. 一道料理要拆成食材。例如「蒜炒高麗菜」→ cabbage + garlic；「火腿蛋吐司」→ wheat_products + processed_meat + egg。
4. 看不到但這類料理通常會放的食材（例如台式炒青菜的蒜、紅燒料理的洋蔥或蔥白、滷味的醬汁、勾芡）也要列出，visible 設為 false，reason 說明為什麼推測。只推測常見的，不要過度猜測。
5. 醬料、湯底、沾醬若無法判斷成分，列為 unknown，label 寫例如「醬汁（成分不明）」。
6. 香蕉請在 reason 註明看起來成熟度（偏綠／黃有斑點）；奇異果、地瓜、馬鈴薯、芋頭、玉米、燕麥、紅茶請在 reason 估計份量。
7. 青蔥若能分辨，綠色部分用 scallion_green，白色部分用 scallion_white；無法分辨時兩者都列，visible 依實際狀況。
8. confidence 為 0 到 1 的數字。
9. dish 用一句話描述這是什麼餐點。若照片中沒有食物，items 回傳空陣列，dish 寫「照片中沒有看到食物」。
10. 所有文字使用繁體中文。`;

const LABEL_TEMPLATE = `你是協助腸躁症（IBS）患者閱讀食品成分標示的助手。你會看到一張包裝食品成分標示的照片，任務是讀出成分，並把每一項對應到下方食物清單的 id。

食物清單（id | 名稱 | 別名）：
{FOOD_LIST}

規則：
1. 只負責讀取與對應，不要判斷高低腹敏。
2. 逐項讀出「成分」或「原料」欄位中的每一個成分。營養標示（熱量、蛋白質等數字）不用管。
3. 每個成分對應到清單中最接近的 id。例如：小麥粉、麵粉、麩質、大麥麥芽 → wheat_products；洋蔥粉 → onion_powder；脫脂奶粉 → milk_powder；菊苣纖維 → inulin；果糖、高果糖糖漿 → hfcs。
4. 括號內的子成分也要拆開。例如「調味粉（鹽、洋蔥粉、大蒜粉）」→ basic_seasoning + onion_powder + garlic_powder。
5. 對應不到清單的成分（例如香料、色素、防腐劑、乳化劑、維生素）：只有在它可能含高腹敏成分時才列為 unknown；明顯無關的添加物（如維生素、色素、防腐劑）不用列出。「天然香料」「調味料」「香辛料」這類不明確的寫法要列為 unknown，因為可能含洋蔥或大蒜。
6. 成分標示依含量由多到少排列。reason 要寫出這個成分排在第幾項、共幾項，例如「第 2 項／共 12 項，含量多」或「第 11 項／共 12 項，含量少」。
7. 這些是讀出來的字，visible 一律為 true。label 寫標示上的原文。
8. confidence：字清楚就高；字模糊、被遮住或你在猜就低於 0.5。
9. dish 寫產品名稱（若看得到），否則寫「包裝食品」。
10. 如果照片中看不到成分表，或字太模糊無法讀，items 回傳空陣列，dish 寫「看不清楚成分標示，請靠近一點、對焦後重拍」。
11. 所有文字使用繁體中文。`;

export function buildSystemPrompt(foods, mode = "meal") {
  const list = foods
    .map((f) => `${f.id} | ${f.name} | ${(f.aliases || []).join("、")}`)
    .join("\n");
  return (mode === "label" ? LABEL_TEMPLATE : PROMPT_TEMPLATE).replace("{FOOD_LIST}", list);
}

export function toChineseError(err) {
  if (err && (err.name === "AbortError" || err instanceof Anthropic.APIUserAbortError)) {
    const e = new Error("已取消");
    e.name = "AbortError";
    return e;
  }
  if (err instanceof Anthropic.AuthenticationError) return new Error("API Key 無效");
  if (err instanceof Anthropic.RateLimitError) return new Error("請求太頻繁或額度用完，稍後再試");
  if (err instanceof Anthropic.APIConnectionError) return new Error("無法連線，請檢查網路");
  if (err instanceof Anthropic.APIError) {
    if (err.status === 401) return new Error("API Key 無效");
    if (err.status === 429) return new Error("請求太頻繁或額度用完，稍後再試");
    if (err.status >= 500) return new Error("Anthropic 服務暫時忙碌，請稍後再試");
    return new Error(`請求失敗（${err.status}）：${err.message}`);
  }
  if (err instanceof TypeError) return new Error("無法連線，請檢查網路");
  return err instanceof Error ? err : new Error(String(err));
}

export async function analyzeImage({ apiKey, model, base64, mediaType, foods, signal, mode = "meal" }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const params = {
    model,
    max_tokens: 4000,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: RESULT_SCHEMA },
    },
    system: buildSystemPrompt(foods, mode),
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: mode === "label" ? "請讀出這張成分標示並逐項對應。" : "請辨識這張照片中的食物與食材。" },
        ],
      },
    ],
  };
  // Opus 5.5 與 Sonnet 5.5 加上伺服器端拒答 fallback；Haiku 5.5 不支援
  if (model !== "claude-haiku-5-5") {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  let res;
  try {
    res = await client.beta.messages.create(params, { signal });
  } catch (err) {
    throw toChineseError(err);
  }
  if (res.stop_reason === "refusal") throw new Error("模型拒絕處理這張照片，請換一張再試");
  if (res.stop_reason === "max_tokens") throw new Error("回應被截斷，請再試一次");
  const block = (res.content || []).find((b) => b.type === "text");
  if (!block) throw new Error("模型沒有回傳內容，請再試一次");
  let data;
  try {
    data = JSON.parse(block.text);
  } catch (_) {
    throw new Error("無法解析模型回應，請再試一次");
  }
  return { items: Array.isArray(data.items) ? data.items : [], dish: data.dish || "" };
}

// 測試連線：極小的文字請求
export async function testConnection({ apiKey, model }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  try {
    await client.messages.create({
      model,
      max_tokens: 16,
      messages: [{ role: "user", content: "回覆「好」" }],
    });
  } catch (err) {
    throw toChineseError(err);
  }
}
