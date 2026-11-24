// Vercel Serverless Function: api/tent-search.js
// 배포 위치: Vercel 프로젝트 루트의 api/tent-search.js
// 필수 환경변수: Vercel Project Settings -> Environment Variables -> GEMINI_API_KEY

const MEMORY_CACHE = new Map();
const MAX_CACHE_ITEMS = 250;
let CACHED_WORKING_MODEL = null;

function parseCmNumber(val) {
  if (typeof val === "number" && Number.isFinite(val)) {
    if (val >= 1000) return Math.round(val / 10);
    if (val > 0 && val < 10) return Math.round(val * 100);
    return Math.round(val);
  }
  const str = String(val || "").trim().toLowerCase();
  const m = str.match(/(\d+(?:\.\d+)?)\s*(mm|cm|m|ft|feet|in|inch)?/);
  if (!m) return NaN;
  let n = parseFloat(m[1]);
  const unit = m[2] || "";
  if (unit === "mm" || (!unit && n >= 1000)) n = n / 10;
  else if (unit === "m" || (!unit && n > 0 && n < 10)) n = n * 100;
  else if (unit === "ft" || unit === "feet") n = n * 30.48;
  else if (unit === "in" || unit === "inch") n = n * 2.54;
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

// JSON 형식이 깨졌을 때 그라운딩 텍스트에서 직접 규격을 추출하는 안전망
function extractFallbackFromProse(text, query) {
  const s = String(text || "");
  if (!s) return null;
  let peakH = NaN;
  let widthCm = NaN;
  let lengthCm = NaN;

  const hMatch = s.match(/(?:height|높이|전고|천장고|peakHeight)[^\d]{0,20}(\d+(?:\.\d+)?)\s*(cm|mm|m|ft)/i);
  if (hMatch) peakH = parseCmNumber(`${hMatch[1]} ${hMatch[2]}`);

  const dim3 = s.match(/(\d+(?:\.\d+)?)\s*(?:cm|mm|m)?\s*[xX×*]\s*(\d+(?:\.\d+)?)\s*(?:cm|mm|m)?\s*[xX×*]\s*(?:\(?[hH]\)?\s*)?(\d+(?:\.\d+)?)\s*(cm|mm|m)?/);
  if (dim3) {
    const unit = dim3[4] || "";
    const a = parseCmNumber(`${dim3[1]} ${unit}`);
    const b = parseCmNumber(`${dim3[2]} ${unit}`);
    const c = parseCmNumber(`${dim3[3]} ${unit}`);
    if (!Number.isFinite(peakH) && c >= 110 && c <= 380) peakH = c;
    if (a >= 150 && b >= 150) {
      widthCm = Math.min(a, b);
      lengthCm = Math.max(a, b);
    }
  }

  if (!Number.isFinite(peakH) || peakH < 110 || peakH > 400) return null;

  const lower = (s + " " + query).toLowerCase();
  let shape = "dome";
  if (/tipi|티피|원폴/.test(lower)) shape = "tipi";
  else if (/bell|벨텐트/.test(lower)) shape = "bell";
  else if (/tunnel|터널|리빙쉘|2룸/.test(lower)) shape = "tunnel";
  else if (/cabin|캐빈|에어텐트/.test(lower)) shape = "cabin";

  return {
    brand: "",
    name: query,
    peakHeight: peakH,
    tentWidth: Number.isFinite(widthCm) ? widthCm : 340,
    tentLength: Number.isFinite(lengthCm) ? lengthCm : 340,
    jackEstimated: true,
    shape
  };
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

async function callGeminiApi(apiKey, modelName, prompt, useGoogleSearch) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1
    }
  };
  if (useGoogleSearch) {
    body.tools = [{ google_search: {} }];
  } else {
    body.generationConfig.responseMimeType = "application/json";
  }
  return fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function discoverAvailableFlashModels(apiKey) {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
    if (!res.ok) return [];
    const data = await res.json();
    const list = Array.isArray(data && data.models) ? data.models : [];
    return list
      .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
      .map((m) => String(m.name || "").replace(/^models\//, ""))
      .filter((id) => /^gemini-/i.test(id) && /flash/i.test(id) && !/tts|image|audio|live|omni|embedding/i.test(id))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .slice(0, 4);
  } catch (e) {
    return [];
  }
}

function parseGeminiCandidates(data, query) {
  const candidate = data && data.candidates && data.candidates[0];
  const parts = candidate && candidate.content && candidate.content.parts ? candidate.content.parts : [];
  const text = parts.map((p) => p.text || "").join("\n");
  const parsed = extractJsonPayload(text);

  let rawList = [];
  if (parsed && Array.isArray(parsed.candidates)) {
    rawList = parsed.candidates;
  } else if (parsed && (parsed.peakHeight || parsed.height)) {
    rawList = [parsed];
  } else {
    const proseFallback = extractFallbackFromProse(text, query);
    if (proseFallback) rawList = [proseFallback];
  }

  const candidates = rawList
    .map((item) => normalizeCandidate(item, query))
    .filter(Boolean)
    .slice(0, 5);

  const chunks = candidate && candidate.groundingMetadata && Array.isArray(candidate.groundingMetadata.groundingChunks)
    ? candidate.groundingMetadata.groundingChunks
    : [];
  const sources = chunks
    .filter((c) => c && c.web && c.web.uri)
    .slice(0, 3)
    .map((c) => ({ title: c.web.title || "검색 출처", url: c.web.uri }));

  return { candidates, sources, rawText: text };
}

module.exports = async function handler(req, res) {
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
    return res.status(400).json({ ok: false, code: "INVALID_QUERY", error: "검색할 텐트 모델명을 2글자 이상 입력해 주세요." });
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

  const primaryModel = process.env.GEMINI_MODEL || CACHED_WORKING_MODEL || "gemini-3.8-flash";
  let modelsToTry = Array.from(new Set([
    primaryModel,
    "gemini-3.8-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
    "gemini-3.1-flash-lite"
  ].filter(Boolean)));

  const prompt = [
    `Find the official tent specifications (peakHeight, tentWidth, tentLength in cm) for the camping tent "${query}".`,
    `Search official brand websites (e.g. pomoly.com, pomoly.co.kr, minimalworks, helsport, snowpeak, etc.), Korean Naver Shopping, Danawa, and camping review sites.`,
    `If the model has closely related variants (e.g. Dome X4 and Dome X4 Pro, or M/L sizes), return up to 5 popular variants in "candidates". If it is a single model, return 1 item.`,
    `Convert feet/inches/mm/m to integer centimeters (e.g. 5.4 ft = 165 cm, 3.6 m = 360 cm).`,
    `Output ONLY valid JSON with no markdown fences or extra commentary:`,
    `{`,
    `  "found": true,`,
    `  "candidates": [`,
    `    {`,
    `      "brand": "POMOLY",`,
    `      "name": "Dome X4",`,
    `      "peakHeight": 165,`,
    `      "tentWidth": 320,`,
    `      "tentLength": 320,`,
    `      "jackHeight": 120,`,
    `      "jackEstimated": true,`,
    `      "shape": "dome",`,
    `      "defaultPath": "straight",`,
    `      "summary": "설치크기 약 320×320×165cm (면적 8㎡)"`,
    `    }`,
    `  ]`,
    `}`,
    `Allowed shape: dome, tunnel, tipi, bell, cabin. Allowed defaultPath: straight, elbow45, elbow90. Only return {"found": false, "candidates": []} if "${query}" is not a real tent.`
  ].join("\n");

  try {
    let bestCandidates = [];
    let bestSources = [];
    let lastErrDetail = "";
    let anyHttpOk = false;

    // 1단계: Google Search 그라운딩으로 실시간 웹 검색 시도
    for (const modelName of modelsToTry) {
      const apiRes = await callGeminiApi(apiKey, modelName, prompt, true);
      if (!apiRes.ok) {
        lastErrDetail = await apiRes.text().catch(() => `HTTP ${apiRes.status}`);
        continue;
      }
      anyHttpOk = true;
      CACHED_WORKING_MODEL = modelName;
      const data = await apiRes.json();
      const parsed = parseGeminiCandidates(data, query);
      if (parsed.candidates.length > 0) {
        bestCandidates = parsed.candidates;
        bestSources = parsed.sources;
        break;
      }
    }

    // 1.5단계: 기본 모델이 모두 404 등 실패한 경우 API 키에서 활성 Flash 모델 자동 탐색
    if (!anyHttpOk) {
      const discovered = await discoverAvailableFlashModels(apiKey);
      const extraModels = discovered.filter((m) => !modelsToTry.includes(m));
      if (extraModels.length > 0) {
        modelsToTry = [...modelsToTry, ...extraModels];
        for (const modelName of extraModels) {
          const apiRes = await callGeminiApi(apiKey, modelName, prompt, true);
          if (!apiRes.ok) {
            lastErrDetail = await apiRes.text().catch(() => `HTTP ${apiRes.status}`);
            continue;
          }
          anyHttpOk = true;
          CACHED_WORKING_MODEL = modelName;
          const data = await apiRes.json();
          const parsed = parseGeminiCandidates(data, query);
          if (parsed.candidates.length > 0) {
            bestCandidates = parsed.candidates;
            bestSources = parsed.sources;
            break;
          }
        }
      }
    }

    // 2단계: 그라운딩 호출 실패 또는 JSON 누락 시 구조화 JSON 모드로 폴백
    if (bestCandidates.length === 0) {
      const fallbackModels = CACHED_WORKING_MODEL ? [CACHED_WORKING_MODEL] : modelsToTry;
      for (const modelName of fallbackModels) {
        const apiRes = await callGeminiApi(apiKey, modelName, prompt, false);
        if (!apiRes.ok) {
          lastErrDetail = await apiRes.text().catch(() => `HTTP ${apiRes.status}`);
          continue;
        }
        anyHttpOk = true;
        CACHED_WORKING_MODEL = modelName;
        const data = await apiRes.json();
        const parsed = parseGeminiCandidates(data, query);
        if (parsed.candidates.length > 0) {
          bestCandidates = parsed.candidates;
          bestSources = parsed.sources;
          break;
        }
      }
    }

    if (!anyHttpOk) {
      return res.status(502).json({
        ok: false,
        code: "UPSTREAM_ERROR",
        error: "Gemini AI API 호출이 실패했습니다. Vercel의 GEMINI_API_KEY가 유효한지 확인해 주세요.",
        detail: String(lastErrDetail).slice(0, 200)
      });
    }

    if (bestCandidates.length === 0) {
      return res.status(404).json({
        ok: false,
        code: "NOT_FOUND",
        error: `"${query}"의 공식 텐트 규격을 찾지 못했습니다.`
      });
    }

    const resultPayload = {
      ok: true,
      tent: bestCandidates[0],
      candidates: bestCandidates,
      sources: bestSources
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
      error: "AI 검색 처리 중 서버 오류가 발생했습니다.",
      detail: err && err.message ? String(err.message).slice(0, 150) : ""
    });
  }
};