// Vercel Serverless Function: api/tents.js
// 배포 위치: Vercel 프로젝트 루트의 api/tents.js
// 필수 환경변수 (Vercel Project Settings -> Environment Variables):
//   - SUPABASE_URL: Supabase 프로젝트 URL (예: https://xxxx.supabase.co)
//   - SUPABASE_SERVICE_ROLE_KEY (권장, 쓰기/삭제 권한 포함) 또는 SUPABASE_ANON_KEY
// 선택 환경변수:
//   - SUPABASE_TENTS_TABLE: 텐트 테이블명 (기본값: "tents")
//   - ADMIN_PASSWORD: 관리자 비밀번호 재정의 시 선택 입력 (미설정 시 기존 관리자 비밀번호 자동 사용)

const crypto = require("crypto");

const DEFAULT_ADMIN_HASH = "c4b2fa036cc79e0f84169a1cafa18f89eb9a7431b7fa6842336d91245b12f483";
const ALLOWED_SHAPES = ["dome", "tunnel", "tipi", "cabin"];
const ALLOWED_PATHS = ["straight", "elbow45", "elbow90"];

function parseBody(req) {
  if (!req || req.body == null) return {};
  if (typeof req.body === "object") return req.body;
  try {
    return JSON.parse(String(req.body));
  } catch (e) {
    return {};
  }
}

function verifyAdmin(req, body) {
  const provided = String(
    (req.headers && (req.headers["x-admin-password"] || req.headers["X-Admin-Password"])) ||
    (body && body.adminPassword) ||
    ""
  ).trim();
  if (!provided) return false;
  if (process.env.ADMIN_PASSWORD && provided === process.env.ADMIN_PASSWORD.trim()) {
    return true;
  }
  const expectedHash = (process.env.ADMIN_PASSWORD_HASH || DEFAULT_ADMIN_HASH).trim().toLowerCase();
  const actualHash = crypto.createHash("sha256").update(provided).digest("hex");
  return actualHash === expectedHash;
}

function clampInt(val, min, max, fallback) {
  const n = Math.round(Number(val));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeRow(row) {
  if (!row || typeof row !== "object") return null;
  const id = String(row.id || row.tent_id || "").trim();
  const name = String(row.name || row.model_name || "").trim();
  if (!id || !name) return null;

  const origin = row.origin === "해외" ? "해외" : "국내";
  const brand = String(row.brand || "기타").trim().slice(0, 40);
  const rawShape = String(row.shape || "dome").toLowerCase();
  const shape = ALLOWED_SHAPES.includes(rawShape) ? rawShape : "dome";
  const rawPath = String(row.default_path || row.defaultPath || "straight").toLowerCase();
  const defaultPath = ALLOWED_PATHS.includes(rawPath) ? rawPath : "straight";

  const w = clampInt(row.width_cm ?? row.width ?? row.w, 150, 700, 340);
  const l = clampInt(row.length_cm ?? row.length ?? row.l, 150, 950, 400);
  const peakHeight = clampInt(row.peak_height_cm ?? row.peak_height ?? row.peakHeight ?? row.h, 130, 350, 200);
  const sw = shape === "tipi" ? 0 : clampInt(row.side_wall_cm ?? row.side_wall ?? row.sw, 0, peakHeight, Math.round(peakHeight * 0.55));
  const defaultJackHeight = clampInt(
    row.jack_height_cm ?? row.jack_height ?? row.defaultJackHeight ?? row.jh,
    80,
    Math.max(85, peakHeight - 5),
    Math.min(peakHeight - 15, Math.round((peakHeight * 0.75) / 5) * 5)
  );

  return {
    id,
    origin,
    brand,
    name: name.slice(0, 80),
    shape,
    w,
    l,
    peakHeight,
    sw,
    defaultJackHeight,
    defaultPath,
    isSupabase: true,
    createdAt: row.created_at || null
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-password");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const supabaseKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ""
  ).trim();
  const tableName = (process.env.SUPABASE_TENTS_TABLE || "tents").trim();

  if (!supabaseUrl || !supabaseKey) {
    return res.status(200).json({
      ok: false,
      code: "NO_SUPABASE_ENV",
      error: "Vercel 환경변수(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)가 설정되지 않았습니다.",
      tents: []
    });
  }

  const baseHeaders = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    Accept: "application/json",
    "Content-Type": "application/json"
  };

  // 1. GET: 전체 고객용 텐트 DB 목록 조회
  if (req.method === "GET") {
    try {
      let sbRes = await fetch(
        `${supabaseUrl}/rest/v1/${encodeURIComponent(tableName)}?select=*&order=created_at.desc`,
        { method: "GET", headers: baseHeaders }
      );
      if (!sbRes.ok) {
        sbRes = await fetch(
          `${supabaseUrl}/rest/v1/${encodeURIComponent(tableName)}?select=*`,
          { method: "GET", headers: baseHeaders }
        );
      }
      if (!sbRes.ok) {
        const detail = await sbRes.text().catch(() => "");
        return res.status(502).json({
          ok: false,
          code: "SUPABASE_ERROR",
          error: `Supabase 테이블(${tableName}) 조회 실패 (HTTP ${sbRes.status})`,
          detail: detail.slice(0, 200),
          tents: []
        });
      }

      const rows = await sbRes.json();
      const tents = (Array.isArray(rows) ? rows : []).map(normalizeRow).filter(Boolean);

      res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");
      return res.status(200).json({ ok: true, count: tents.length, tents });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        code: "SERVER_ERROR",
        error: "Supabase 텐트 목록 조회 중 오류가 발생했습니다.",
        tents: []
      });
    }
  }

  // 2. POST: 관리자 전용 신규 텐트 영구 저장
  if (req.method === "POST") {
    const body = parseBody(req);
    if (!verifyAdmin(req, body)) {
      return res.status(401).json({ ok: false, code: "UNAUTHORIZED", error: "관리자 인증에 실패했습니다." });
    }

    const name = String(body.name || "").trim().slice(0, 80);
    if (!name) {
      return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "텐트 모델명을 입력해 주세요." });
    }

    const origin = body.origin === "해외" ? "해외" : "국내";
    const brand = String(body.brand || "기타").trim().slice(0, 40) || "기타";
    const shape = ALLOWED_SHAPES.includes(String(body.shape || "").toLowerCase()) ? String(body.shape).toLowerCase() : "dome";
    const defaultPath = ALLOWED_PATHS.includes(String(body.defaultPath || "").toLowerCase()) ? String(body.defaultPath).toLowerCase() : "straight";
    const widthCm = clampInt(body.w ?? body.width_cm, 150, 700, 340);
    const lengthCm = clampInt(body.l ?? body.length_cm, 150, 950, 400);
    const peakHeightCm = clampInt(body.peakHeight ?? body.peak_height_cm, 130, 350, 200);
    const sideWallCm = shape === "tipi" ? 0 : clampInt(body.sw ?? body.side_wall_cm, 0, peakHeightCm, 110);
    const jackHeightCm = clampInt(body.defaultJackHeight ?? body.jack_height_cm, 80, Math.max(85, peakHeightCm - 5), 150);

    const id = String(body.id || `sb_tent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);

    const insertRow = {
      id,
      origin,
      brand,
      name,
      shape,
      width_cm: widthCm,
      length_cm: lengthCm,
      peak_height_cm: peakHeightCm,
      side_wall_cm: sideWallCm,
      jack_height_cm: jackHeightCm,
      default_path: defaultPath
    };

    try {
      const sbRes = await fetch(`${supabaseUrl}/rest/v1/${encodeURIComponent(tableName)}`, {
        method: "POST",
        headers: { ...baseHeaders, Prefer: "return=representation" },
        body: JSON.stringify(insertRow)
      });
      if (!sbRes.ok) {
        const detail = await sbRes.text().catch(() => "");
        return res.status(502).json({
          ok: false,
          code: "SUPABASE_INSERT_ERROR",
          error: `Supabase 저장 실패 (HTTP ${sbRes.status}) — tents 테이블과 SERVICE_ROLE_KEY를 확인해 주세요.`,
          detail: detail.slice(0, 200)
        });
      }
      const inserted = await sbRes.json().catch(() => [insertRow]);
      const savedTent = normalizeRow(Array.isArray(inserted) ? inserted[0] : inserted) || normalizeRow(insertRow);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ ok: true, tent: savedTent });
    } catch (err) {
      return res.status(500).json({ ok: false, code: "SERVER_ERROR", error: "Supabase 텐트 저장 중 서버 오류가 발생했습니다." });
    }
  }

  // 3. DELETE: 관리자 전용 텐트 영구 삭제
  if (req.method === "DELETE") {
    const body = parseBody(req);
    if (!verifyAdmin(req, body)) {
      return res.status(401).json({ ok: false, code: "UNAUTHORIZED", error: "관리자 인증에 실패했습니다." });
    }
    const id = String((req.query && req.query.id) || (body && body.id) || "").trim();
    if (!id) {
      return res.status(400).json({ ok: false, code: "INVALID_ID", error: "삭제할 텐트 ID가 필요합니다." });
    }

    try {
      const sbRes = await fetch(
        `${supabaseUrl}/rest/v1/${encodeURIComponent(tableName)}?id=eq.${encodeURIComponent(id)}`,
        { method: "DELETE", headers: baseHeaders }
      );
      if (!sbRes.ok) {
        const detail = await sbRes.text().catch(() => "");
        return res.status(502).json({
          ok: false,
          code: "SUPABASE_DELETE_ERROR",
          error: `Supabase 삭제 실패 (HTTP ${sbRes.status})`,
          detail: detail.slice(0, 200)
        });
      }
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ ok: true, deletedId: id });
    } catch (err) {
      return res.status(500).json({ ok: false, code: "SERVER_ERROR", error: "Supabase 텐트 삭제 중 서버 오류가 발생했습니다." });
    }
  }

  return res.status(405).json({ ok: false, error: "허용되지 않은 HTTP 메서드입니다." });
};