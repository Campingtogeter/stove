// Vercel Serverless Function: api/tent-search.js
// 배포 위치: Vercel 프로젝트 루트의 api/tent-search.js
// 필수 환경변수: Vercel Project Settings -> Environment Variables -> GEMINI_API_KEY

const MEMORY_CACHE = new Map();
const MAX_CACHE_ITEMS = 200;

function sanitizeNum(val, min, max, fallback) {
  const n = Math.round(Number(val));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function extractJsonObject(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  // CORS headers (same-origin + Vercel preview support)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const rawQuery = req.method === "POST"
    ? (req.body && req.body.query ? String(req.body.query) : "")
    : (req.query && req.query.q ? String(req.query.q) : "");

  const query = rawQuery.trim().slice(0, 80);
  if (!query || query.length < 2) {
    return res.status(400).json({ ok: false, error: "검색할 텐트 모델명을 2글자 이상 입력해 주세요." });
  }

  const cacheKey = query.toLowerCase().replace(/\s+/g, " ");
  if (MEMORY_CACHE.has(cacheKey)) {
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({ ...MEMORY_CACHE.get(cacheKey), cached: true });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      ok: false,
      code: "NO_API_KEY",
      error: "Vercel 환경변수에 GEMINI_API_KEY가 아직 설정되지 않았습니다."
    });
  }

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const prompt = [
    `한국 캠핑 시장(네이버 쇼핑, 다나와, 브랜드 공식 홈페이지, 해외 공식 사이트)에서 "${query}" 텐트(또는 쉘터)의 공식 설치 규격(cm)을 웹 검색으로 확인해 주세요.`,
    `반드시 아래 JSON 형식만 단독으로 출력하세요(설명 문장이나 마크다운 코드블록 없이 JSON 객체만 출력):`,
    `{`,
    `  "found": true 또는 false,`,
    `  "brand": "브랜드명",`,
    `  "name": "공식 모델명",`,
    `  "peakHeight": 최고높이_cm_정수,`,
    `  "tentWidth": 폭_cm_정수,`,
    `  "tentLength": 길이_cm_정수,`,
    `  "jackHeight": 홀잭높이_cm_정수_없으면_최고높이의_72퍼센트_추정정수,`,
    `  "jackEstimated": 공식홀잭높이_미확인시_true_확인시_false,`,
    `  "shape": "dome" | "tunnel" | "tipi" | "bell" | "cabin",`,
    `  "defaultPath": "straight" | "elbow45" | "elbow90",`,
    `  "summary": "확인된 공식 설치 규격 한 줄 요약 (예: 설치크기 640×350×215cm)"`,
    `}`,
    `규칙: 텐트가 아니거나 실제 규격을 찾을 수 없으면 {"found": false}만 반환하세요. mm 단위는 반드시 cm로 변환하세요.`
  ].join("\n");

  try {
    const apiRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.1
        }
      })
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text().catch(() => "");
      return res.status(502).json({
        ok: false,
        code: "UPSTREAM_ERROR",
        error: "AI 웹 검색 응답을 가져오지 못했습니다.",
        detail: errText.slice(0, 200)
      });
    }

    const data = await apiRes.json();
    const candidate = data && data.candidates && data.candidates[0];
    const parts = candidate && candidate.content && candidate.content.parts ? candidate.content.parts : [];
    const text = parts.map((p) => p.text || "").join("\n");
    const parsed = extractJsonObject(text);

    if (!parsed || parsed.found !== true || !parsed.peakHeight) {
      return res.status(404).json({
        ok: false,
        code: "NOT_FOUND",
        error: `"${query}"의 공식 텐트 높이를 찾지 못했습니다.`
      });
    }

    const peakHeight = sanitizeNum(parsed.peakHeight, 130, 350, 210);
    const tentWidth = sanitizeNum(parsed.tentWidth, 200, 620, 340);
    const tentLength = sanitizeNum(parsed.tentLength, 200, 900, 420);
    const allowedShapes = ["dome", "tunnel", "tipi", "bell", "cabin"];
    const shape = allowedShapes.includes(parsed.shape) ? parsed.shape : "dome";
    const allowedPaths = ["straight", "elbow45", "elbow90"];
    const defaultPath = allowedPaths.includes(parsed.defaultPath)
      ? parsed.defaultPath
      : (shape === "tunnel" ? "elbow90" : (shape === "tipi" || shape === "bell" ? "straight" : "elbow45"));

    const defaultJack = Math.max(100, Math.min(peakHeight - 15, Math.round((peakHeight * 0.72) / 5) * 5));
    const jackHeight = sanitizeNum(parsed.jackHeight, 95, Math.max(100, peakHeight - 10), defaultJack);

    // Extract verified grounding source URL if present
    const chunks = candidate && candidate.groundingMetadata && Array.isArray(candidate.groundingMetadata.groundingChunks)
      ? candidate.groundingMetadata.groundingChunks
      : [];
    const webSources = chunks
      .filter((c) => c && c.web && c.web.uri)
      .slice(0, 3)
      .map((c) => ({ title: c.web.title || "검색 출처", url: c.web.uri }));

    const resultPayload = {
      ok: true,
      tent: {
        brand: String(parsed.brand || "").trim().slice(0, 40),
        name: String(parsed.name || query).trim().slice(0, 80),
        peakHeight,
        tentWidth,
        tentLength,
        jackHeight,
        jackEstimated: Boolean(parsed.jackEstimated !== false),
        shape,
        defaultPath,
        summary: String(parsed.summary || `설치 크기 약 ${tentLength}×${tentWidth}×${peakHeight}cm`).trim().slice(0, 140)
      },
      sources: webSources
    };

    if (MEMORY_CACHE.size >= MAX_CACHE_ITEMS) {
      const firstKey = MEMORY_CACHE.keys().next().value;
      MEMORY_CACHE.delete(firstKey);
    }
    MEMORY_CACHE.set(cacheKey, resultPayload);

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json(resultPayload);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      code: "SERVER_ERROR",
      error: "AI 검색 처리 중 오류가 발생했습니다."
    });
  }
}