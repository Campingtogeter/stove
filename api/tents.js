/**
 * Vercel Serverless Function: /api/tents.js
 * - 캠핑투게더 시뮬레이터 텐트 DB Supabase 영구 저장 및 전체 고객 자동 노출 API
 *
 * 필수 Vercel 환경변수:
 *   - SUPABASE_URL               (예: https://xxxx.supabase.co)
 *   - SUPABASE_SERVICE_ROLE_KEY  (Supabase Project Settings > API > service_role key)
 * 선택 환경변수:
 *   - ADMIN_PW_HASH              (미설정 시 pro-data.js의 기본 관리자 해시 사용)
 */

const crypto = require("crypto");

const DEFAULT_ADMIN_PW_HASH = "c4b2fa036cc79e0f84169a1cafa18f89eb9a7431b7fa6842336d91245b12f483";
const VALID_ORIGINS = new Set(["국내", "해외"]);
const VALID_SHAPES = new Set(["dome", "tipi", "tunnel", "cabin"]);
const VALID_PATHS = new Set(["straight", "elbow45", "elbow90"]);

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

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

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

    // PATCH: 기존 텐트 제원 수정 (내장 텐트 최초 수정 시에도 upsert로 영구 반영)
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
    // - 관리자 추가 텐트(tent_adm_*)는 완전 삭제, 기본 내장 텐트는 deleted=true로 소프트 삭제하여 모든 고객에게 숨김 반영
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

      // 기본 내장 텐트 삭제: deleted=true 레코드로 upsert
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