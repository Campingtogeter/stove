import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';
import { fetch, ProxyAgent } from 'undici';

const {
  NAVER_CLIENT_ID,
  NAVER_CLIENT_SECRET,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  PROXY_URL,
} = process.env;

if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('필수 환경변수가 누락되었습니다. GitHub Secrets를 확인하세요.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const dispatcher = PROXY_URL ? new ProxyAgent(PROXY_URL) : undefined;
const STORE_SLUG = 'camping-together';

async function getNaverAccessToken() {
  const timestamp = Date.now();
  const password = `${NAVER_CLIENT_ID}_${timestamp}`;
  const hashed = bcrypt.hashSync(password, NAVER_CLIENT_SECRET);
  const clientSecretSign = Buffer.from(hashed, 'utf-8').toString('base64');

  const params = new URLSearchParams({
    client_id: NAVER_CLIENT_ID,
    timestamp: String(timestamp),
    client_secret_sign: clientSecretSign,
    grant_type: 'client_credentials',
    type: 'SELF',
  });

  const res = await fetch('https://api.commerce.naver.com/external/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    dispatcher,
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`토큰 발급 실패 (${res.status}): ${JSON.stringify(data)}`);
  }

  return data.access_token;
}

async function fetchNaverProducts(accessToken) {
  let allProducts = [];
  let page = 1;
  const size = 100;

  while (true) {
    const res = await fetch('https://api.commerce.naver.com/external/v1/products/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        productStatusTypes: ['SALE', 'OUTOFSTOCK'],
        page,
        size,
      }),
      dispatcher,
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(`상품 조회 실패 (${res.status}): ${JSON.stringify(data)}`);
    }

    const contents = data.contents || [];
    allProducts = allProducts.concat(contents);

    if (contents.length < size || page >= (data.totalPages || 1)) {
      break;
    }
    page += 1;
  }

  return allProducts;
}

async function syncToSupabase(products) {
  const rows = products
    .map((item) => {
      const channelProduct = item.channelProducts?.[0];
      if (!channelProduct) return null;

      return {
        origin_product_no: String(item.originProductNo),
        name: channelProduct.name || '',
        category: channelProduct.wholeCategoryName || '',
        price: channelProduct.discountedPrice ?? channelProduct.salePrice ?? 0,
        stock_quantity: channelProduct.stockQuantity ?? 0,
        product_url: `https://smartstore.naver.com/${STORE_SLUG}/products/${channelProduct.channelProductNo}`,
        image_url: channelProduct.representativeImage?.url || '',
        updated_at: new Date().toISOString(),
      };
    })
    .filter(Boolean);

  if (rows.length === 0) {
    console.log('동기화할 상품이 없습니다.');
    return;
  }

  const { error } = await supabase
    .from('store_products')
    .upsert(rows, { onConflict: 'origin_product_no' });

  if (error) {
    throw new Error(`Supabase upsert 실패: ${error.message}`);
  }

  console.log(`총 ${rows.length}개 상품 동기화 완료`);
}

async function main() {
  console.log('네이버 커머스 API 동기화 시작...');
  const token = await getNaverAccessToken();
  const products = await fetchNaverProducts(token);
  await syncToSupabase(products);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
