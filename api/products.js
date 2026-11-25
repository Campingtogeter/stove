// Vercel Serverless Function: api/products.js
// 배포 위치: Vercel 프로젝트 루트의 api/products.js
// 필수 환경변수 (Vercel Project Settings -> Environment Variables):
//   - SUPABASE_URL: Supabase 프로젝트 URL (예: https://xxxx.supabase.co)
//   - SUPABASE_SERVICE_ROLE_KEY 또는 SUPABASE_ANON_KEY: Supabase API 키
// 선택 환경변수:
//   - SUPABASE_PRODUCTS_TABLE: 상품 테이블명 (기본값: "products")

function extractProductNo(val, url) {
  const direct = String(val || "").replace(/[^0-9]/g, "");
  if (direct.length >= 6) return direct;
  const m = String(url || "").match(/\/products\/(\d+)/);
  return m ? m[1] : "";
}

function normalizeStatus(row) {
  if (row.is_deleted === true || row.deleted === true || row.is_active === false) {
    return { status: "삭제됨", deleted: true };
  }
  const raw = String(
    row.status_type ?? row.sale_status ?? row.status ?? row.product_status ?? ""
  ).trim();
  const upper = raw.toUpperCase();

  if (["CLOSE", "DELETE", "DELETED", "PROHIBITION"].includes(upper) || /삭제|판매종료/.test(raw)) {
    return { status: "삭제됨", deleted: true };
  }
  if (
    ["OUTOFSTOCK", "SOLD_OUT", "SOLDOUT"].includes(upper) ||
    /품절/.test(raw) ||
    (typeof row.stock_quantity === "number" && row.stock_quantity <= 0)
  ) {
    return { status: "품절", deleted: false };
  }
  if (["SUSPENSION", "WAIT", "STOP"].includes(upper) || /판매중지|대기/.test(raw)) {
    return { status: "품절", deleted: false };
  }
  if (["SALE", "ON_SALE", "ACTIVE"].includes(upper) || /판매중/.test(raw)) {
    return { status: "판매중", deleted: false };
  }
  return { status: raw || "판매중", deleted: false };
}

function normalizeRow(row) {
  if (!row || typeof row !== "object") return null;
  const name = String(
    row.name ?? row.product_name ?? row.title ?? row.channel_product_name ?? ""
  ).trim();
  if (!name) return null;

  const rawUrl = String(
    row.url ?? row.product_url ?? row.channel_product_url ?? row.link ?? ""
  ).trim();

  const productNo = extractProductNo(
    row.channel_product_no ?? row.origin_product_no ?? row.naver_product_id ?? row.product_no ?? row.product_id ?? row.id,
    rawUrl
  );

  const url = /^https?:\/\//i.test(rawUrl)
    ? rawUrl
    : (productNo ? `https://smartstore.naver.com/camping-together/products/${productNo}` : "https://smartstore.naver.com/camping-together");

  const rawPrice = row.discounted_price ?? row.sale_price ?? row.price ?? row.mobile_discounted_price ?? 0;
  const price = Math.max(0, Math.round(Number(String(rawPrice).replace(/[^0-9.-]/g, "")) || 0));

  const { status, deleted } = normalizeStatus(row);

  const lower = name.toLowerCase();
  const isTitanium = /티타늄|\bti\b|루모라|x-ti|티아이/.test(lower);
  const isUniversal = /보호망|가이드링|고정링|스탠드/.test(lower);
  const mat = row.mat || (isUniversal ? "both" : (isTitanium ? "titanium" : "stainless"));
  const isStove = typeof row.is_stove === "boolean"
    ? row.is_stove
    : (/화목난로|장작난로/.test(name) && !/연통|엘보|댐퍼|레듀셔|후렌지|보호망|고정링|도킹툴|스탠드|가방|유리/.test(name));

  return {
    id: String(row.code ?? row.simulator_id ?? row.id ?? (productNo ? `naver_${productNo}` : "")),
    productNo,
    name,
    price,
    status,
    deleted,
    url,
    mat,
    isStove,
    updatedAt: row.updated_at ?? row.synced_at ?? row.modified_at ?? null
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

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
  const tableName = (process.env.SUPABASE_PRODUCTS_TABLE || "products").trim();

  if (!supabaseUrl || !supabaseKey) {
    return res.status(200).json({
      ok: false,
      code: "NO_SUPABASE_ENV",
      error: "Vercel 환경변수(SUPABASE_URL, SUPABASE_ANON_KEY 또는 SUPABASE_SERVICE_ROLE_KEY)가 설정되지 않았습니다.",
      products: []
    });
  }

  try {
    const endpoint = `${supabaseUrl}/rest/v1/${encodeURIComponent(tableName)}?select=*`;
    const sbRes = await fetch(endpoint, {
      method: "GET",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Accept: "application/json"
      }
    });

    if (!sbRes.ok) {
      const detail = await sbRes.text().catch(() => "");
      return res.status(502).json({
        ok: false,
        code: "SUPABASE_ERROR",
        error: `Supabase 테이블(${tableName}) 조회 실패 (HTTP ${sbRes.status})`,
        detail: detail.slice(0, 200),
        products: []
      });
    }

    const rows = await sbRes.json();
    const products = (Array.isArray(rows) ? rows : [])
      .map(normalizeRow)
      .filter(Boolean);

    const latestUpdated = products
      .map((p) => p.updatedAt)
      .filter(Boolean)
      .sort()
      .pop() || new Date().toISOString();

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({
      ok: true,
      count: products.length,
      syncedAt: latestUpdated,
      products
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      code: "SERVER_ERROR",
      error: "Supabase 상품 동기화 조회 중 오류가 발생했습니다.",
      detail: err && err.message ? String(err.message).slice(0, 150) : "",
      products: []
    });
  }
};