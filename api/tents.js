/**
 * Vercel Serverless Function: /api/tents.js
 * - 캠핑투게더 시뮬레이터 텐트 DB Supabase 영구 저장 및 전체 고객 자동 노출 API
 * - 관리자 전용 URL 제원 자동 추출(action: "extract_url") 지원
 *
 * 필수 Vercel 환경변수:
 *   - SUPABASE_URL               (예: https://xxxx.supabase.co)
 *   - SUPABASE_SERVICE_ROLE_KEY  (Supabase Project Settings > API > service_role key)
 * 선택 환경변수:
 *   - ADMIN_PW_HASH              (미설정 시 pro-data.js의 기본 관리자 해시 사용)
 *   - GEMINI_API_KEY             (설정 시 URL 페이지 텍스트에서 AI 정밀 제원 추출 우선 사용)
 */

const crypto = require("crypto");

const DEFAULT_ADMIN_PW_HASH = "c4b2fa036cc79e0f84169a1cafa18f89eb9a7431b7fa6842336d91245b12f483";
const VALID_ORIGINS = new Set(["국내", "해외"]);
const VALID_SHAPES = new Set(["dome", "tipi", "tunnel", "cabin"]);
const VALID_PATHS = new Set(["straight", "elbow45", "elbow90"]);

const KR_BRANDS = [
  "미니멀웍스", "백컨트리", "쿠디", "노스피크", "카즈미", "코베아", "제드",
  "스노우라인", "지프", "듀랑고", "아이두젠", "폴라리스", "위오", "캠핑칸",
  "마운틴하이커", "어반포레스트", "캠프타운", "코오롱", "네파", "블랙야크",
  "minimalworks", "backcountry", "coody", "northpeak", "kzm", "kovea",
  "zed", "snowline", "durango", "idoogen", "polaris", "wiwo", "campingkan"
];

function sha256Hex(str) {
  return crypto.createHash("sha256").update(String(str || ""), "utf8").digest("hex");
}

function verifyAdminPassword(req) {
  const expectedHash = (process.env.ADMIN_PW_HASH || DEFAULT_ADMIN_PW_HASH).trim().toLowerCase();
  const rawPw = String(req.headers["x-admin-password"] || "").trim();
  if (!rawPw) return false;
  const actualHash = sha256Hex(rawPw);
  if (actualHash.length !== expectedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actualHash), Buffer.from(expectedHash));
}

function getSupabaseConfig() {
  const url = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return { url, key };
}

function toClientTent(row) {
  return {
    id: String(row.id),
    origin: row.origin || "국내",
    brand: row.brand || "",
    name: row.name || "",
    shape: row.shape || "dome",
    w: Number(row.w) || 320,
    l: Number(row.l) || 400,
    peakHeight: Number(row.peak_height) || 200,
    sw: Number(row.sw) || 0,
    defaultJackHeight: Number(row.default_jack_height) || 150,
    defaultPath: row.default_path || "straight",
    deleted: Boolean(row.deleted),
    updatedAt: row.updated_at || null
  };
}

function validateTentPayload(body, isPartial) {
  if (!body || typeof body !== "object") {
    return { error: "요청 본문이 올바르지 않습니다." };
  }

  const id = String(body.id || "").trim();
  if (!id || id.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    return { error: "올바른 텐트 ID가 필요합니다." };
  }

  const row = { id };

  if (!isPartial || body.origin !== undefined) {
    const origin = String(body.origin || "국내").trim();
    if (!VALID_ORIGINS.has(origin)) return { error: "구분은 '국내' 또는 '해외'만 가능합니다." };
    row.origin = origin;
  }

  if (!isPartial || body.brand !== undefined) {
    const brand = String(body.brand || "").trim();
    if (!brand || brand.length > 60) return { error: "브랜드명을 입력해 주세요 (최대 60자)." };
    row.brand = brand;
  }

  if (!isPartial || body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name || name.length > 100) return { error: "텐트 모델명을 입력해 주세요 (최대 100자)." };
    row.name = name;
  }

  if (!isPartial || body.shape !== undefined) {
    const shape = String(body.shape || "dome").trim();
    if (!VALID_SHAPES.has(shape)) return { error: "올바른 텐트 형태를 선택해 주세요." };
    row.shape = shape;
  }

  if (!isPartial || body.w !== undefined) {
    const w = Math.round(Number(body.w));
    if (!Number.isFinite(w) || w < 150 || w > 800) return { error: "설치 폭은 150~800cm 범위여야 합니다." };
    row.w = w;
  }

  if (!isPartial || body.l !== undefined) {
    const l = Math.round(Number(body.l));
    if (!Number.isFinite(l) || l < 150 || l > 1000) return { error: "설치 길이는 150~1000cm 범위여야 합니다." };
    row.l = l;
  }

  if (!isPartial || body.peakHeight !== undefined) {
    const peakHeight = Math.round(Number(body.peakHeight));
    if (!Number.isFinite(peakHeight) || peakHeight < 130 || peakHeight > 350) {
      return { error: "최고 높이는 130~350cm 범위여야 합니다." };
    }
    row.peak_height = peakHeight;
  }

  if (!isPartial || body.defaultJackHeight !== undefined) {
    const jackH = Math.round(Number(body.defaultJackHeight));
    if (!Number.isFinite(jackH) || jackH < 80 || jackH > 320) {
      return { error: "권장 홀잭 높이는 80~320cm 범위여야 합니다." };
    }
    if (row.peak_height !== undefined && jackH >= row.peak_height) {
      return { error: "권장 홀잭 높이는 텐트 최고 높이보다 낮아야 합니다." };
    }
    row.default_jack_height = jackH;
  }

  if (!isPartial || body.sw !== undefined) {
    const fallbackSw = row.shape === "tipi" ? 0 : Math.round((row.peak_height || 200) * 0.6);
    const sw = body.sw === undefined || body.sw === null || body.sw === ""
      ? fallbackSw
      : Math.round(Number(body.sw));
    if (!Number.isFinite(sw) || sw < 0 || sw > 350) return { error: "측벽 높이 값이 올바르지 않습니다." };
    row.sw = sw;
  }

  if (!isPartial || body.defaultPath !== undefined) {
    const defaultPath = String(body.defaultPath || "straight").trim();
    if (!VALID_PATHS.has(defaultPath)) return { error: "올바른 권장 경로를 선택해 주세요." };
    row.default_path = defaultPath;
  }

  if (body.deleted !== undefined) {
    row.deleted = Boolean(body.deleted);
  } else if (!isPartial) {
    row.deleted = false;
  }

  return { row };
}

/* =========================================================
 * URL 제원 자동 추출 유틸리티 (SSRF 방어 + 정규식/AI 파싱)
 * ========================================================= */
function isSafePublicUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || "").trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
    if (host === "::1" || host.startsWith("[::1]") || host.startsWith("[fe80:") || host.startsWith("[fc") || host.startsWith("[fd")) return false;
    return true;
  } catch (e) {
    return false;
  }
}

function decodeHtmlEntities(str) {
  return String(str || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&times;/gi, "x")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function extractPageTextAndMeta(html) {
  const raw = String(html || "");
  const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const ogTitleMatch = raw.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || raw.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const descMatch = raw.match(/<meta[^>]+(?:name=["']description["']|property=["']og:description["'])[^>]+content=["']([^"']+)["']/i)
    || raw.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name=["']description["']|property=["']og:description["'])/i);

  const jsonLdChunks = [];
  for (const m of raw.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    jsonLdChunks.push(m[1].trim().slice(0, 2000));
  }

  const stripped = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    title: decodeHtmlEntities((ogTitleMatch && ogTitleMatch[1]) || (titleMatch && titleMatch[1]) || "").trim(),
    description: decodeHtmlEntities((descMatch && descMatch[1]) || "").trim(),
    jsonLd: jsonLdChunks.join("\n").slice(0, 3000),
    bodyText: decodeHtmlEntities(stripped).slice(0, 12000)
  };
}

function toCm(val, unitRaw) {
  const num = Number(val);
  if (!Number.isFinite(num) || num <= 0) return NaN;
  const u = String(unitRaw || "").toLowerCase().trim();
  if (u === "mm") return Math.round(num / 10);
  if (u === "m") return Math.round(num * 100);
  if (u === "in" || u === "inch" || u === "inches" || u === '"') return Math.round(num * 2.54);
  if (u === "ft" || u === "feet" || u === "'") return Math.round(num * 30.48);
  // 단위 생략 시 1000 이상이면 mm, 10 미만이면 m로 추정
  if (!u) {
    if (num >= 1200) return Math.round(num / 10);
    if (num > 1 && num <= 12) return Math.round(num * 100);
  }
  return Math.round(num);
}

function inferShapeFromText(text) {
  const t = String(text || "").toLowerCase();
  if (/티피|원폴|tipi|teepee|bell\s*tent|알페임|모닝글로리|서커스|로로/.test(t)) return "tipi";
  if (/캐빈|면텐트|코튼|cabin|lodge|빌리지|아스가르드|홈스테드|쿠디|듀랑고/.test(t)) return "cabin";
  if (/터널|리빙쉘|2룸|투룸|거실형|tunnel|living\s*shell|랜드락|코쿤|브이하우스|발할|가마보코|아티카/.test(t)) return "tunnel";
  return "dome";
}

function inferOriginFromText(text, urlStr) {
  const hay = `${text} ${urlStr}`.toLowerCase();
  if (KR_BRANDS.some((b) => hay.includes(b.toLowerCase()))) return "국내";
  if (/\.co\.kr|\.kr\b|smartstore\.naver|brand\.naver/.test(urlStr.toLowerCase())) {
    if (/pomoly|helsport|snowpeak|snow peak|coleman|nordisk|hilleberg|naturehike|dod|onetigris|sabbatical|zanearts|robens|msr|nemo|big agnes|스노우피크|콜맨|노르디스크|헬스포츠|힐레베르그|네이처하이크|포몰리|원티그리스/.test(hay)) {
      return "해외";
    }
    return "국내";
  }
  return "해외";
}

function parseTentSpecsByRegex(meta, urlStr) {
  const fullText = `${meta.title}\n${meta.description}\n${meta.jsonLd}\n${meta.bodyText}`;
  const shape = inferShapeFromText(meta.title + " " + meta.description);
  const origin = inferOriginFromText(meta.title + " " + meta.description, urlStr);

  // 1) W x L x H (3개 치수 연속 패턴) 우선 탐색
  // 예: 380 x 400 x 185 cm, 6100×3800×2150mm, 3.8 x 4.0 x 2.1m, 149 x 149 x 82 in
  const tripleMatches = [];
  const tripleRe = /(\d{1,4}(?:\.\d+)?)\s*(mm|cm|m|in|ft)?\s*[x×*X]\s*(\d{1,4}(?:\.\d+)?)\s*(mm|cm|m|in|ft)?\s*[x×*X]\s*(\d{1,4}(?:\.\d+)?)\s*(mm|cm|m|in|ft)?/g;
  for (const m of fullText.matchAll(tripleRe)) {
    const unit = m[6] || m[4] || m[2] || "";
    const a = toCm(m[1], m[2] || unit);
    const b = toCm(m[3], m[4] || unit);
    const c = toCm(m[5], m[6] || unit);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) continue;
    // 패킹 사이즈(예: 70x30x30) 제외: 설치 텐트 최소 치수 필터
    const maxDim = Math.max(a, b, c);
    const minDim = Math.min(a, b, c);
    if (maxDim < 180 || maxDim > 1000 || minDim < 120) continue;

    // 일반적으로 3번째 값이 높이(H)인 경우가 많음
    let peakH = c;
    let d1 = a, d2 = b;
    if (peakH > 350 || peakH < 130) {
      const sorted = [a, b, c].sort((x, y) => x - y);
      peakH = sorted[0];
      d1 = sorted[1];
      d2 = sorted[2];
    }
    if (peakH >= 130 && peakH <= 350) {
      const w = Math.min(d1, d2);
      const l = Math.max(d1, d2);
      if (w >= 150 && w <= 800 && l >= 150 && l <= 1000) {
        const ctxStart = Math.max(0, m.index - 35);
        const ctx = fullText.slice(ctxStart, m.index + m[0].length + 20);
        // 수납/패킹 사이즈 컨텍스트는 감점
        const isPacking = /수납|패킹|보관|파우치|가방|pack|storage|folded/i.test(ctx);
        const isSetup = /설치|사용|크기|규격|사이즈|전개|dimension|setup|pitch|size/i.test(ctx);
        tripleMatches.push({ w, l, peakHeight: peakH, score: (isSetup ? 10 : 0) - (isPacking ? 20 : 0) });
      }
    }
  }

  tripleMatches.sort((a, b) => b.score - a.score);
  let best = tripleMatches.length && tripleMatches[0].score >= 0 ? tripleMatches[0] : (tripleMatches[0] || null);

  // 2) 3연속 패턴이 없으면 개별 라벨(높이/폭/길이) 보조 탐색
  if (!best) {
    const hMatch = fullText.match(/(?:최고\s*높이|천장고|높이|peak\s*height|height)\s*[:：]?\s*(\d{2,4}(?:\.\d+)?)\s*(mm|cm|m|in|ft)?/i);
    const wMatch = fullText.match(/(?:설치\s*폭|가로|폭|width)\s*[:：]?\s*(\d{2,4}(?:\.\d+)?)\s*(mm|cm|m|in|ft)?/i);
    const lMatch = fullText.match(/(?:설치\s*길이|세로|길이|length)\s*[:：]?\s*(\d{2,4}(?:\.\d+)?)\s*(mm|cm|m|in|ft)?/i);
    const ph = hMatch ? toCm(hMatch[1], hMatch[2]) : NaN;
    const pw = wMatch ? toCm(wMatch[1], wMatch[2]) : NaN;
    const pl = lMatch ? toCm(lMatch[1], lMatch[2]) : NaN;
    if (Number.isFinite(ph) && ph >= 130 && ph <= 350) {
      best = {
        w: (Number.isFinite(pw) && pw >= 150 && pw <= 800) ? pw : 320,
        l: (Number.isFinite(pl) && pl >= 150 && pl <= 1000) ? pl : 400,
        peakHeight: ph,
        partial: !Number.isFinite(pw) || !Number.isFinite(pl)
      };
    }
  }

  // 제목에서 브랜드/모델명 추정
  let cleanTitle = (meta.title || "")
    .replace(/\s*[:|\-–—]\s*(네이버\s*스마트스토어|스마트스토어|쿠팡|공식\s*스토어|공식\s*몰|Official\s*Store).*$/i, "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = cleanTitle.split(/\s+/).filter(Boolean);
  const brand = parts.length >= 2 ? parts[0].slice(0, 40) : "";
  const name = parts.length >= 2 ? parts.slice(1).join(" ").slice(0, 80) : cleanTitle.slice(0, 80);

  const peakHeight = best ? best.peakHeight : 200;
  const w = best ? best.w : 320;
  const l = best ? best.l : 400;
  const defaultPath = shape === "tunnel" ? "elbow90" : (shape === "dome" && peakHeight <= 195 ? "elbow45" : "straight");
  const defaultJackHeight = Math.max(80, Math.min(peakHeight - 15, Math.round(peakHeight * (defaultPath === "elbow90" ? 0.72 : 0.78))));
  const sw = shape === "tipi" ? 0 : Math.round(peakHeight * 0.6);

  return {
    foundDimensions: Boolean(best),
    partial: Boolean(best && best.partial),
    tent: { origin, brand, name, shape, w, l, peakHeight, sw, defaultJackHeight, defaultPath }
  };
}

async function parseTentSpecsWithGemini(meta, urlStr) {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return null;

  const prompt = [
    "다음 텐트 웹페이지 정보에서 설치(사용) 규격을 추출해 JSON 객체만 반환하세요. 마크다운 코드블록 없이 순수 JSON만 출력하세요.",
    "패킹/수납 사이즈가 아닌 '설치(전개) 크기'를 cm 단위 정수로 변환하세요 (mm는 /10, m는 *100, inch는 *2.54).",
    '스키마: {"foundDimensions":true/false,"origin":"국내"|"해외","brand":"브랜드명","name":"모델명","shape":"dome"|"tipi"|"tunnel"|"cabin","w":폭cm,"l":길이cm,"peakHeight":최고높이cm,"sw":측벽높이cm,"defaultJackHeight":권장홀잭높이cm,"defaultPath":"straight"|"elbow45"|"elbow90"}',
    "규칙: w <= l (폭과 길이 중 작은 값이 w), peakHeight는 130~350, defaultJackHeight는 peakHeight보다 15~60cm 낮게 추정, tipi면 sw=0.",
    `URL: ${urlStr}`,
    `제목: ${meta.title}`,
    `설명: ${meta.description}`,
    `JSON-LD: ${meta.jsonLd.slice(0, 1500)}`,
    `본문: ${meta.bodyText.slice(0, 5000)}`
  ].join("\n");

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
      })
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const txt = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]
      ? data.candidates[0].content.parts[0].text
      : "";
    if (!txt) return null;
    const cleanJson = txt.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(cleanJson);
    if (!parsed || typeof parsed !== "object") return null;

    const shape = VALID_SHAPES.has(parsed.shape) ? parsed.shape : "dome";
    const defaultPath = VALID_PATHS.has(parsed.defaultPath) ? parsed.defaultPath : "straight";
    const peakHeight = Math.max(130, Math.min(350, Math.round(Number(parsed.peakHeight) || 200)));
    const w = Math.max(150, Math.min(800, Math.round(Number(parsed.w) || 320)));
    const l = Math.max(150, Math.min(1000, Math.round(Number(parsed.l) || 400)));
    const defaultJackHeight = Math.max(80, Math.min(peakHeight - 10, Math.round(Number(parsed.defaultJackHeight) || Math.round(peakHeight * 0.78))));
    const sw = shape === "tipi" ? 0 : Math.max(0, Math.min(peakHeight, Math.round(Number(parsed.sw) || Math.round(peakHeight * 0.6))));

    return {
      foundDimensions: Boolean(parsed.foundDimensions),
      tent: {
        origin: VALID_ORIGINS.has(parsed.origin) ? parsed.origin : inferOriginFromText(meta.title, urlStr),
        brand: String(parsed.brand || "").trim().slice(0, 60),
        name: String(parsed.name || "").trim().slice(0, 100),
        shape,
        w: Math.min(w, l),
        l: Math.max(w, l),
        peakHeight,
        sw,
        defaultJackHeight,
        defaultPath
      }
    };
  } catch (e) {
    return null;
  }
}

async function handleExtractUrl(rawUrl, res) {
  const targetUrl = String(rawUrl || "").trim();
  if (!isSafePublicUrl(targetUrl)) {
    return res.status(400).json({ ok: false, error: "올바른 외부 웹 주소(https://...)를 입력해 주세요." });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let html = "";
  let fetchError = "";

  try {
    const pageRes = await fetch(targetUrl, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
      }
    });
    if (!pageRes.ok) {
      fetchError = `페이지 응답 오류 (HTTP ${pageRes.status})`;
    } else {
      html = await pageRes.text();
    }
  } catch (err) {
    fetchError = (err && err.name === "AbortError")
      ? "페이지 응답 시간이 초과되었습니다(8초)."
      : "해당 웹사이트에 접근할 수 없습니다.";
  } finally {
    clearTimeout(timer);
  }

  if (!html) {
    return res.status(502).json({
      ok: false,
      error: `${fetchError} (보안 차단 사이트이거나 이미지 전용 상세페이지일 수 있습니다. 아래 칸에 직접 입력해 주세요.)`
    });
  }

  const meta = extractPageTextAndMeta(html);
  const aiResult = await parseTentSpecsWithGemini(meta, targetUrl);
  if (aiResult) {
    return res.status(200).json({
      ok: true,
      method: "ai",
      foundDimensions: aiResult.foundDimensions,
      pageTitle: meta.title,
      tent: aiResult.tent,
      warning: aiResult.foundDimensions ? "" : "페이지 본문에 숫자 규격이 없어 기본 추정치로 채웠습니다. (상세페이지가 이미지인 경우 수치를 직접 확인해 주세요.)"
    });
  }

  const rxResult = parseTentSpecsByRegex(meta, targetUrl);
  return res.status(200).json({
    ok: true,
    method: "regex",
    foundDimensions: rxResult.foundDimensions,
    pageTitle: meta.title,
    tent: rxResult.tent,
    warning: rxResult.foundDimensions
      ? (rxResult.partial ? "일부 치수만 추출되어 나머지는 기본값으로 채웠습니다. 저장 전 수치를 확인해 주세요." : "")
      : "페이지 텍스트에서 설치 치수를 찾지 못했습니다. (상세페이지가 이미지 형태인 경우 폭·길이·높이를 직접 입력해 주세요.)"
  });
}

async function supabaseRequest(cfg, path, options) {
  const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) {}
  return { ok: res.ok, status: res.status, data: json, raw: text };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-password");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const body = req.method === "GET"
    ? {}
    : (typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}));

  // URL 자동 제원 추출 요청 (관리자 인증 필수, Supabase 설정 여부와 무관하게 동작)
  if (req.method === "POST" && body && body.action === "extract_url") {
    if (!verifyAdminPassword(req)) {
      return res.status(401).json({ ok: false, error: "관리자 인증에 실패했습니다. 다시 로그인해 주세요." });
    }
    return handleExtractUrl(body.url, res);
  }

  const cfg = getSupabaseConfig();
  if (!cfg.url || !cfg.key) {
    return res.status(500).json({
      ok: false,
      error: "Vercel 환경변수(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)가 설정되지 않았습니다."
    });
  }

  try {
    // 1. GET: 모든 고객에게 Supabase 텐트 목록 반환
    if (req.method === "GET") {
      const result = await supabaseRequest(cfg, "tents?select=*&order=created_at.desc", { method: "GET" });
      if (!result.ok) {
        return res.status(502).json({
          ok: false,
          error: (result.data && result.data.message) || "Supabase 텐트 목록 조회에 실패했습니다."
        });
      }
      const tents = Array.isArray(result.data) ? result.data.map(toClientTent) : [];
      return res.status(200).json({
        ok: true,
        syncedAt: new Date().toISOString(),
        tents
      });
    }

    // 2. 쓰기 요청(POST / PATCH / DELETE)은 관리자 비밀번호 검증 필수
    if (!verifyAdminPassword(req)) {
      return res.status(401).json({
        ok: false,
        error: "관리자 인증에 실패했습니다. 다시 로그인해 주세요."
      });
    }

    // POST: 신규 텐트 추가 (또는 기존 ID upsert)
    if (req.method === "POST") {
      const { row, error } = validateTentPayload(body, false);
      if (error) return res.status(400).json({ ok: false, error });

      const result = await supabaseRequest(cfg, "tents?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: row
      });
      if (!result.ok) {
        return res.status(502).json({
          ok: false,
          error: (result.data && result.data.message) || "Supabase 텐트 저장에 실패했습니다."
        });
      }
      const saved = Array.isArray(result.data) && result.data[0] ? toClientTent(result.data[0]) : toClientTent(row);
      return res.status(200).json({ ok: true, tent: saved });
    }

    // PATCH: 기존 텐트 제원 수정
    if (req.method === "PATCH") {
      const { row, error } = validateTentPayload(body, false);
      if (error) return res.status(400).json({ ok: false, error });

      const result = await supabaseRequest(cfg, "tents?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: row
      });
      if (!result.ok) {
        return res.status(502).json({
          ok: false,
          error: (result.data && result.data.message) || "Supabase 텐트 수정에 실패했습니다."
        });
      }
      const saved = Array.isArray(result.data) && result.data[0] ? toClientTent(result.data[0]) : toClientTent(row);
      return res.status(200).json({ ok: true, tent: saved });
    }

    // DELETE: 텐트 삭제
    if (req.method === "DELETE") {
      const id = String(body.id || (req.query && req.query.id) || "").trim();
      if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
        return res.status(400).json({ ok: false, error: "삭제할 텐트 ID가 올바르지 않습니다." });
      }

      if (id.startsWith("tent_adm_")) {
        const result = await supabaseRequest(cfg, `tents?id=eq.${encodeURIComponent(id)}`, {
          method: "DELETE"
        });
        if (!result.ok) {
          return res.status(502).json({
            ok: false,
            error: (result.data && result.data.message) || "Supabase 텐트 삭제에 실패했습니다."
          });
        }
        return res.status(200).json({ ok: true, id, hardDeleted: true });
      }

      const row = {
        id,
        origin: VALID_ORIGINS.has(body.origin) ? body.origin : "국내",
        brand: String(body.brand || "기본"),
        name: String(body.name || id),
        shape: VALID_SHAPES.has(body.shape) ? body.shape : "dome",
        w: Math.max(150, Math.min(800, Math.round(Number(body.w) || 300))),
        l: Math.max(150, Math.min(1000, Math.round(Number(body.l) || 400))),
        peak_height: Math.max(130, Math.min(350, Math.round(Number(body.peakHeight) || 200))),
        sw: Math.max(0, Math.min(350, Math.round(Number(body.sw) || 0))),
        default_jack_height: Math.max(80, Math.min(320, Math.round(Number(body.defaultJackHeight) || 150))),
        default_path: VALID_PATHS.has(body.defaultPath) ? body.defaultPath : "straight",
        deleted: true
      };
      const result = await supabaseRequest(cfg, "tents?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: row
      });
      if (!result.ok) {
        return res.status(502).json({
          ok: false,
          error: (result.data && result.data.message) || "Supabase 기본 텐트 숨김 처리에 실패했습니다."
        });
      }
      return res.status(200).json({ ok: true, id, deleted: true });
    }

    return res.status(405).json({ ok: false, error: "허용되지 않은 HTTP 메서드입니다." });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: (err && err.message) ? err.message : "서버 처리 중 오류가 발생했습니다."
    });
  }
};