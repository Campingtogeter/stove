// ... existing code ...
const MEMORY_CACHE = new Map();
const MAX_CACHE_ITEMS = 250;

function parseCmNumber(val) {
  if (typeof val === "number" && Number.isFinite(val)) {
    if (val >= 1000) return Math.round(val / 10);
    if (val > 0 && val < 10) return Math.round(val * 100);
    return Math.round(val);
  }
  const str = String(val || "").trim().toLowerCase();
  const m = str.match(/(\d+(?:\.\d+)?)\s*(mm|cm|m)?/);
  if (!m) return NaN;
  let n = parseFloat(m[1]);
  const unit = m[2] || "";
  if (unit === "mm" || (!unit && n >= 1000)) n = n / 10;
  else if (unit === "m" || (!unit && n > 0 && n < 10)) n = n * 100;
  return Math.round(n);
}

function sanitizeNum(val, min, max, fallback) {
  const n = parseCmNumber(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function extractJsonPayload(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  // Try object first, then array
  const objStart = cleaned.indexOf("{");
  const objEnd = cleaned.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) {
    try {
      return JSON.parse(cleaned.slice(objStart, objEnd + 1));
    } catch (e) {}
  }
  const arrStart = cleaned.indexOf("[");
  const arrEnd = cleaned.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd > arrStart) {
    try {
      return { found: true, candidates: JSON.parse(cleaned.slice(arrStart, arrEnd + 1)) };
    } catch (e) {}
  }
  return null;
}

function normalizeCandidate(raw, fallbackQuery) {
  if (!raw || typeof raw !== "object") return null;
  const rawH = raw.peakHeight ?? raw.height ?? raw.centerHeight ?? raw.h;
  const parsedH = parseCmNumber(rawH);
  if (!Number.isFinite(parsedH) || parsedH < 100 || parsedH > 450) return null;

  const peakHeight = sanitizeNum(parsedH, 130, 350, 210);
  const tentWidth = sanitizeNum(raw.tentWidth ?? raw.width ?? raw.w, 200, 620, 340);
  const tentLength = sanitizeNum(raw.tentLength ?? raw.length ?? raw.l, 200, 900, 420);
  const allowedShapes = ["dome", "tunnel", "tipi", "bell", "cabin"];
  const rawShape = String(raw.shape || "").toLowerCase();
  const shape = allowedShapes.includes(rawShape) ? rawShape : "dome";
  const allowedPaths = ["straight", "elbow45", "elbow90"];
  const rawPath = String(raw.defaultPath || "").toLowerCase();
  const defaultPath = allowedPaths.includes(rawPath)
    ? rawPath
    : (shape === "tunnel" ? "elbow90" : (shape === "tipi" || shape === "bell" ? "straight" : "elbow45"));

  const defaultJack = Math.max(100, Math.min(peakHeight - 15, Math.round((peakHeight * 0.72) / 5) * 5));
  const rawJack = raw.jackHeight ?? raw.stoveJackHeight ?? raw.jh;
  const parsedJack = parseCmNumber(rawJack);
  const jackHeight = Number.isFinite(parsedJack) && parsedJack >= 90 && parsedJack <= peakHeight - 5
    ? Math.round(parsedJack)
    : defaultJack;

  return {
    brand: String(raw.brand || "").trim().slice(0, 40),
    name: String(raw.name || fallbackQuery).trim().slice(0, 80),
    peakHeight,
    tentWidth,
    tentLength,
    jackHeight,
    jackEstimated: raw.jackEstimated !== false && !Number.isFinite(parsedJack),
    shape,
    defaultPath,
    summary: String(raw.summary || `설치 크기 약 ${tentLength}×${tentWidth}×${peakHeight}cm`).trim().slice(0, 140)
  };
}

async function callGeminiGrounded(apiKey, modelName, prompt) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.1
    }
  };
  return fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

module.exports = async function handler(req, res) {
// ... existing code ...
  if (!apiKey) {
    return res.status(503).json({
      ok: false,
      code: "NO_API_KEY",
      error: "Vercel 환경변수에 GEMINI_API_KEY가 아직 설정되지 않았습니다."
    });
  }

  const primaryModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const fallbackModels = ["gemini-2.5-flash", "gemini-2.0-flash"].filter((m) => m !== primaryModel);
  const modelsToTry = [primaryModel, ...fallbackModels];

  const prompt = [
    `구글 웹 검색을 사용해 "${query}" 텐트(또는 쉘터)의 공식 설치 규격(가로, 세로, 최고 높이 cm)을 찾아주세요.`,
    `한국 네이버 쇼핑, 다나와, 캠핑연구소, 공식 브랜드몰, 캠핑 블로그/유튜브 제원을 폭넓게 검색하세요. 모델명이 한글/영문 혼용이거나 약칭이어도 실제 판매 중인 캠핑 텐트 모델을 찾아 매칭하세요.`,
    `정확히 1개 모델이면 candidates 배열에 1개만, 시리즈나 사이즈 버전(M/L, 13.6/17.2 등)이 여러 개면 인기 순으로 최대 5개까지 담아주세요.`,
    `반드시 아래 JSON 객체만 출력하세요 (코드블록이나 설명 문장 없이 순수 JSON만 출력):`,
    `{`,
    `  "found": true,`,
    `  "candidates": [`,
    `    {`,
    `      "brand": "브랜드명",`,
    `      "name": "공식 모델명",`,
    `      "peakHeight": 210,`,
    `      "tentWidth": 350,`,
    `      "tentLength": 600,`,
    `      "jackHeight": 150,`,
    `      "jackEstimated": true,`,
    `      "shape": "dome",`,
    `      "defaultPath": "elbow45",`,
    `      "summary": "설치크기 600×350×210cm"`,
    `    }`,
    `  ]`,
    `}`,
    `주의: peakHeight, tentWidth, tentLength, jackHeight는 반드시 cm 단위의 정수 숫자로 적으세요(mm는 10으로 나누고 m는 100을 곱함). shape는 dome, tunnel, tipi, bell, cabin 중 하나, defaultPath는 straight, elbow45, elbow90 중 하나만 사용하세요. 진짜 텐트를 전혀 찾을 수 없을 때만 {"found": false, "candidates": []}를 반환하세요.`
  ].join("\n");

  try {
    let apiRes = null;
    let lastErrDetail = "";
    for (const modelName of modelsToTry) {
      apiRes = await callGeminiGrounded(apiKey, modelName, prompt);
      if (apiRes.ok) break;
      lastErrDetail = await apiRes.text().catch(() => "");
    }

    if (!apiRes || !apiRes.ok) {
      return res.status(502).json({
        ok: false,
        code: "UPSTREAM_ERROR",
        error: "AI 웹 검색 API 응답 오류가 발생했습니다.",
        detail: lastErrDetail.slice(0, 200)
      });
    }

    const data = await apiRes.json();
    const candidate = data && data.candidates && data.candidates[0];
    const parts = candidate && candidate.content && candidate.content.parts ? candidate.content.parts : [];
    const text = parts.map((p) => p.text || "").join("\n");
    const parsed = extractJsonPayload(text);

    const rawList = parsed && Array.isArray(parsed.candidates)
      ? parsed.candidates
      : (parsed && (parsed.peakHeight || parsed.height) ? [parsed] : []);

    const candidates = rawList
      .map((item) => normalizeCandidate(item, query))
      .filter(Boolean)
      .slice(0, 5);

    if (!parsed || parsed.found === false || candidates.length === 0) {
      return res.status(404).json({
        ok: false,
        code: "NOT_FOUND",
        error: `"${query}"의 공식 텐트 규격을 찾지 못했습니다.`
      });
    }
// ... existing code ...