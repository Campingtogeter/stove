/* =========================================================
 * 캠핑투게더 난로·연통 시뮬레이터 (상세 버전) 애플리케이션 로직
 * - 시뮬레이션 계산, SVG 실시간 도면, BOM 관리, AI 검색,
 *   관리자 동기화 및 Supabase 텐트 DB 영구 저장 연동
 * - 선행 파일: ./pro-data.js (window.CT_PRO_DATA)
 * ========================================================= */

(function () {
  "use strict";

  const DATA = window.CT_PRO_DATA;
  if (!DATA) {
    console.error("[Pro App] pro-data.js가 먼저 로드되지 않았습니다.");
    return;
  }

  const {
    STORE_URL,
    SPARK_MIN_CLEARANCE_CM,
    ADMIN_PW_HASH,
    PRODUCTS,
    STOVE_MODELS,
    TENT_MODELS,
    EXTRA_TENT_CATALOG
  } = DATA;

  // 로컬 초기화 및 원격 병합 시 기준이 되는 초기 데이터 스냅샷
  const INITIAL_PRODUCTS = JSON.parse(JSON.stringify(PRODUCTS));
  const INITIAL_TENTS = JSON.parse(JSON.stringify(TENT_MODELS));

  /* =========================================================
   * 1. 공통 유틸리티 & DOM 헬퍼
   * ========================================================= */
  function byId(id) { return document.getElementById(id); }
  function setText(id, txt) { const el = byId(id); if (el) el.textContent = txt; }
  function setHtml(id, html) { const el = byId(id); if (el) el.innerHTML = html; }
  function setVal(id, val) { const el = byId(id); if (el) el.value = val; }
  function onEl(id, evt, fn) { const el = byId(id); if (el) el.addEventListener(evt, fn); }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sanitizeUrl(url) {
    const t = String(url || "").trim();
    return /^https?:\/\//i.test(t) ? escapeHtml(t) : STORE_URL;
  }

  function formatKRW(n) {
    return Number(n || 0).toLocaleString("ko-KR") + "원";
  }

  function round1(n) {
    return Math.round(Number(n) * 10) / 10;
  }

  function normalizeSearchStr(s) {
    return String(s || "").toLowerCase().replace(/[\s\-_·.,()\[\]\/]+/g, "");
  }

  function showToast(msg) {
    const b = byId("toastBanner");
    const m = byId("toastMessage");
    if (!b || !m) return;
    m.textContent = msg;
    b.classList.remove("hidden");
    clearTimeout(window.__ctProToastTimer);
    window.__ctProToastTimer = setTimeout(() => b.classList.add("hidden"), 2800);
  }

  async function copyTextToClipboard(text, successMsg) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      showToast(successMsg);
    } catch (err) {
      showToast("복사에 실패했습니다. 브라우저 권한을 확인해 주세요.");
    }
  }

  // 비HTTPS(file://, LAN HTTP 등) 환경에서도 동일하게 동작하는 순수 JS SHA-256 폴백
  function sha256FallbackHex(ascii) {
    const rightRotate = (v, amt) => (v >>> amt) | (v << (32 - amt));
    const maxWord = Math.pow(2, 32);
    const bytes = Array.from(new TextEncoder().encode(ascii));
    const bitLen = bytes.length * 8;
    const hash = [];
    const k = [];
    let primeCounter = 0;
    const isComposite = {};
    for (let candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (Math.pow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const words = [];
    for (let i = 0; i < bytes.length; i++) {
      words[i >> 2] |= bytes[i] << ((3 - (i % 4)) * 8);
    }
    words[words.length] = (bitLen / maxWord) | 0;
    words[words.length] = bitLen | 0;

    for (let j = 0; j < words.length;) {
      const w = words.slice(j, (j += 16));
      const oldHash = hash.slice(0, 8);
      for (let i = 0; i < 64; i++) {
        const w15 = w[i - 15], w2 = w[i - 2];
        const a = hash[0], e = hash[4];
        const temp1 = (hash[7]
          + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
          + ((e & hash[5]) ^ ((~e) & hash[6]))
          + k[i]
          + (w[i] = i < 16 ? w[i] : (
            w[i - 16]
            + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
            + w[i - 7]
            + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
          ) | 0)) | 0;
        const temp2 = ((rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]))) | 0;
        hash.unshift((temp1 + temp2) | 0);
        hash[4] = (hash[4] + temp1) | 0;
        hash.pop();
      }
      for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }

    let result = "";
    for (let i = 0; i < 8; i++) {
      for (let j = 3; j >= 0; j--) {
        const b = (hash[i] >> (j * 8)) & 255;
        result += (b < 16 ? "0" : "") + b.toString(16);
      }
    }
    return result;
  }

  async function sha256Hex(str) {
    if (window.crypto && window.crypto.subtle) {
      const buf = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    return sha256FallbackHex(str);
  }

  /* =========================================================
   * 2. 애플리케이션 상태
   * ========================================================= */
  const state = {
    activeTab: "simulator",
    tentOriginFilter: "all",
    selectedTentId: "helsport_valhall",
    customTentWidth: 340,
    customTentLength: 380,
    tentShape: "tunnel",
    tentHeight: 210,
    jackHeight: 180,
    selectedStoveId: "mstove_v3",
    stoveHeight: 35,
    standHeight: 0,
    pathType: "straight",
    pipeSystem: "tapered_70_73_76",
    protectionType: "double_pipe",
    sectionViewMode: "front",
    showDimensions: true,
    showPipeNodes: true,
    stovePosCm: 42,
    jackPosCm: 42,
    extraOutPipes: 0,
    productCategoryFilter: "all",
    tentDbFilter: "all",
    tentDbSearch: "",
    excluded: {},
    includedSoldOut: {},
    qtyOverrides: {},
    extraBuyItems: {},
    visitedLinks: {},
    isAiEstimated: false,
    isSearchingAi: false,
    adminUnlocked: false,
    adminPassword: "", // 메모리 전용 (잠금 시 즉시 초기화, localStorage 미저장)
    syncEndpoint: "/api/products",
    tentSyncEndpoint: "/api/tents",
    lastSyncInfo: "",
    lastTentSyncInfo: "",
    dragging: false,
    dragTarget: null,
    dragGeom: null,
    lockedMaxH: null,
    geom: null,
    lastBomText: ""
  };

  /* =========================================================
   * 3. 상품 & 텐트 DB 동기화 및 Supabase 영구 저장
   * ========================================================= */
  function extractProductNoFromUrl(url) {
    const m = String(url || "").match(/\/products\/(\d+)/);
    return m ? m[1] : "";
  }

  function syncStoveModelsFromProducts() {
    STOVE_MODELS.forEach((s) => {
      const p = s.pid ? PRODUCTS[s.pid] : null;
      if (!p) return;
      const prefix = s.mat === "titanium" ? "[티타늄]" : "[스텐]";
      const cleanName = p.name.replace(/^\[(스텐|티타늄)\]\s*/, "");
      s.name = `${prefix} ${cleanName} (${s.stoveHeight}cm)${/품절/.test(p.status) ? " [품절]" : ""}`;
      s.deleted = Boolean(p.deleted);
    });
  }

  function saveLocalAdminOverrides() {
    try {
      localStorage.setItem("ct_pro_products_override_v1", JSON.stringify(PRODUCTS));
    } catch (e) {}
  }

  function loadLocalAdminOverrides() {
    try {
      const ep = localStorage.getItem("ct_pro_sync_endpoint");
      if (ep) state.syncEndpoint = ep;
      const tep = localStorage.getItem("ct_pro_tent_sync_endpoint");
      if (tep) state.tentSyncEndpoint = tep;
      const raw = localStorage.getItem("ct_pro_products_override_v1");
      if (!raw) return;
      const map = JSON.parse(raw);
      if (map && typeof map === "object") {
        Object.keys(map).forEach((k) => {
          if (PRODUCTS[k]) Object.assign(PRODUCTS[k], map[k]);
          else PRODUCTS[k] = map[k];
        });
      }
    } catch (e) {}
  }

  function resetLocalProductsInMemory() {
    Object.keys(PRODUCTS).forEach((k) => { delete PRODUCTS[k]; });
    Object.keys(INITIAL_PRODUCTS).forEach((k) => {
      PRODUCTS[k] = JSON.parse(JSON.stringify(INITIAL_PRODUCTS[k]));
    });
    syncStoveModelsFromProducts();
  }

  function saveLocalTentOverrides() {
    try {
      localStorage.setItem("ct_pro_tents_override_v1", JSON.stringify(TENT_MODELS));
    } catch (e) {}
  }

  function loadLocalTentOverrides() {
    try {
      const raw = localStorage.getItem("ct_pro_tents_override_v1");
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr) || arr.length === 0) return;
      const valid = arr.filter((t) => t && t.id && t.brand && t.name);
      if (valid.length > 0) {
        TENT_MODELS.length = 0;
        valid.forEach((t) => TENT_MODELS.push(t));
      }
    } catch (e) {}
  }

  function resetLocalTentsInMemory() {
    TENT_MODELS.length = 0;
    INITIAL_TENTS.forEach((t) => TENT_MODELS.push(JSON.parse(JSON.stringify(t))));
  }

  function applyRemoteTents(remoteList) {
    if (!Array.isArray(remoteList)) {
      return { updated: 0, added: 0, removed: 0 };
    }
    // 기본 내장 36종 스냅샷을 기준으로 Supabase 변경(추가·수정·삭제)을 정확히 병합
    resetLocalTentsInMemory();

    let updated = 0, added = 0, removed = 0;
    const remoteAdded = [];

    remoteList.forEach((r) => {
      if (!r || !r.id) return;
      const idx = TENT_MODELS.findIndex((t) => t.id === r.id);

      if (r.deleted) {
        if (idx !== -1) {
          TENT_MODELS.splice(idx, 1);
          removed++;
        }
        return;
      }

      const normalized = {
        id: String(r.id),
        origin: r.origin === "해외" ? "해외" : "국내",
        brand: String(r.brand || "").trim(),
        name: String(r.name || "").trim(),
        shape: ["dome", "tipi", "tunnel", "cabin"].includes(r.shape) ? r.shape : "dome",
        w: Math.max(150, Math.min(800, Math.round(Number(r.w) || 320))),
        l: Math.max(150, Math.min(1000, Math.round(Number(r.l) || 400))),
        peakHeight: Math.max(130, Math.min(350, Math.round(Number(r.peakHeight) || 200))),
        sw: Math.max(0, Math.min(350, Math.round(Number(r.sw) || 0))),
        defaultJackHeight: Math.max(80, Math.min(320, Math.round(Number(r.defaultJackHeight) || 150))),
        defaultPath: ["straight", "elbow45", "elbow90"].includes(r.defaultPath) ? r.defaultPath : "straight",
        isRemoteSynced: true
      };

      if (!normalized.brand || !normalized.name) return;

      if (idx !== -1) {
        TENT_MODELS[idx] = normalized;
        updated++;
      } else {
        normalized.isAdminAdded = true;
        remoteAdded.push(normalized);
        added++;
      }
    });

    // Supabase에 신규 추가된 텐트를 목록 최상단에 노출
    if (remoteAdded.length > 0) {
      TENT_MODELS.unshift(...remoteAdded);
    }

    if (TENT_MODELS.length === 0) {
      resetLocalTentsInMemory();
    }

    if (state.selectedTentId !== "custom_tent" && !TENT_MODELS.some((t) => t.id === state.selectedTentId)) {
      state.selectedTentId = TENT_MODELS[0].id;
    }

    saveLocalTentOverrides();
    return { updated, added, removed };
  }

  async function syncTentsFromServer(showNotify) {
    const badge = byId("proTentSyncBadge");
    const isHttp = window.location && /^https?:\/\//i.test(window.location.href);
    if (!isHttp) {
      if (badge) badge.textContent = "로컬 미리보기 모드";
      return;
    }
    if (badge) badge.textContent = "⏳ 텐트 DB 동기화 중...";
    try {
      const url = state.tentSyncEndpoint || "/api/tents";
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (res.ok && data && data.ok && Array.isArray(data.tents)) {
        const stat = applyRemoteTents(data.tents);
        const tStr = data.syncedAt
          ? new Date(data.syncedAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
          : "방금";
        state.lastTentSyncInfo = `Supabase 연동됨 (${tStr} · 추가 ${stat.added} / 수정 ${stat.updated}${stat.removed ? ` / 삭제 ${stat.removed}` : ""})`;
        if (badge) {
          badge.textContent = `✓ ${state.lastTentSyncInfo}`;
          badge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200";
        }
        populateTentDropdown();
        renderTentsTab();
        updateUI();
        if (showNotify) {
          showToast(`텐트 DB Supabase 동기화 완료! (추가 ${stat.added}건, 수정 ${stat.updated}건, 삭제 ${stat.removed}건)`);
        }
      } else {
        const errMsg = (data && data.error) ? data.error : "텐트 API(/api/tents) 미연결";
        if (badge) {
          badge.textContent = "⚠️ 기본 내장 DB 사용 중 (API 연결 필요)";
          badge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200";
        }
        if (showNotify) showToast(`텐트 DB 동기화 실패: ${errMsg}`);
      }
    } catch (err) {
      if (badge) {
        badge.textContent = "⚠️ 기본 내장 DB 사용 중";
        badge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200";
      }
      if (showNotify) {
        showToast("텐트 동기화 API(/api/tents)에 연결할 수 없습니다. Vercel 배포 및 환경변수를 확인해 주세요.");
      }
    }
  }

  async function pushTentToServer(method, payload) {
    const isHttp = window.location && /^https?:\/\//i.test(window.location.href);
    if (!isHttp) {
      return { ok: false, offline: true, error: "로컬 미리보기 환경에서는 브라우저에만 임시 저장됩니다." };
    }
    try {
      const url = state.tentSyncEndpoint || "/api/tents";
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": state.adminPassword || ""
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data && data.ok) {
        return { ok: true, data };
      }
      return { ok: false, error: (data && data.error) || `HTTP ${res.status} 오류` };
    } catch (err) {
      return { ok: false, error: "서버(/api/tents) 연결 실패" };
    }
  }

  function updateTentCountLabels() {
    const total = TENT_MODELS.length;
    const kr = TENT_MODELS.filter((t) => t.origin === "국내").length;
    const intl = TENT_MODELS.filter((t) => t.origin === "해외").length;

    setText("tabBtn-tents", `⛺ 텐트 DB (${total}종)`);
    setText("tentDbTitle", `⛺ 국내·해외 인기 텐트 제원 DB (${total}종)`);

    document.querySelectorAll(".tent-origin-btn").forEach((b) => {
      const o = b.getAttribute("data-origin");
      if (o === "all") b.textContent = `전체 (${total})`;
      else if (o === "국내") b.textContent = `국내 (${kr})`;
      else if (o === "해외") b.textContent = `해외 (${intl})`;
    });

    document.querySelectorAll(".tent-db-filter-btn").forEach((b) => {
      const o = b.getAttribute("data-tfilter");
      if (o === "all") b.textContent = `전체 (${total})`;
      else if (o === "국내") b.textContent = `국내 (${kr})`;
      else if (o === "해외") b.textContent = `해외 (${intl})`;
    });
  }

  function syncOriginFilterButtons() {
    document.querySelectorAll(".tent-origin-btn").forEach((x) => {
      x.className = x.getAttribute("data-origin") === state.tentOriginFilter
        ? "tent-origin-btn py-1.5 rounded-lg text-xs font-bold bg-orange-600 text-white transition"
        : "tent-origin-btn py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition";
    });
  }

  function applyRemoteProducts(remoteList) {
    if (!Array.isArray(remoteList) || remoteList.length === 0) {
      return { updated: 0, added: 0, removed: 0 };
    }
    const byNo = {};
    Object.values(PRODUCTS).forEach((p) => {
      const no = extractProductNoFromUrl(p.url);
      if (no) byNo[no] = p;
    });

    let updated = 0, added = 0, removed = 0;
    const seenNos = new Set();

    remoteList.forEach((r) => {
      if (!r || !r.name) return;
      const no = String(r.productNo || extractProductNoFromUrl(r.url) || "").trim();
      if (no) seenNos.add(no);
      const target = (no && byNo[no]) || (r.id && !/^\d+$/.test(String(r.id)) && PRODUCTS[r.id]) || null;

      if (target) {
        if (r.deleted) {
          target.deleted = true;
          target.status = "삭제됨";
          removed++;
        } else {
          target.deleted = false;
          target.name = r.name;
          if (typeof r.price === "number" && r.price > 0) target.price = r.price;
          if (r.status) target.status = r.status;
          if (r.url && /^https?:\/\//i.test(r.url)) target.url = r.url;
          updated++;
        }
      } else if (!r.deleted && r.isChimneyAccessory !== false) {
        const newId = no ? `naver_${no}` : (r.id && !PRODUCTS[r.id] ? String(r.id) : `naver_${Date.now()}_${added}`);
        PRODUCTS[newId] = {
          id: newId,
          mat: r.mat || "stainless",
          isStove: Boolean(r.isStove),
          name: r.name,
          price: Number(r.price) || 0,
          status: r.status || "판매중",
          url: r.url || STORE_URL,
          isRemoteAdded: true
        };
        if (no) byNo[no] = PRODUCTS[newId];
        added++;
      }
    });

    if (seenNos.size >= 5) {
      Object.values(PRODUCTS).forEach((p) => {
        const no = extractProductNoFromUrl(p.url);
        if (no && !seenNos.has(no) && p.isRemoteAdded) {
          p.deleted = true;
          p.status = "삭제됨";
          removed++;
        }
      });
    }

    syncStoveModelsFromProducts();
    return { updated, added, removed };
  }

  async function syncProductsFromServer(showNotify) {
    const badge = byId("proSyncBadge");
    const isHttp = window.location && /^https?:\/\//i.test(window.location.href);
    if (!isHttp) {
      if (badge) badge.textContent = "로컬 미리보기 모드";
      return;
    }
    if (badge) badge.textContent = "⏳ 스토어 동기화 중...";
    try {
      const url = state.syncEndpoint || "/api/products";
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (res.ok && data && data.ok && Array.isArray(data.products)) {
        const stat = applyRemoteProducts(data.products);
        const tStr = data.syncedAt
          ? new Date(data.syncedAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
          : "방금";
        state.lastSyncInfo = `동기화 완료 (${tStr} · 변경 ${stat.updated} / 추가 ${stat.added}${stat.removed ? ` / 삭제 ${stat.removed}` : ""})`;
        if (badge) {
          badge.textContent = `✓ ${state.lastSyncInfo}`;
          badge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200";
        }
        populateStoveDropdown();
        renderProductsTab();
        updateUI();
        if (showNotify) {
          showToast(`스마트스토어 동기화 완료! (업데이트 ${stat.updated}건, 신규 ${stat.added}건, 삭제 ${stat.removed}건)`);
        }
      } else {
        const errMsg = (data && data.error) ? data.error : "동기화 API(/api/products) 미연결";
        if (badge) {
          badge.textContent = "⚠️ 기본 내장 DB 사용 중 (API 연결 필요)";
          badge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200";
        }
        if (showNotify) showToast(`동기화 실패: ${errMsg}`);
      }
    } catch (err) {
      if (badge) {
        badge.textContent = "⚠️ 기본 내장 DB 사용 중";
        badge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200";
      }
      if (showNotify) {
        showToast("동기화 API에 연결할 수 없습니다. Vercel의 api/products.js 및 환경변수를 확인해 주세요.");
      }
    }
  }

  function renderAdminUiState() {
    const hdrBtn = byId("adminToggleHeaderBtn");
    const panel = byId("proAdminPanel");
    const tentPanel = byId("proTentAdminPanel");
    const tentAdminTh = byId("tentDbAdminTh");
    const manSync = byId("proManualSyncBtn");
    const tentManSync = byId("proTentManualSyncBtn");
    const epInp = byId("proSyncEndpointInput");
    if (hdrBtn) hdrBtn.textContent = state.adminUnlocked ? "🔓" : "🔒";
    if (panel) panel.classList.toggle("hidden", !state.adminUnlocked);
    if (tentPanel) tentPanel.classList.toggle("hidden", !state.adminUnlocked);
    if (tentAdminTh) tentAdminTh.classList.toggle("hidden", !state.adminUnlocked);
    if (manSync) manSync.classList.toggle("hidden", !state.adminUnlocked);
    if (tentManSync) tentManSync.classList.toggle("hidden", !state.adminUnlocked);
    if (epInp) epInp.value = state.syncEndpoint || "/api/products";
    renderProductsTab();
    renderTentsTab();
  }

  /* =========================================================
   * 4. 선택 모델 조회 & 좌표 보정
   * ========================================================= */
  function getActiveStove() {
    const active = STOVE_MODELS.filter((s) => !s.deleted);
    const pool = active.length ? active : STOVE_MODELS;
    const found = pool.find((s) => s.id === state.selectedStoveId);
    if (found) return found;
    state.selectedStoveId = pool[0].id;
    return pool[0];
  }

  function getActiveTent() {
    const found = TENT_MODELS.find((t) => t.id === state.selectedTentId);
    if (found) return found;
    return {
      id: "custom_tent",
      origin: "직접입력",
      brand: "사용자",
      name: "직접 입력 텐트",
      shape: state.tentShape,
      w: state.customTentWidth,
      l: state.customTentLength,
      peakHeight: state.tentHeight,
      sw: state.tentShape === "tipi" ? 0 : 110,
      defaultJackHeight: state.jackHeight,
      defaultPath: state.pathType
    };
  }

  function getCurrentSpanCm() {
    const t = getActiveTent();
    return state.sectionViewMode === "side" ? t.l : t.w;
  }

  function clampStovePos(v) {
    const maxO = Math.max(40, Math.round(getCurrentSpanCm() / 2 - 28));
    return Math.max(-maxO, Math.min(maxO, Math.round(v)));
  }

  function clampJackForAngle(rawJackXCm, rawJackHCm) {
    const H_tent = Math.max(130, Math.min(350, Number(state.tentHeight) || 210));
    const H_start = (Number(state.stoveHeight) || 35) + (Number(state.standHeight) || 0);
    const rawFirst = state.pipeSystem === "single_75" ? 30 : 28;
    const halfSpan = Math.max(60, Math.round(getCurrentSpanCm() / 2 - 12));
    const maxJackH = Math.max(105, Math.round(H_tent) - 5);

    let jH = Math.round(Math.max(100, Math.min(maxJackH, rawJackHCm)));
    let jX = Math.round(Math.max(-halfSpan, Math.min(halfSpan, rawJackXCm)));

    if (state.pathType === "elbow45") {
      const minJackH45 = Math.min(maxJackH, Math.max(100, Math.round(H_start + rawFirst + 15)));
      jH = Math.max(minJackH45, jH);
      const maxD45 = Math.max(15, Math.round(jH - (H_start + rawFirst)));
      const dx = jX - state.stovePosCm;
      const sign = dx === 0 ? 1 : Math.sign(dx);
      const clampedD = Math.max(15, Math.min(maxD45, Math.abs(dx)));
      jX = Math.round(Math.max(-halfSpan, Math.min(halfSpan, state.stovePosCm + sign * clampedD)));
    } else if (state.pathType === "elbow90") {
      const minJackH90 = Math.min(maxJackH, Math.max(100, Math.round(H_start + rawFirst + 5)));
      jH = Math.max(minJackH90, jH);
      const dx = jX - state.stovePosCm;
      const sign = dx === 0 ? 1 : Math.sign(dx);
      const clampedD = Math.max(25, Math.min(130, Math.abs(dx)));
      jX = Math.round(Math.max(-halfSpan, Math.min(halfSpan, state.stovePosCm + sign * clampedD)));
    } else {
      const maxDAuto = Math.max(12, Math.round(jH - (H_start + rawFirst)));
      const dx = jX - state.stovePosCm;
      if (Math.abs(dx) > maxDAuto) {
        jX = Math.round(Math.max(-halfSpan, Math.min(halfSpan, state.stovePosCm + Math.sign(dx) * maxDAuto)));
      }
    }
    return { jackPosCm: jX, jackH: jH };
  }

  function resetStoveAndJackPositions() {
    const half = getCurrentSpanCm() / 2;
    if (state.pathType === "straight") {
      state.jackPosCm = Math.round(half * 0.28);
      state.stovePosCm = clampStovePos(state.jackPosCm);
    } else if (state.pathType === "elbow45") {
      state.jackPosCm = Math.round(half * 0.72);
      state.stovePosCm = clampStovePos(state.jackPosCm - 50);
      const fixed = clampJackForAngle(state.jackPosCm, state.jackHeight);
      state.jackPosCm = fixed.jackPosCm;
    } else {
      state.jackPosCm = Math.round(half * 0.96);
      state.stovePosCm = clampStovePos(state.jackPosCm - 65);
    }
  }

  function isFixed60or70Pipe(stoveObj, pipeSys) {
    return pipeSys === "single_70" || pipeSys === "ti_single_70_76" || Boolean(stoveObj && stoveObj.isRollPipe);
  }

  function buildShareQueryString() {
    const curTent = getActiveTent();
    const params = new URLSearchParams();
    params.set("tent", state.selectedTentId);
    if (curTent.id !== "custom_tent") params.set("tname", `${curTent.brand} ${curTent.name}`);
    params.set("th", String(state.tentHeight));
    params.set("jh", String(state.jackHeight));
    params.set("stove", state.selectedStoveId);
    params.set("sh", String(state.stoveHeight));
    params.set("st", String(state.standHeight));
    params.set("path", state.pathType);
    params.set("pipe", state.pipeSystem);
    params.set("prot", state.protectionType);
    if (state.extraOutPipes) params.set("ex", String(state.extraOutPipes));
    return params.toString();
  }

  /* =========================================================
   * 5. 드롭다운 & 소재별 자동 매칭
   * ========================================================= */
  function syncMaterialSelectors() {
    const stoveObj = getActiveStove();
    const isTi = stoveObj.mat === "titanium";
    const pipeEl = byId("pipeSystemSelect");
    const protEl = byId("protectionSelect");
    const hintEl = byId("proPipeMatHint");
    const protHintEl = byId("proProtCompatHint");
    const badgeEl = byId("proMaterialBadge");

    if (badgeEl) {
      badgeEl.textContent = isTi ? "🪶 티타늄 전용" : "🔩 스텐 전용";
      badgeEl.className = isTi
        ? "text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200"
        : "text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200";
    }
    if (hintEl) {
      hintEl.textContent = isTi ? "(티타늄 난로 → 티타늄 연통 전용)" : "(스테인리스 난로 → 스텐 연통 전용)";
      hintEl.className = isTi ? "text-[10px] font-bold text-indigo-600" : "text-[10px] font-bold text-slate-500";
    }

    if (pipeEl) {
      const opts = isTi
        ? [
            { v: "ti_nested_70_76", t: "티타늄 70-76파이 네스티드 3.0m 세트" },
            { v: "ti_single_70_76", t: "티타늄 70파이 단품 조합 (고정 Ø70)" },
            { v: "ti_nested_83_89", t: "티타늄 83-89파이 대형 세트" }
          ]
        : [
            { v: "tapered_70_73_76", t: "스텐 70-73-76파이 3.3m 세트 (추천)" },
            { v: "single_70", t: "스텐 70파이 단일 직관 (고정 Ø70)" },
            { v: "single_75", t: "스텐 75파이 단일 직관 (고정 Ø75)" }
          ];
      if (!opts.some((o) => o.v === state.pipeSystem)) state.pipeSystem = opts[0].v;
      pipeEl.innerHTML = opts.map((o) => `<option value="${o.v}">${o.t}</option>`).join("");
      pipeEl.value = state.pipeSystem;
    }

    const canUseTiGuard = isFixed60or70Pipe(stoveObj, state.pipeSystem);
    if (protEl) {
      const pOpts = isTi
        ? [
            { v: "mesh_guard", t: "스텐 메쉬 보호망 50cm (Ø60~90mm 유연 호환)" },
            ...(canUseTiGuard ? [{ v: "ti_guard_70", t: "포몰리 티타늄 보호망 가변식 (고정 Ø60·70mm 전용)" }] : [])
          ]
        : [
            { v: "double_pipe", t: "스텐 이중연통 50cm (기본)" },
            { v: "mesh_guard", t: "스텐 메쉬 보호망 50cm (Ø60~90mm 유연 호환)" },
            { v: "both_guard", t: "스텐 이중연통 + 메쉬망 (2중)" },
            ...(canUseTiGuard ? [{ v: "ti_guard_70", t: "포몰리 티타늄 보호망 가변식 (고정 Ø60·70mm 전용)" }] : [])
          ];
      if (!pOpts.some((o) => o.v === state.protectionType)) state.protectionType = pOpts[0].v;
      protEl.innerHTML = pOpts.map((o) => `<option value="${o.v}">${o.t}</option>`).join("");
      protEl.value = state.protectionType;
    }
    if (protHintEl) {
      protHintEl.textContent = canUseTiGuard
        ? "✓ 스텐 메쉬 보호망(Ø60~90mm 유연) · 포몰리 티타늄 보호망(고정 Ø60·70mm 전용) 모두 호환"
        : "ℹ️ 스텐 메쉬 보호망은 Ø60~90mm 유연 호환 · 포몰리 티타늄 보호망은 고정 Ø60·70mm 연통 전용으로 제외됨";
    }
  }

  function populateStoveDropdown() {
    const sel = byId("stoveSelect");
    if (!sel) return;
    sel.innerHTML = "";
    const activeStoves = STOVE_MODELS.filter((s) => !s.deleted);
    const pool = activeStoves.length ? activeStoves : STOVE_MODELS;
    if (!pool.some((s) => s.id === state.selectedStoveId)) {
      state.selectedStoveId = pool[0].id;
    }

    const gSt = document.createElement("optgroup");
    gSt.label = "🔩 스테인리스 난로 (스테인리스 연통 전용)";
    const gTi = document.createElement("optgroup");
    gTi.label = "🪶 티타늄 난로 (티타늄 연통 전용)";
    pool.forEach((s) => {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.name;
      if (s.id === state.selectedStoveId) o.selected = true;
      (s.mat === "titanium" ? gTi : gSt).appendChild(o);
    });
    if (gSt.children.length) sel.appendChild(gSt);
    if (gTi.children.length) sel.appendChild(gTi);
  }

  function populateTentDropdown() {
    const sel = byId("tentSelect");
    if (!sel) return;
    sel.innerHTML = "";
    const list = TENT_MODELS.filter((t) => state.tentOriginFilter === "all" || state.tentOriginFilter === "custom" || t.origin === state.tentOriginFilter);
    list.forEach((t) => {
      const o = document.createElement("option");
      o.value = t.id;
      o.textContent = `[${t.origin}] ${t.brand} ${t.name} (${t.l}×${t.w}×${t.peakHeight}cm)`;
      if (t.id === state.selectedTentId) o.selected = true;
      sel.appendChild(o);
    });
    const co = document.createElement("option");
    co.value = "custom_tent";
    co.textContent = "[직접 입력] 내 텐트 치수 직접 설정";
    if (state.selectedTentId === "custom_tent" || state.tentOriginFilter === "custom") co.selected = true;
    sel.appendChild(co);
  }

  function populateExtraAddSelect() {
    const sel = byId("proAddExtraSelect");
    if (!sel) return;
    const stoveObj = getActiveStove();
    const prevVal = sel.value;
    const canUseTiGuard = isFixed60or70Pipe(stoveObj, state.pipeSystem);
    const compat = Object.values(PRODUCTS).filter((p) => {
      if (p.deleted || p.isStove) return false;
      if (p.id === "p_ti_guard_70" && !canUseTiGuard) return false;
      return p.mat === stoveObj.mat || p.mat === "both";
    });
    sel.innerHTML = compat
      .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} — ${formatKRW(p.price)} (${escapeHtml(p.status)})</option>`)
      .join("");
    if (prevVal && compat.some((p) => p.id === prevVal)) sel.value = prevVal;
  }

  function syncInputsFromState() {
    setVal("tentSelect", state.selectedTentId);
    setVal("tentHeightInput", state.tentHeight);
    setVal("tentHeightSlider", state.tentHeight);
    setVal("jackHeightInput", state.jackHeight);
    setVal("jackHeightSlider", state.jackHeight);
    setVal("stoveSelect", state.selectedStoveId);
    setVal("stoveHeightInput", state.stoveHeight);
    setVal("stoveHeightSlider", state.stoveHeight);
    setVal("standHeightInput", state.standHeight);
    setVal("standHeightSlider", state.standHeight);
    setVal("pipeSystemSelect", state.pipeSystem);
    setVal("protectionSelect", state.protectionType);
  }

  function applyTentModel(tentId) {
    state.isAiEstimated = false;
    state.extraOutPipes = 0;
    if (tentId === "custom_tent") {
      state.selectedTentId = "custom_tent";
      resetStoveAndJackPositions();
      syncInputsFromState();
      updateUI();
      return;
    }
    const t = TENT_MODELS.find((x) => x.id === tentId);
    if (!t) return;
    state.selectedTentId = t.id;
    state.tentShape = t.shape;
    state.tentHeight = t.peakHeight;
    state.jackHeight = t.defaultJackHeight;
    state.pathType = t.defaultPath;
    resetStoveAndJackPositions();
    syncInputsFromState();
    updateUI();
  }

  function applyStoveModel(stoveId) {
    const prevMat = getActiveStove().mat;
    const s = STOVE_MODELS.find((x) => x.id === stoveId && !x.deleted) || getActiveStove();
    state.selectedStoveId = s.id;
    state.stoveHeight = s.stoveHeight;
    state.pipeSystem = s.recommendedPipeSystem;
    state.protectionType = s.mat === "titanium"
      ? (isFixed60or70Pipe(s, s.recommendedPipeSystem) ? "ti_guard_70" : "mesh_guard")
      : "double_pipe";
    syncMaterialSelectors();
    syncInputsFromState();
    updateUI();
    if (prevMat !== s.mat) {
      showToast(
        s.mat === "titanium"
          ? "🪶 티타늄 난로 선택으로 티타늄 전용 연통으로 자동 변경되었습니다."
          : "🔩 스테인리스 난로 선택으로 스테인리스 전용 연통으로 자동 변경되었습니다."
      );
    }
  }

  /* =========================================================
   * 6. 시뮬레이션 계산 엔진
   * ========================================================= */
  function computeSimulation() {
    const stoveObj = getActiveStove();
    const H_tent = Math.max(130, Math.min(350, Number(state.tentHeight) || 210));
    const H_jack = Math.max(80, Math.min(320, Number(state.jackHeight) || 175));
    const H_stove = Math.max(20, Math.min(90, Number(state.stoveHeight) || 35));
    const H_stand = Math.max(0, Math.min(80, Number(state.standHeight) || 0));
    const H_start = round1(H_stove + H_stand);

    const isTi3mSet = (stoveObj.id === "lumora_ti" || stoveObj.id === "dweller_ti3") && state.pipeSystem === "ti_nested_70_76";
    const isMstove33mSet = (stoveObj.id === "mstove_v3" || stoveObj.id === "mstove_v2_down") && state.pipeSystem === "tapered_70_73_76";
    const overlap = isTi3mSet ? 3 : 5;
    const rawPipe = isTi3mSet ? 30 : (state.pipeSystem === "single_75" ? 32 : 33);
    const effPipe = rawPipe - overlap;
    const rawFirst = isTi3mSet ? 30 : (state.pipeSystem === "single_75" ? 30 : 28);

    const span = getCurrentSpanCm();
    const half = span / 2;
    const pos = clampStovePos(state.stovePosCm);
    const jackXCm = Math.round(state.jackPosCm);
    const D_horiz = Math.abs(jackXCm - pos);
    const minWall = Math.min(Math.max(0, Math.round(half + pos - 20)), Math.max(0, Math.round(half - pos - 20)));

    let effMode = state.pathType;
    let autoBypass = false;
    if (state.pathType === "straight" && D_horiz > 12) {
      effMode = "elbow45";
      autoBypass = true;
    }

    const minTop = Math.max(H_tent + SPARK_MIN_CLEARANCE_CM, H_jack + 70);
    let elbowCnt = 0, elbowAng = 0, inVert = 0, midLen = 0, outVert = 0, reqEff = 0;

    if (effMode === "straight") {
      reqEff = Math.max(60, minTop - H_start);
      inVert = Math.max(0, H_jack - H_start);
      outVert = Math.max(0, reqEff - inVert);
    } else if (effMode === "elbow45") {
      elbowCnt = 2;
      elbowAng = 45;
      const diagRise = Math.max(15, Math.min(D_horiz, Math.max(15, H_jack - (H_start + rawFirst))));
      const e1 = Math.max(H_start + rawFirst, H_jack - diagRise);
      inVert = Math.max(rawFirst, e1 - H_start);
      const rise = Math.max(15, H_jack - (H_start + inVert));
      midLen = Math.round(Math.sqrt(D_horiz * D_horiz + rise * rise));
      outVert = Math.max(60, minTop - H_jack);
      reqEff = inVert + midLen + outVert;
    } else {
      elbowCnt = 2;
      elbowAng = 90;
      inVert = Math.max(rawFirst, H_jack - H_start);
      midLen = D_horiz + 35;
      outVert = Math.max(80, minTop - H_jack);
      reqEff = inVert + midLen + outVert;
    }

    const elbowEff = elbowCnt * (17 - overlap);
    const reqStraightCnt = Math.max(2, Math.ceil(Math.max(0, reqEff - rawFirst - elbowEff) / effPipe));

    const isTapered70Base = state.pipeSystem === "tapered_70_73_76" || state.pipeSystem === "ti_nested_70_76";
    let pipe70Count = 5;
    let extra70ForElbow = 0;
    if (elbowCnt > 0 && isTapered70Base) {
      const lenToElbow2 = inVert + midLen;
      const straightToElbow2 = Math.max(1, Math.ceil(Math.max(0, lenToElbow2 - rawFirst - elbowEff) / effPipe));
      const req70Total = 1 + straightToElbow2;
      pipe70Count = Math.max(5, req70Total);
      extra70ForElbow = Math.max(0, req70Total - 5);
    }

    const defaultIncludedStraight = (isTi3mSet || isMstove33mSet) ? Math.max(2, (stoveObj.includedPipes || 0) - 1) : 2;
    const minStraightForTapered = (elbowCnt > 0 && isTapered70Base) ? Math.max(2, pipe70Count + 1) : 2;
    const baseStraightCnt = Math.max(reqStraightCnt, defaultIncludedStraight, minStraightForTapered);
    const extraOutPipes = Math.max(-4, Math.min(6, Number(state.extraOutPipes) || 0));
    const straightCnt = Math.max(minStraightForTapered, baseStraightCnt + extraOutPipes);
    const actualExtraPipes = straightCnt - baseStraightCnt;
    const extraOutCm = actualExtraPipes * effPipe;

    const totalSeg = 1 + straightCnt;
    const joints = (totalSeg - 1) + elbowCnt;
    const rawTotal = rawFirst + straightCnt * rawPipe + elbowCnt * 17;
    const lost = joints * overlap;
    const effTotal = rawTotal - lost;
    const baseRawTotal = rawFirst + baseStraightCnt * rawPipe + elbowCnt * 17;
    const baseEffTotal = baseRawTotal - (((1 + baseStraightCnt) - 1 + elbowCnt) * overlap);
    const baseExtraRound = Math.max(0, baseEffTotal - reqEff);
    const topH = effMode === "straight"
      ? round1(H_start + effTotal)
      : Math.round(H_jack + outVert + baseExtraRound + extraOutCm);
    const roofClr = round1(topH - H_tent);
    const sparkSafe = roofClr >= SPARK_MIN_CLEARANCE_CM;

    const warns = [];
    let blocked = false;
    if (H_jack - H_start < 50) {
      blocked = true;
      warns.push(`[설치 불가] 배기구(${H_start}cm)와 홀잭(${H_jack}cm) 사이가 ${round1(H_jack - H_start)}cm뿐이라 50cm 스킨 보호 연통을 넣을 수 없습니다.`);
    }
    if (H_jack >= H_tent) {
      blocked = true;
      warns.push(`[입력 오류] 홀잭 높이(${H_jack}cm)가 텐트 최고 높이(${H_tent}cm)보다 낮아야 합니다.`);
    }
    if (!blocked && !sparkSafe) {
      warns.push(`[불티 손상 주의] 텐트 천장 위 연통 높이가 +${roofClr}cm로 최소 권장(+${SPARK_MIN_CLEARANCE_CM}cm)보다 낮습니다.`);
    }
    if (minWall < 45) {
      warns.push(`난로가 텐트 벽면과 너무 가깝습니다(${minWall}cm). 최소 45cm 이상 떨어뜨려 주세요.`);
    }
    if (autoBypass) {
      warns.push(`난로와 홀잭이 수평 ${D_horiz}cm 떨어져 45° 엘보 2개 우회 경로가 자동 적용되었습니다.`);
    }

    let diff = "쉬움 ★☆☆", diffColor = "text-emerald-700";
    if (effMode === "elbow90" || topH > 430 || blocked || minWall < 45) {
      diff = "고급 ★★★"; diffColor = "text-rose-700";
    } else if (effMode === "elbow45" || totalSeg > 12 || topH > 380) {
      diff = "중급 ★★☆"; diffColor = "text-amber-700";
    }

    return {
      H_tent, H_jack, H_stove, H_stand, H_start, span, pos, jackXCm, D_horiz, minWall,
      effMode, elbowCnt, elbowAng, inVert, midLen, outVert, rawPipe, effPipe, rawFirst, overlap,
      isTi3mSet, isMstove33mSet, pipe70Count, extra70ForElbow, straightCnt, actualExtraPipes, extraOutCm,
      totalSeg, joints, rawTotal, lost, effTotal, topH, roofClr, sparkSafe, warns, blocked, diff, diffColor
    };
  }

  /* =========================================================
   * 7. SVG 실시간 도면 렌더러
   * ========================================================= */
  function renderSvgDiagram(sim) {
    const svg = byId("simSvg");
    if (!svg) return;

    const W = 860, H = 470, gY = 412;
    const baseMaxH = Math.max(sim.H_tent + 165, sim.topH + 38, 410);
    const maxH = (state.dragging && state.lockedMaxH) ? Math.max(state.lockedMaxH, sim.topH + 25) : baseMaxH;
    const scaleY = (gY - 42) / maxH;
    const yOf = (cm) => Math.round(gY - cm * scaleY);
    const t = getActiveTent();
    const cx = 395;
    const scaleX = Math.min(scaleY, (210 * 2) / Math.max(240, sim.span));
    const halfW = Math.round((sim.span / 2) * scaleX);
    const lx = cx - halfW, rx = cx + halfW, py = yOf(sim.H_tent);
    const swCm = Math.round(sim.H_tent * (t.peakHeight > 0 ? t.sw / t.peakHeight : 0.45));
    const swY = yOf(swCm);

    state.geom = { cx, scaleX, gY, scaleY, span: sim.span };

    let tentD = "";
    if (state.tentShape === "tipi") {
      tentD = `M ${lx},${gY} L ${cx},${py} L ${rx},${gY} Z`;
    } else if (state.tentShape === "cabin") {
      tentD = `M ${lx},${gY} L ${lx + 6},${swY} L ${cx},${py} L ${rx - 6},${swY} L ${rx},${gY} Z`;
    } else if (state.tentShape === "tunnel" && state.sectionViewMode === "side") {
      tentD = `M ${lx},${gY} Q ${lx + 10},${yOf(sim.H_tent * 0.88)} ${lx + 42},${py + 5} L ${rx - 42},${py + 5} Q ${rx - 10},${yOf(sim.H_tent * 0.88)} ${rx},${gY} Z`;
    } else {
      tentD = `M ${lx},${gY} Q ${lx + halfW * 0.14},${py - 22} ${cx},${py} Q ${rx - halfW * 0.14},${py - 22} ${rx},${gY} Z`;
    }

    const sx = Math.round(cx + sim.pos * scaleX);
    const jx = Math.round(cx + sim.jackXCm * scaleX);
    const stTopY = yOf(sim.H_start), standY = yOf(sim.H_stand), jY = yOf(sim.H_jack), topY = yOf(sim.topH);

    let pts = [];
    let jackPt = { x: jx, y: jY, ang: 0 };
    let topPt = { x: jx, y: topY };
    if (sim.effMode === "straight") {
      pts = [{ x: sx, y: stTopY }, { x: sx, y: topY }];
      jackPt = { x: sx, y: jY, ang: 0 };
      topPt = { x: sx, y: topY };
    } else if (sim.effMode === "elbow45") {
      const e1Y = yOf(sim.H_start + sim.inVert);
      pts = [{ x: sx, y: stTopY }, { x: sx, y: e1Y }, { x: jx, y: jY }, { x: jx, y: topY }];
      const dir = jx >= sx ? 1 : -1;
      jackPt = { x: jx - dir * 5, y: jY + 5, ang: dir * 45 };
    } else {
      const outDir = jx >= cx ? 1 : -1;
      const outX = Math.min(638, Math.max(152, jx + outDir * Math.max(24, Math.round(35 * scaleX))));
      pts = [{ x: sx, y: stTopY }, { x: sx, y: jY }, { x: outX, y: jY }, { x: outX, y: topY }];
      jackPt = { x: jx, y: jY, ang: 90 };
      topPt = { x: outX, y: topY };
    }

    const edges = [];
    let totalPx = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y, len = Math.hypot(dx, dy);
      edges.push({ dx, dy, len, s: totalPx, e: totalPx + len, p0: pts[i], p1: pts[i + 1] });
      totalPx += len;
    }

    const sample = (d) => {
      const dd = Math.max(0, Math.min(totalPx, d));
      for (let i = 0; i < edges.length; i++) {
        const g = edges[i];
        if (dd <= g.e || i === edges.length - 1) {
          const tv = g.len > 0 ? (dd - g.s) / g.len : 0;
          const ux = g.len > 0 ? g.dx / g.len : 0, uy = g.len > 0 ? g.dy / g.len : -1;
          return { x: g.p0.x + g.dx * tv, y: g.p0.y + g.dy * tv, ux, uy, nx: -uy, ny: ux };
        }
      }
      return { x: sx, y: stTopY, ux: 0, uy: -1, nx: 1, ny: 0 };
    };

    const subPoly = (d0, d1) => {
      const arr = [];
      const a = sample(d0);
      arr.push(`${a.x.toFixed(1)},${a.y.toFixed(1)}`);
      for (let i = 0; i < edges.length - 1; i++) {
        if (edges[i].e > d0 + 0.5 && edges[i].e < d1 - 0.5) {
          arr.push(`${edges[i].p1.x.toFixed(1)},${edges[i].p1.y.toFixed(1)}`);
        }
      }
      const b = sample(d1);
      arr.push(`${b.x.toFixed(1)},${b.y.toFixed(1)}`);
      return arr.join(" ");
    };

    const placedBoxes = [];
    const overlapsAny = (x, y, w, h) => placedBoxes.some((b) => !(x + w + 4 < b.x || x > b.x + b.w + 4 || y + h + 3 < b.y || y > b.y + b.h + 3));
    const reserveBox = (x, y, w, h) => { placedBoxes.push({ x, y, w, h }); };

    const sparkMinY = yOf(sim.H_tent + SPARK_MIN_CLEARANCE_CM);
    const sparkLineCol = sim.sparkSafe ? "#059669" : "#e11d48";
    const sparkBoxX = 12, sparkBoxW = 148, sparkBoxH = 18;
    const sparkBoxY = Math.max(8, Math.min(py - 26, sparkMinY - 21));
    reserveBox(sparkBoxX, sparkBoxY, sparkBoxW, sparkBoxH);

    const lDim = 62;
    const tentDimMidY = Math.max(sparkBoxY + sparkBoxH + 18, Math.round((gY + py) / 2));
    reserveBox(lDim - 40, tentDimMidY - 10, 80, 20);

    const roofDimX = 664;
    const roofMidY = Math.max(24, Math.min(gY - 56, Math.round((py + topY) / 2)));
    reserveBox(roofDimX + 6, roofMidY - 10, 112, 20);

    const rDim = 804;
    const totalDimMidY = Math.max(roofMidY + 30, Math.min(gY - 24, Math.round(topY + (gY - topY) * 0.65)));
    reserveBox(rDim - 44, totalDimMidY - 10, 88, 20);

    const jackSide = jackPt.x >= cx ? 1 : -1;
    const jBadgeW = 94, jBadgeH = 20;
    let jBadgeX = jackSide > 0 ? Math.min(646 - jBadgeW, jackPt.x + 28) : Math.max(165, jackPt.x - 28 - jBadgeW);
    let jBadgeY = Math.max(18, Math.min(gY - 34, jackPt.y - 10));
    if (overlapsAny(jBadgeX, jBadgeY, jBadgeW, jBadgeH)) {
      jBadgeX = jackSide > 0 ? Math.max(165, jackPt.x - 28 - jBadgeW) : Math.min(646 - jBadgeW, jackPt.x + 28);
    }
    reserveBox(jBadgeX, jBadgeY, jBadgeW, jBadgeH);

    let pipesHtml = `<polyline points="${pts.map((p) => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="#334155" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>`;
    let ticksHtml = "", labelsHtml = "";
    const totalW = Math.max(1, sim.rawFirst + sim.straightCnt * sim.effPipe);
    const safeTotalPx = Math.max(1, totalPx);
    let accW = 0;
    const isTiMat = getActiveStove().mat === "titanium";
    const p70End = sim.pipe70Count || 5;

    for (let i = 0; i < sim.totalSeg; i++) {
      const w = i === 0 ? sim.rawFirst : sim.effPipe;
      const d0 = (accW / totalW) * safeTotalPx;
      accW += w;
      const d1 = (accW / totalW) * safeTotalPx;
      const isTopCap = i === sim.totalSeg - 1;
      const isExtraAdded = !isTopCap && sim.actualExtraPipes > 0 && i >= sim.totalSeg - 1 - sim.actualExtraPipes;

      let dia = "Ø70", col = "#f59e0b";
      if (isTiMat) {
        if (state.pipeSystem === "ti_nested_83_89") {
          if (isTopCap) { dia = "Ti Ø89캡"; col = "#7c3aed"; }
          else {
            dia = i === 0 ? "Ti Ø83댐퍼" : (i < Math.ceil(sim.totalSeg / 2) ? "Ti Ø83" : "Ti Ø89");
            col = i < Math.ceil(sim.totalSeg / 2) ? "#6366f1" : "#7c3aed";
          }
        } else if (state.pipeSystem === "ti_nested_70_76") {
          if (isTopCap) { dia = "Ti Ø76캡"; col = "#a855f7"; }
          else if (i < p70End) { dia = i >= 5 ? "Ti Ø70+" : "Ti Ø70"; col = i >= 5 ? "#0284c7" : "#6366f1"; }
          else if (i === p70End) { dia = "Ti 70-76"; col = "#4f46e5"; }
          else { dia = "Ti Ø76"; col = "#8b5cf6"; }
        } else {
          dia = isTopCap ? "Ti Ø70캡" : (i === 0 ? "Ti Ø70댐퍼" : "Ti Ø70");
          col = isTopCap ? "#7c3aed" : "#6366f1";
        }
      } else if (state.pipeSystem === "tapered_70_73_76") {
        if (isTopCap) { dia = "Ø76캡"; col = "#f43f5e"; }
        else if (i === 0) { dia = "Ø70댐퍼"; col = "#f59e0b"; }
        else if (i < p70End) { dia = i >= 5 ? "Ø70+" : "Ø70"; col = i >= 5 ? "#0284c7" : "#f59e0b"; }
        else if (i === p70End) { dia = "70-73"; col = "#ea580c"; }
        else if (i <= p70End + 4) { dia = "Ø73"; col = "#f97316"; }
        else if (i === p70End + 5) { dia = "73-76"; col = "#e11d48"; }
        else { dia = "Ø76"; col = "#f43f5e"; }
      } else if (state.pipeSystem === "single_70") {
        dia = isTopCap ? "Ø70캡" : (i === 0 ? "Ø70댐퍼" : "Ø70");
      } else {
        dia = isTopCap ? "Ø75캡" : (i === 0 ? "70-75" : "Ø75");
        col = i === 0 ? "#f59e0b" : "#f97316";
      }
      if (isExtraAdded) col = "#0284c7";

      pipesHtml += `<polyline points="${subPoly(d0, d1)}" fill="none" stroke="${col}" stroke-width="7.5" stroke-linejoin="round"/>`;

      if (i > 0) {
        const jp = sample(d0);
        ticksHtml += `<line x1="${(jp.x - jp.nx * 7).toFixed(1)}" y1="${(jp.y - jp.ny * 7).toFixed(1)}" x2="${(jp.x + jp.nx * 7).toFixed(1)}" y2="${(jp.y + jp.ny * 7).toFixed(1)}" stroke="#fff" stroke-width="2.4"/>`;
        ticksHtml += `<line x1="${(jp.x - jp.nx * 7).toFixed(1)}" y1="${(jp.y - jp.ny * 7).toFixed(1)}" x2="${(jp.x + jp.nx * 7).toFixed(1)}" y2="${(jp.y + jp.ny * 7).toFixed(1)}" stroke="#0f172a" stroke-width="1.1"/>`;
      }

      if (state.showPipeNodes) {
        const mp = sample((d0 + d1) / 2);
        const horiz = Math.abs(mp.ux) > 0.7;
        const txt = `${i + 1}·${dia}${isExtraAdded ? "+" : ""}`;
        const pw = Math.max(40, txt.length * 5.8 + 10);
        const ph = 15;
        const prefSide = i % 2 === 0 ? -1 : 1;

        const candidates = horiz
          ? [
              { cx: mp.x, cy: mp.y - 18 },
              { cx: mp.x, cy: mp.y + 18 },
              { cx: mp.x, cy: mp.y - 34 },
              { cx: mp.x, cy: mp.y + 34 }
            ]
          : [
              { cx: mp.x + prefSide * (pw / 2 + 18), cy: mp.y },
              { cx: mp.x - prefSide * (pw / 2 + 18), cy: mp.y },
              { cx: mp.x + prefSide * (pw / 2 + 24), cy: mp.y - 16 },
              { cx: mp.x - prefSide * (pw / 2 + 24), cy: mp.y - 16 },
              { cx: mp.x + prefSide * (pw / 2 + 24), cy: mp.y + 16 },
              { cx: mp.x - prefSide * (pw / 2 + 24), cy: mp.y + 16 },
              { cx: mp.x + prefSide * (pw / 2 + 64), cy: mp.y },
              { cx: mp.x - prefSide * (pw / 2 + 64), cy: mp.y }
            ];

        let chosen = null;
        for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
          const cand = candidates[cIdx];
          const bx = Math.max(115, Math.min(646 - pw, cand.cx - pw / 2));
          const by = Math.max(8, Math.min(gY - ph - 8, cand.cy - ph / 2));
          if (!overlapsAny(bx, by, pw, ph)) {
            chosen = { bx, by, lxPos: bx + pw / 2, lyPos: by + ph / 2 };
            break;
          }
        }
        if (chosen) {
          reserveBox(chosen.bx, chosen.by, pw, ph);
          labelsHtml += `
            <line x1="${mp.x.toFixed(1)}" y1="${mp.y.toFixed(1)}" x2="${chosen.lxPos.toFixed(1)}" y2="${chosen.lyPos.toFixed(1)}" stroke="${col}" stroke-width="1" stroke-opacity="0.7"/>
            <rect x="${chosen.bx.toFixed(1)}" y="${chosen.by.toFixed(1)}" width="${pw.toFixed(1)}" height="${ph}" rx="4" fill="#fff" stroke="${col}" stroke-width="1.2"/>
            <text x="${chosen.lxPos.toFixed(1)}" y="${(chosen.lyPos + 3.2).toFixed(1)}" fill="#0f172a" font-size="8.6" font-weight="800" text-anchor="middle">${txt}</text>
          `;
        }
      }
    }

    const sleevePx = Math.max(26, Math.round(50 * scaleY));
    const jLeaderX = jBadgeX > jackPt.x ? jBadgeX : jBadgeX + jBadgeW;
    const jackHtml = `
      <g id="draggableJackGroup" style="cursor: move; touch-action: none;">
        <g transform="translate(${jackPt.x},${jackPt.y})">
          <circle cx="0" cy="0" r="26" fill="transparent"/>
          <g transform="rotate(${jackPt.ang})">
            <line x1="-12" y1="${-sleevePx / 2}" x2="-12" y2="${sleevePx / 2}" stroke="#0284c7" stroke-width="4" stroke-linecap="round"/>
            <line x1="12" y1="${-sleevePx / 2}" x2="12" y2="${sleevePx / 2}" stroke="#0284c7" stroke-width="4" stroke-linecap="round"/>
            <line x1="-16" y1="${-sleevePx / 2}" x2="16" y2="${-sleevePx / 2}" stroke="#0369a1" stroke-width="3.2" stroke-linecap="round"/>
            <line x1="-16" y1="${sleevePx / 2}" x2="16" y2="${sleevePx / 2}" stroke="#0369a1" stroke-width="3.2" stroke-linecap="round"/>
            <line x1="-18" y1="0" x2="-9" y2="0" stroke="#ea580c" stroke-width="3.2" stroke-linecap="round"/>
            <line x1="9" y1="0" x2="18" y2="0" stroke="#ea580c" stroke-width="3.2" stroke-linecap="round"/>
          </g>
        </g>
        <line x1="${jackPt.x}" y1="${jackPt.y}" x2="${jLeaderX}" y2="${jBadgeY + jBadgeH / 2}" stroke="#0284c7" stroke-width="1.3" stroke-dasharray="3,2"/>
        <rect x="${jBadgeX}" y="${jBadgeY}" width="${jBadgeW}" height="${jBadgeH}" rx="10" fill="#ffffff" fill-opacity="0.96" stroke="#0284c7" stroke-width="1.6"/>
        <text x="${jBadgeX + jBadgeW / 2}" y="${jBadgeY + 13.5}" fill="#0369a1" font-size="9.5" font-weight="800" text-anchor="middle">✥ 홀잭 ${sim.H_jack}cm</text>
      </g>
    `;

    const sparkLineHtml = `
      <line x1="12" y1="${sparkMinY}" x2="650" y2="${sparkMinY}" stroke="${sparkLineCol}" stroke-width="1.4" stroke-dasharray="5,4" stroke-opacity="0.8"/>
      <rect x="${sparkBoxX}" y="${sparkBoxY}" width="${sparkBoxW}" height="${sparkBoxH}" rx="4" fill="#ffffff" fill-opacity="0.95" stroke="${sparkLineCol}" stroke-width="1.2"/>
      <text x="${sparkBoxX + sparkBoxW / 2}" y="${sparkBoxY + 12.2}" fill="${sparkLineCol}" font-size="8.8" font-weight="800" text-anchor="middle">🔥 불티방지 최소 +${SPARK_MIN_CLEARANCE_CM}cm</text>
    `;

    let dimHtml = "";
    if (state.showDimensions) {
      const clrCol = sim.sparkSafe ? "#059669" : "#e11d48";
      dimHtml = `
        <line x1="${lDim}" y1="${gY}" x2="${lDim}" y2="${py}" stroke="#475569" stroke-width="1.6"/>
        <line x1="${lDim - 5}" y1="${py}" x2="${cx}" y2="${py}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="3,3"/>
        <rect x="${lDim - 40}" y="${tentDimMidY - 10}" width="80" height="20" rx="5" fill="#fff" stroke="#475569"/>
        <text x="${lDim}" y="${tentDimMidY + 3.5}" fill="#0f172a" font-size="9.8" font-weight="bold" text-anchor="middle">텐트 ${sim.H_tent}cm</text>

        <line x1="${cx}" y1="${py}" x2="${roofDimX + 6}" y2="${py}" stroke="${clrCol}" stroke-width="1.1" stroke-dasharray="3,3"/>
        <line x1="${topPt.x}" y1="${topY}" x2="${roofDimX + 6}" y2="${topY}" stroke="${clrCol}" stroke-width="1.1" stroke-dasharray="3,3"/>
        <line x1="${roofDimX - 4}" y1="${py}" x2="${roofDimX + 4}" y2="${py}" stroke="${clrCol}" stroke-width="2"/>
        <line x1="${roofDimX - 4}" y1="${topY}" x2="${roofDimX + 4}" y2="${topY}" stroke="${clrCol}" stroke-width="2"/>
        <line x1="${roofDimX}" y1="${py}" x2="${roofDimX}" y2="${topY}" stroke="${clrCol}" stroke-width="2.2"/>
        <rect x="${roofDimX + 6}" y="${roofMidY - 10}" width="112" height="20" rx="5" fill="#fff" stroke="${clrCol}" stroke-width="1.4"/>
        <text x="${roofDimX + 62}" y="${roofMidY + 3.5}" fill="${clrCol}" font-size="9.3" font-weight="800" text-anchor="middle">천장~연통끝 ${sim.roofClr >= 0 ? "+" : ""}${sim.roofClr}cm</text>

        <line x1="${rDim}" y1="${gY}" x2="${rDim}" y2="${topY}" stroke="#ea580c" stroke-width="1.8"/>
        <line x1="${roofDimX + 6}" y1="${topY}" x2="${rDim + 5}" y2="${topY}" stroke="#ea580c" stroke-width="1" stroke-dasharray="3,3"/>
        <rect x="${rDim - 44}" y="${totalDimMidY - 10}" width="88" height="20" rx="5" fill="#fff" stroke="#ea580c" stroke-width="1.4"/>
        <text x="${rDim}" y="${totalDimMidY + 3.5}" fill="#c2410c" font-size="9.5" font-weight="bold" text-anchor="middle">총높이 ${sim.topH}cm</text>

        <line x1="${lx}" y1="${gY + 40}" x2="${rx}" y2="${gY + 40}" stroke="#64748b" stroke-width="1.3"/>
        <line x1="${lx}" y1="${gY + 34}" x2="${lx}" y2="${gY + 46}" stroke="#64748b" stroke-width="1.3"/>
        <line x1="${rx}" y1="${gY + 34}" x2="${rx}" y2="${gY + 46}" stroke="#64748b" stroke-width="1.3"/>
        <rect x="${cx - 58}" y="${gY + 30}" width="116" height="19" rx="4" fill="#fff" stroke="#cbd5e1"/>
        <text x="${cx}" y="${gY + 43}" fill="#334155" font-size="9.5" font-weight="bold" text-anchor="middle">${state.sectionViewMode === "side" ? "길이" : "폭"} ${sim.span}cm</text>
      `;
    }

    const standHpx = Math.max(0, gY - standY);
    const stoveHpx = Math.max(14, standY - stTopY);

    svg.innerHTML = `
      <defs>
        <linearGradient id="proTentGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#fef3c7" stop-opacity="0.72"/>
          <stop offset="100%" stop-color="#fde68a" stop-opacity="0.42"/>
        </linearGradient>
      </defs>
      ${[100, 200, 300, 400].filter((c) => c <= maxH).map((c) => `<line x1="14" y1="${yOf(c)}" x2="${W - 14}" y2="${yOf(c)}" stroke="#e2e8f0" stroke-dasharray="2,2"/><text x="16" y="${yOf(c) - 3}" fill="#94a3b8" font-size="8.5">${c}cm</text>`).join("")}
      <rect x="0" y="${gY}" width="${W}" height="${H - gY}" fill="#e2e8f0"/>
      <line x1="14" y1="${gY}" x2="${W - 14}" y2="${gY}" stroke="#475569" stroke-width="2.2"/>
      <path d="${tentD}" fill="url(#proTentGrad)" stroke="#b45309" stroke-width="2.4" stroke-linejoin="round"/>
      ${sparkLineHtml}
      <g id="draggableStoveGroup" style="cursor:ew-resize; touch-action:none;">
        ${sim.H_stand > 0 ? `<rect x="${sx - 26}" y="${standY}" width="52" height="${standHpx}" rx="3" fill="#bae6fd" fill-opacity="0.7" stroke="#0284c7" stroke-width="1.8"/>` : ""}
        <rect x="${sx - 23}" y="${stTopY}" width="46" height="${stoveHpx}" rx="5" fill="#334155" stroke="#ea580c" stroke-width="2"/>
        <path d="M ${sx - 6},${standY - 5} Q ${sx},${stTopY + 4} ${sx + 6},${standY - 5} Z" fill="#fb923c" class="flame-anim"/>
        <rect x="${sx - 26}" y="${gY + 4}" width="52" height="15" rx="7.5" fill="#ea580c" stroke="#fff" stroke-width="1.2"/>
        <text x="${sx}" y="${gY + 14.5}" fill="#fff" font-size="8.5" font-weight="bold" text-anchor="middle">↔ 이동</text>
      </g>
      ${pipesHtml}
      ${ticksHtml}
      ${jackHtml}
      ${labelsHtml}
      <rect x="${topPt.x - 6}" y="${topY - 7}" width="12" height="9" rx="2" fill="#e11d48" stroke="#be123c" stroke-width="1.3"/>
      <circle cx="${topPt.x}" cy="${topY - 16}" r="4.5" fill="#94a3b8" class="smoke-1"/>
      <circle cx="${topPt.x + 5}" cy="${topY - 24}" r="6" fill="#94a3b8" class="smoke-2"/>
      <circle cx="${topPt.x - 4}" cy="${topY - 31}" r="7.5" fill="#94a3b8" class="smoke-3"/>
      ${dimHtml}
    `;
  }

  /* =========================================================
   * 8. BOM (기본포함 / 추가구매) 계산 및 화면 갱신
   * ========================================================= */
  function buildBomItems(sim) {
    const stoveObj = getActiveStove();
    const isTi = stoveObj.mat === "titanium";
    const includedList = [];
    const buyList = [];

    const addBuy = (pid, qty, cat, note) => {
      if (!qty || qty <= 0) return;
      const p = PRODUCTS[pid];
      if (!p || p.deleted) return;
      const existing = buyList.find((x) => x.id === pid);
      if (existing) {
        existing.qty += qty;
        if (note && !existing.name.includes(note)) {
          existing.name = `${existing.name} + ${note}`;
        }
        return;
      }
      buyList.push({
        id: pid,
        cat,
        name: note ? `${p.name} · ${note}` : p.name,
        qty,
        unit: p.price,
        url: p.url,
        soldOut: /품절/.test(p.status)
      });
    };

    const incPipes = Number(stoveObj.includedPipes) || 0;
    const incRings = Number(stoveObj.includedRings) || 0;
    const extraRings = Math.max(0, 1 - incRings);

    if (incPipes > 0) {
      const useLabel = stoveObj.isRollPipe
        ? "3m 롤연통 기본 사용"
        : (sim.totalSeg <= incPipes
            ? `기본 ${incPipes}본 중 ${sim.totalSeg}본 사용 (추가 직관 불필요)`
            : `기본 ${incPipes}본 전체 사용 + ${sim.totalSeg - incPipes}본 추가 필요`);
      includedList.push({
        cat: stoveObj.isRollPipe ? "기본 포함 롤연통" : "기본 포함 연통",
        name: stoveObj.includedSummary,
        detail: useLabel
      });
    }
    if (incRings > 0) {
      includedList.push({
        cat: "기본 포함 고정 부품",
        name: stoveObj.isRollPipe ? "티타늄 고정 클립 3개 + 댐퍼 베이스 + 불티캡" : "연통 고정링 1개 + 불티방지캡",
        detail: "기본 포함 고정링으로 충분"
      });
    }

    const extra70Cnt = sim.extra70ForElbow || 0;
    if (isTi) {
      if (stoveObj.isRollPipe) {
        if (sim.elbowCnt > 0 || sim.totalSeg > incPipes) {
          const extraCnt = Math.max(1, sim.totalSeg - incPipes);
          addBuy("p_ti_pipe_70_76", extraCnt, "티타늄 추가 직관", sim.elbowCnt > 0 ? "엘보 연결·원통형 확장용" : `기본 3m 초과 ${extraCnt}본`);
        }
      } else if (incPipes === 0) {
        if (state.pipeSystem === "ti_nested_83_89") {
          addBuy("p_ti_set_83_89", 1, "티타늄 연통 세트");
          if (sim.totalSeg > 10) addBuy("p_ti_pipe_70_76", sim.totalSeg - 10, "티타늄 추가 직관");
        } else if (state.pipeSystem === "ti_single_70_76") {
          addBuy("p_ti_damper_base", 1, "티타늄 댐퍼 베이스");
          addBuy("p_ti_pipe_70_76", sim.straightCnt, "티타늄 직관 연통");
        } else {
          addBuy("p_ti_set_70_76", 1, "티타늄 연통 세트");
          if (extra70Cnt > 0) addBuy("p_ti_pipe_70_76", extra70Cnt, "티타늄 추가 직관", `Ø70 엘보연결 ${extra70Cnt}본`);
          const extraTopTi = Math.max(0, sim.totalSeg - 11 - extra70Cnt);
          if (extraTopTi > 0) addBuy("p_ti_pipe_70_76", extraTopTi, "티타늄 추가 직관", `상단 연장 ${extraTopTi}본`);
        }
      } else {
        if (extra70Cnt > 0) addBuy("p_ti_pipe_70_76", extra70Cnt, "티타늄 추가 직관", `Ø70 엘보연결 ${extra70Cnt}본`);
        const extraTopTi = Math.max(0, sim.totalSeg - incPipes - extra70Cnt);
        if (extraTopTi > 0) addBuy("p_ti_pipe_70_76", extraTopTi, "티타늄 추가 직관", `Ø76 상단연장 ${extraTopTi}본 (+${extraTopTi * sim.effPipe}cm)`);
      }
      if (sim.elbowCnt > 0) addBuy("p_ti_elbow_70", sim.elbowCnt, `티타늄 ${sim.elbowAng}° 엘보`);
      if (state.protectionType === "ti_guard_70" && isFixed60or70Pipe(stoveObj, state.pipeSystem)) {
        addBuy("p_ti_guard_70", 1, "스킨 보호", "고정 Ø60·70mm 전용");
      } else {
        addBuy("p_mesh_guard", 1, "스킨 보호", "Ø60~90mm 스텐·티타늄 유연 호환");
      }
      if (extraRings > 0) addBuy("p_guide_ring", extraRings, "티타늄 외부 고정링");
    } else {
      if (incPipes === 0) {
        if (state.pipeSystem === "tapered_70_73_76") {
          addBuy("p_set_33m", 1, "스텐 기본 세트", "연통 미포함 모델 필수");
          if (extra70Cnt > 0) addBuy("p_pipe_70", extra70Cnt, "스텐 70파이 추가 직관", "2번째 엘보까지 Ø70 연결 필수");
          const extraTopSt = Math.max(0, sim.totalSeg - 12 - extra70Cnt);
          if (extraTopSt > 0) addBuy("p_pipe_76", extraTopSt, "스텐 76파이 연장 직관");
        } else if (state.pipeSystem === "single_70") {
          addBuy("p_damper_70", 1, "스텐 하단 댐퍼");
          addBuy("p_pipe_70", sim.straightCnt, "스텐 직관 연통");
        } else {
          addBuy("p_reducer_70_75", 1, "스텐 구경 레듀셔");
          addBuy("p_pipe_75", sim.straightCnt, "스텐 직관 연통");
          addBuy("p_spark_cap_75", 1, "스텐 최상단 불티캡");
        }
      } else {
        if (extra70Cnt > 0 && state.pipeSystem === "tapered_70_73_76") {
          addBuy("p_pipe_70", extra70Cnt, "스텐 70파이 추가 직관", "2번째 엘보까지 Ø70 연결 필수");
        }
        const extraTopSt = Math.max(0, sim.totalSeg - incPipes - extra70Cnt);
        if (extraTopSt > 0) {
          if (state.pipeSystem === "tapered_70_73_76") {
            addBuy("p_pipe_76", extraTopSt, "스텐 76파이 연장 직관", "상단 연장 · 3중 겹침 수납 호환");
          } else if (state.pipeSystem === "single_75") {
            addBuy("p_reducer_70_75", 1, "스텐 구경 레듀셔");
            addBuy("p_pipe_75", extraTopSt, "스텐 추가 연장 직관");
          } else {
            addBuy("p_pipe_70", extraTopSt, "스텐 추가 연장 직관");
          }
        }
      }
      if (sim.elbowCnt > 0) addBuy(state.pipeSystem === "single_75" ? "p_elbow_75" : "p_elbow_70", sim.elbowCnt, `스텐 ${sim.elbowAng}° 엘보`);
      if (state.protectionType === "double_pipe" || state.protectionType === "both_guard") addBuy(state.pipeSystem === "single_75" ? "p_double_75" : "p_double_70", 1, "스킨 보호");
      if (state.protectionType === "mesh_guard" || state.protectionType === "both_guard") addBuy("p_mesh_guard", 1, "스킨 보호", "Ø60~90mm 유연 호환");
      if (state.protectionType === "ti_guard_70" && isFixed60or70Pipe(stoveObj, state.pipeSystem)) addBuy("p_ti_guard_70", 1, "스킨 보호", "고정 Ø60·70mm 전용");
      if (extraRings > 0) addBuy("p_guide_ring", extraRings, "외부 고정링");
    }

    if (sim.H_stand >= 50) {
      const isDweller = stoveObj.id === "dweller_max3" || stoveObj.id === "dweller_ti3";
      addBuy(isDweller ? "p_dweller_stand" : "p_stand_550", 1, "난로 옵션 스탠드");
    }

    Object.keys(state.extraBuyItems || {}).forEach((pid) => {
      const qtyNum = Number(state.extraBuyItems[pid]) || 0;
      if (qtyNum <= 0) return;
      const p = PRODUCTS[pid];
      if (!p || p.deleted) return;
      const existing = buyList.find((x) => x.id === pid);
      if (existing) {
        if (typeof state.qtyOverrides[pid] !== "number") existing.qty += qtyNum;
      } else {
        buyList.push({
          id: pid,
          cat: "직접 추가",
          name: p.name,
          qty: qtyNum,
          unit: p.price,
          url: p.url,
          soldOut: /품절/.test(p.status),
          isManual: true
        });
      }
    });

    buyList.forEach((it) => {
      if (typeof state.qtyOverrides[it.id] === "number" && state.qtyOverrides[it.id] >= 1) {
        it.qty = state.qtyOverrides[it.id];
      }
    });

    return { includedList, buyList, incPipes, extraPipeNeeded: Math.max(0, sim.totalSeg - incPipes) };
  }

  function updateUI() {
    try {
      const sim = computeSimulation();
      const t = getActiveTent();
      const stoveObj = getActiveStove();
      populateExtraAddSelect();

      setText("selectedTentBadge", `${t.origin} · ${t.l}×${t.w}×${sim.H_tent}cm`);
      setHtml("tentSpecSummary", `<strong>${escapeHtml(t.brand)} ${escapeHtml(t.name)}</strong> · 폭 ${t.w}cm × 길이 ${t.l}cm × 높이 ${sim.H_tent}cm`);
      setHtml("stoveSpecSummary", `<strong>${escapeHtml(stoveObj.name)}</strong><div class="text-[11px] text-slate-500 mt-0.5">${escapeHtml(stoveObj.compatDia)}</div>`);
      setText("totalStartHeightBadge", `출발 ${sim.H_start}cm`);
      setText("proOverlapBadge", sim.isTi3mSet ? "마디당 -3cm (30mm)" : `마디당 -${sim.overlap}cm (${sim.overlap * 10}mm)`);
      const aiBadge = byId("proAiEstBadge");
      if (aiBadge) aiBadge.classList.toggle("hidden", !state.isAiEstimated);

      document.querySelectorAll(".tent-shape-btn").forEach((b) => {
        const active = b.getAttribute("data-shape") === state.tentShape;
        b.className = active
          ? "tent-shape-btn py-1.5 px-2 rounded-lg text-xs font-bold bg-orange-600 text-white border border-orange-600 transition"
          : "tent-shape-btn py-1.5 px-2 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 transition";
      });
      document.querySelectorAll(".stand-preset-btn").forEach((b) => {
        const active = Number(b.getAttribute("data-stand")) === Number(state.standHeight);
        b.className = active
          ? "stand-preset-btn py-1.5 rounded-lg text-[11px] font-bold bg-slate-900 text-white transition"
          : "stand-preset-btn py-1.5 rounded-lg text-[11px] font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition";
      });
      document.querySelectorAll(".path-type-btn").forEach((b) => {
        const active = b.getAttribute("data-path") === state.pathType;
        b.className = active
          ? "path-type-btn py-2.5 px-2 rounded-xl border-2 border-orange-500 bg-orange-50 text-center transition"
          : "path-type-btn py-2.5 px-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-center transition";
      });

      setText("kpiStartHeight", `${sim.H_start} cm`);
      setText("kpiStartSub", `난로 ${sim.H_stove} + 스탠드 ${sim.H_stand}`);
      setText("kpiTopHeight", sim.blocked ? "보정 필요" : `${sim.topH} cm`);
      setText("kpiTopSub", `천장~연통끝 ${sim.roofClr >= 0 ? "+" : ""}${sim.roofClr}cm`);
      setText("kpiPipeCount", sim.blocked ? "설치 불가" : `총 ${sim.totalSeg}본${sim.elbowCnt ? `+엘보${sim.elbowCnt}` : ""}`);
      setText("kpiPipeSub", `유효 ${sim.effTotal}cm (${sim.joints}마디 -${sim.lost}cm)`);

      const kpiDiff = byId("kpiDifficulty");
      if (kpiDiff) {
        kpiDiff.textContent = sim.diff;
        kpiDiff.className = `text-base sm:text-lg font-extrabold mt-0.5 ${sim.diffColor}`;
      }
      const kpiSpark = byId("kpiSparkSub");
      if (kpiSpark) {
        kpiSpark.textContent = sim.sparkSafe ? `불티안전 +${sim.roofClr}cm 충족` : `불티주의 +${sim.roofClr}cm (+60cm↑ 권장)`;
        kpiSpark.className = `text-[10px] font-bold mt-0.5 ${sim.sparkSafe ? "text-emerald-700" : "text-rose-700"}`;
      }

      setText("diagramTitleBadge", sim.isTi3mSet
        ? `${t.brand} ${t.name} · 티타늄 3.0m (${sim.totalSeg}본)`
        : sim.isMstove33mSet
          ? `${t.brand} ${t.name} · 스텐 3.3m (${sim.totalSeg}본)`
          : `${t.brand} ${t.name}`);

      const signP = sim.actualExtraPipes > 0 ? "+" : "";
      const signC = sim.extraOutCm > 0 ? "+" : "";
      setText("proExtraReadout", `${signP}${sim.actualExtraPipes}본 (${signC}${sim.extraOutCm}cm)`);
      const extraReset = byId("proExtraReset");
      if (extraReset) extraReset.classList.toggle("hidden", sim.actualExtraPipes === 0);

      const alertEl = byId("safetyAlertBox");
      if (alertEl) {
        if (sim.warns.length) {
          alertEl.classList.remove("hidden");
          const fixes = sim.blocked
            ? `<div class="flex flex-wrap gap-1.5 pt-1">
                 ${sim.H_stand > 0 ? `<button type="button" data-qfix="no_stand" class="pro-qfix px-2.5 py-1 rounded-lg bg-rose-700 text-white text-[11px] font-bold">🔧 스탠드 제거 (0cm)</button>` : ""}
                 <button type="button" data-qfix="fix_jack" class="pro-qfix px-2.5 py-1 rounded-lg bg-white text-rose-800 border border-rose-300 text-[11px] font-bold">🔧 홀잭 높이 보정</button>
                 ${state.pathType !== "elbow90" ? `<button type="button" data-qfix="switch_90" class="pro-qfix px-2.5 py-1 rounded-lg bg-white text-rose-800 border border-rose-300 text-[11px] font-bold">🔧 측면 90° 전환</button>` : ""}
               </div>`
            : (!sim.sparkSafe ? `<div class="pt-1"><button type="button" data-qfix="add_spark_pipe" class="pro-qfix px-2.5 py-1 rounded-lg bg-emerald-700 text-white text-[11px] font-bold">🔧 외부 연통 +1본 추가 (+${sim.effPipe}cm)</button></div>` : "");
          alertEl.innerHTML = sim.warns.map((w) => `<div>⚠️ ${escapeHtml(w)}</div>`).join("") + fixes;
        } else {
          alertEl.classList.add("hidden");
        }
      }

      renderSvgDiagram(sim);

      const { includedList, buyList, incPipes, extraPipeNeeded } = buildBomItems(sim);
      setHtml("proStoveCompatBox", `
        <div><strong class="text-slate-900">🔧 ${escapeHtml(stoveObj.name)}</strong> · <span class="font-bold ${stoveObj.mat === "titanium" ? "text-indigo-700" : "text-orange-700"}">${escapeHtml(stoveObj.compatDia)}</span></div>
        <div class="text-[11px] text-slate-600">🧩 ${escapeHtml(stoveObj.optionsNote)}</div>
      `);

      setText("proIncludedPill", incPipes === 0 ? "연통 미포함 모델" : (extraPipeNeeded === 0 ? `기본 ${incPipes}본 충족 ✓` : `기본 ${incPipes}본 + ${extraPipeNeeded}본 추가`));
      setHtml("proIncludedCards", includedList.length
        ? includedList.map((inc) => `
            <div class="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 space-y-1">
              <div class="flex items-center justify-between"><span class="px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-extrabold">✓ ${escapeHtml(inc.cat)}</span><span class="text-[11px] font-bold text-emerald-700">0원</span></div>
              <div class="text-xs font-bold text-slate-900">${escapeHtml(inc.name)}</div>
              <div class="text-[11px] font-semibold text-emerald-800">${escapeHtml(inc.detail)}</div>
            </div>
          `).join("")
        : `<div class="sm:col-span-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-xs font-semibold text-amber-900">ℹ️ 기본 포함 연통이 없는 모델입니다. 아래 추가 구매 목록에서 연통 세트를 선택하세요.</div>`);

      const hasOverrides = Object.keys(state.extraBuyItems).length > 0 || Object.keys(state.qtyOverrides).length > 0 || Object.keys(state.excluded).length > 0 || Object.keys(state.includedSoldOut).length > 0;
      const resetBtn = byId("proResetExtraBtn");
      if (resetBtn) resetBtn.classList.toggle("hidden", !hasOverrides);

      let sum = 0, qtySum = 0, visitedCnt = 0;
      const cardsHtml = buyList.map((it) => {
        const inc = it.soldOut ? Boolean(state.includedSoldOut[it.id]) : !state.excluded[it.id];
        const isVisited = Boolean(state.visitedLinks[it.id]);
        if (isVisited) visitedCnt++;
        const sub = it.qty * it.unit;
        if (inc) { sum += sub; qtySum += it.qty; }
        return `
          <div class="rounded-xl border ${isVisited ? "border-emerald-300 bg-emerald-50/35" : (it.isManual ? "border-orange-300 bg-orange-50/30" : (it.soldOut ? "border-rose-200 bg-rose-50/30" : "border-slate-200 bg-slate-50/50"))} p-3 flex flex-col justify-between gap-2 ${inc ? "" : "opacity-60"}">
            <div class="flex items-start gap-2">
              <input type="checkbox" data-bom-id="${escapeHtml(it.id)}" data-soldout="${it.soldOut ? "1" : "0"}" ${inc ? "checked" : ""} class="pro-bom-chk mt-1 w-4 h-4 accent-orange-600 cursor-pointer shrink-0"/>
              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between gap-1">
                  <div class="flex items-center gap-1 flex-wrap">
                    <span class="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[10px] font-bold text-slate-600">${escapeHtml(it.cat)}</span>
                    ${it.soldOut ? `<span class="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-extrabold">품절</span>` : ""}
                    ${isVisited ? `<button type="button" data-bom-unvisit="${escapeHtml(it.id)}" class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-extrabold">✓ 확인함</button>` : ""}
                  </div>
                  ${it.isManual ? `<button type="button" data-bom-del="${escapeHtml(it.id)}" class="text-[11px] font-bold text-slate-400 hover:text-rose-600">✕</button>` : ""}
                </div>
                <div class="text-xs font-bold text-slate-900 mt-1 leading-snug ${inc ? "" : "line-through"}">${escapeHtml(it.name)}</div>
              </div>
            </div>
            <div class="flex items-center justify-between gap-2 pt-2 border-t border-slate-200/70">
              <div class="flex items-center gap-1.5">
                <div class="inline-flex items-center bg-white border border-slate-200 rounded-lg p-0.5">
                  <button type="button" data-bom-dec="${escapeHtml(it.id)}" class="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 font-extrabold text-xs">−</button>
                  <span class="min-w-[32px] text-center text-xs font-extrabold">${it.qty}개</span>
                  <button type="button" data-bom-inc="${escapeHtml(it.id)}" class="w-6 h-6 rounded bg-orange-500 hover:bg-orange-600 text-white font-extrabold text-xs">+</button>
                </div>
                <span class="text-xs font-extrabold text-orange-700">${formatKRW(sub)}</span>
              </div>
              <a href="${sanitizeUrl(it.url)}" data-bom-visit="${escapeHtml(it.id)}" target="_blank" rel="noopener noreferrer" class="px-2.5 py-1 rounded-lg ${isVisited ? "bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-600" : "bg-white hover:bg-slate-900 hover:text-white text-slate-800 border border-slate-300"} text-[11px] font-bold whitespace-nowrap transition">${isVisited ? "✓ 확인함 ↗" : "바로가기 ↗"}</a>
            </div>
          </div>
        `;
      });

      setText("proVisitedProgress", buyList.length > 0 ? `총 ${buyList.length}개 중 ${visitedCnt}개 확인 완료` : "추가 구매 없음");
      setHtml("proBomCards", cardsHtml.length
        ? cardsHtml.join("")
        : `<div class="sm:col-span-2 rounded-xl border border-emerald-200 bg-emerald-50/40 px-3 py-2.5 text-xs font-bold text-emerald-800">✓ 난로 기본 포함 연통·부속품만으로 설치가 가능합니다.</div>`);

      setText("bomTotalQty", sim.blocked ? "보정 필요" : `추가 구매 ${qtySum}개 선택`);
      setText("bomTotalPrice", sim.blocked ? "설치 조건 확인" : formatKRW(sum));
      const stProd = PRODUCTS[stoveObj.pid];
      setText("bomStoveCombinedNote", stProd ? `난로(${stProd.name} ${formatKRW(stProd.price)}) 포함 시 ${formatKRW(sum + stProd.price)}` : "");

      state.lastBomText = [
        `[캠핑투게더 연통 시뮬레이터 연통 목록]`,
        `- 텐트: ${t.brand} ${t.name} (천장 ${sim.H_tent}cm / 홀잭 ${sim.H_jack}cm)`,
        `- 난로: ${stoveObj.name} (난로 ${sim.H_stove}cm + 스탠드 ${sim.H_stand}cm = 출발 ${sim.H_start}cm)`,
        `- 연통 총 높이: ${sim.topH}cm (천장~연통끝 ${sim.roofClr >= 0 ? "+" : ""}${sim.roofClr}cm · 총 ${sim.totalSeg}본 · 난이도 ${sim.diff})`,
        `- [기본 포함 연통·부속]: ${includedList.length ? includedList.map((x) => `${x.name} (${x.detail})`).join(" / ") : "없음"}`,
        `- [추가 구매 필요 품목]:`,
        ...buyList
          .filter((it) => (it.soldOut ? Boolean(state.includedSoldOut[it.id]) : !state.excluded[it.id]))
          .map((it) => `  · ${it.cat}: ${it.name} × ${it.qty}개 (${formatKRW(it.qty * it.unit)}) → ${it.url}`),
        `- 추가 구매 합계: ${formatKRW(sum)}`
      ].join("\n");
    } catch (err) {
      console.error("[Pro updateUI Error]", err);
    }
  }

  /* =========================================================
   * 9. DB 탭 렌더링 및 탭 전환
   * ========================================================= */
  function renderProductsTab() {
    const grid = byId("productCardsGrid");
    if (!grid) return;
    const list = Object.values(PRODUCTS).filter((p) => {
      if (p.deleted && !state.adminUnlocked) return false;
      return state.productCategoryFilter === "all" || p.mat === state.productCategoryFilter;
    });
    grid.innerHTML = list.map((p) => `
      <div class="rounded-2xl bg-white border ${p.deleted ? "border-rose-300 opacity-60" : "border-slate-200"} p-4 flex flex-col justify-between gap-3 shadow-sm">
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-2">
            <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold ${p.mat === "titanium" ? "bg-indigo-50 text-indigo-700" : p.mat === "stainless" ? "bg-slate-100 text-slate-700" : "bg-emerald-50 text-emerald-700"}">${p.mat === "titanium" ? "🪶 티타늄" : p.mat === "stainless" ? "🔩 스테인리스" : "공용"}</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${p.deleted ? "bg-rose-100 text-rose-800" : (/품절/.test(p.status) ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700")}">${escapeHtml(p.deleted ? "삭제됨" : p.status)}</span>
          </div>
          <h3 class="text-xs sm:text-sm font-extrabold text-slate-900 leading-snug ${p.deleted ? "line-through" : ""}">${escapeHtml(p.name)}</h3>
          ${state.adminUnlocked ? `
            <div class="pt-2 border-t border-dashed border-slate-200 space-y-1.5 text-[11px]">
              <input type="text" data-adm-name="${escapeHtml(p.id)}" value="${escapeHtml(p.name)}" class="w-full rounded-lg bg-slate-50 border border-slate-300 px-2 py-1 text-[11px] font-bold" />
              <div class="flex items-center gap-1.5">
                <select data-adm-status="${escapeHtml(p.id)}" class="rounded-lg bg-white border border-slate-300 px-1.5 py-1 font-bold">
                  <option value="판매중" ${p.status === "판매중" && !p.deleted ? "selected" : ""}>판매중</option>
                  <option value="품절" ${/품절/.test(p.status) && !p.deleted ? "selected" : ""}>품절</option>
                  <option value="삭제됨" ${p.deleted ? "selected" : ""}>삭제(숨김)</option>
                </select>
                <input type="number" data-adm-price="${escapeHtml(p.id)}" value="${p.price}" class="flex-1 min-w-0 rounded-lg bg-white border border-slate-300 px-2 py-1 text-right font-bold" />
              </div>
              <input type="url" data-adm-url="${escapeHtml(p.id)}" value="${escapeHtml(p.url)}" class="w-full rounded-lg bg-white border border-slate-300 px-2 py-1 text-[10px] font-mono text-slate-600" />
            </div>
          ` : ""}
        </div>
        <div class="pt-2.5 border-t border-slate-100 flex items-center justify-between">
          <span class="text-sm font-extrabold text-orange-700">${formatKRW(p.price)}</span>
          <a href="${sanitizeUrl(p.url)}" target="_blank" rel="noopener noreferrer" class="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition">상품보기 ↗</a>
        </div>
      </div>
    `).join("");
  }

  function renderTentsTab() {
    updateTentCountLabels();
    const tbody = byId("tentDbTableBody");
    if (!tbody) return;
    const kw = (state.tentDbSearch || "").trim().toLowerCase();
    const list = TENT_MODELS.filter((t) => {
      const okO = state.tentDbFilter === "all" || t.origin === state.tentDbFilter;
      const okK = !kw || `${t.brand} ${t.name}`.toLowerCase().includes(kw);
      return okO && okK;
    });

    if (list.length === 0) {
      const colSpan = state.adminUnlocked ? 8 : 7;
      tbody.innerHTML = `<tr><td colspan="${colSpan}" class="py-8 px-4 text-center text-xs text-slate-400 font-semibold">조건에 맞는 텐트 모델이 없습니다.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((t) => `
      <tr class="hover:bg-slate-50 transition">
        <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${t.origin === "국내" ? "bg-sky-100 text-sky-800" : "bg-purple-100 text-purple-800"}">${escapeHtml(t.origin)}</span></td>
        <td class="py-2.5 px-3 font-bold text-slate-900">
          ${escapeHtml(t.brand)} ${escapeHtml(t.name)}
          ${t.isAdminAdded ? `<span class="ml-1 px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 text-[10px] font-extrabold">${t.isRemoteSynced ? "서버 등록" : "추가됨"}</span>` : ""}
        </td>
        <td class="py-2.5 px-3 text-slate-600 whitespace-nowrap">${t.l}×${t.w}×${t.peakHeight} cm</td>
        <td class="py-2.5 px-3 text-center font-extrabold text-orange-700">
          ${state.adminUnlocked
            ? `<input type="number" min="130" max="350" data-adm-tent-h="${escapeHtml(t.id)}" value="${t.peakHeight}" class="w-16 rounded-md bg-white border border-slate-300 px-1.5 py-0.5 text-center text-xs font-extrabold text-orange-700" />`
            : `${t.peakHeight} cm`}
        </td>
        <td class="py-2.5 px-3 text-center font-bold text-amber-700">
          ${state.adminUnlocked
            ? `<input type="number" min="80" max="320" data-adm-tent-jh="${escapeHtml(t.id)}" value="${t.defaultJackHeight}" class="w-16 rounded-md bg-amber-50 border border-amber-300 px-1.5 py-0.5 text-center text-xs font-bold text-amber-800" />`
            : `${t.defaultJackHeight} cm`}
        </td>
        <td class="py-2.5 px-3 whitespace-nowrap font-bold ${t.defaultPath === "straight" ? "text-emerald-700" : t.defaultPath === "elbow45" ? "text-amber-700" : "text-rose-700"}">
          ${state.adminUnlocked
            ? `<select data-adm-tent-path="${escapeHtml(t.id)}" class="rounded-md bg-white border border-slate-300 px-1.5 py-0.5 text-xs font-bold text-slate-800">
                <option value="straight" ${t.defaultPath === "straight" ? "selected" : ""}>천장 직상</option>
                <option value="elbow45" ${t.defaultPath === "elbow45" ? "selected" : ""}>45° 경사</option>
                <option value="elbow90" ${t.defaultPath === "elbow90" ? "selected" : ""}>측면 90°</option>
              </select>`
            : (t.defaultPath === "straight" ? "천장 직상" : t.defaultPath === "elbow45" ? "45° 경사" : "측면 90°")}
        </td>
        <td class="py-2.5 px-3 text-center"><button type="button" data-apply-tent="${escapeHtml(t.id)}" class="apply-tent-db-btn px-2.5 py-1 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold transition">적용</button></td>
        ${state.adminUnlocked
          ? `<td class="py-2.5 px-3 text-center"><button type="button" data-adm-tent-del="${escapeHtml(t.id)}" class="px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[11px] font-bold transition">삭제</button></td>`
          : ""}
      </tr>
    `).join("");
  }

  function switchTab(tabId) {
    state.activeTab = tabId;
    ["simulator", "products", "tents"].forEach((id) => {
      const panel = byId(`tabPanel-${id}`);
      const btn = byId(`tabBtn-${id}`);
      if (panel) {
        if (id === tabId) panel.classList.remove("hidden");
        else panel.classList.add("hidden");
      }
      if (btn) {
        btn.className = id === tabId
          ? "nav-tab-btn px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold whitespace-nowrap bg-orange-600 text-white shadow-sm transition"
          : "nav-tab-btn px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap bg-white text-slate-700 hover:bg-slate-100 border border-slate-300 transition";
      }
    });
  }

  let rafId = 0;
  function scheduleUpdateUI() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      updateUI();
    });
  }

  /* =========================================================
   * 10. 이벤트 바인딩
   * ========================================================= */
  function bindEvents() {
    // 1) 탭 전환
    document.querySelectorAll(".nav-tab-btn").forEach((b) => {
      b.addEventListener("click", () => switchTab(b.getAttribute("data-tab")));
    });

    // 2) 간편 버전 이동
    onEl("goSimpleVersionBtn", "click", () => {
      const q = buildShareQueryString();
      const protocol = window.location ? window.location.protocol : "";
      if (protocol !== "http:" && protocol !== "https:" && protocol !== "file:") {
        try { window.open(`https://stove-iota.vercel.app/?${q}`, "_blank", "noopener,noreferrer"); } catch (err) {}
        showToast("미리보기 환경에서는 간편 버전을 새 창으로 엽니다.");
        return;
      }
      const pathname = window.location.pathname || "";
      const target = pathname.includes("camping_together_chimney_simulator")
        ? "./camping_together_simple_simulator.html"
        : "./index.html";
      try { window.location.href = new URL(`${target}?${q}`, window.location.href).href; } catch (err) {}
    });

    // 3) 프리셋 & 입력 컨트롤
    document.querySelectorAll(".scenario-preset-btn").forEach((b) => {
      b.addEventListener("click", () => {
        const p = b.getAttribute("data-preset");
        state.tentOriginFilter = "all";
        syncOriginFilterButtons();
        populateTentDropdown();
        state.standHeight = 0;
        if (p === "valhall_mstove") { applyStoveModel("mstove_v3"); applyTentModel("helsport_valhall"); }
        else if (p === "shelterg_mstove") { applyStoveModel("mstove_v3"); applyTentModel("minimalworks_shelter_g"); }
        else if (p === "orison_lumora") { applyStoveModel("lumora_ti"); applyTentModel("backcountry_orison"); }
        else if (p === "a7ex_mstove") { applyStoveModel("mstove_v3"); applyTentModel("northpeak_a7_ex"); }
        else if (p === "cocoon3_dweller_ti3") { applyStoveModel("dweller_ti3"); applyTentModel("coleman_cocoon3"); }
      });
    });

    document.querySelectorAll(".tent-origin-btn").forEach((b) => {
      b.addEventListener("click", () => {
        const orig = b.getAttribute("data-origin");
        state.tentOriginFilter = orig;
        syncOriginFilterButtons();
        populateTentDropdown();
        if (orig === "custom") {
          applyTentModel("custom_tent");
        } else {
          const fm = TENT_MODELS.find((t) => orig === "all" || t.origin === orig);
          if (fm) applyTentModel(fm.id);
        }
      });
    });

    onEl("tentSelect", "change", (e) => applyTentModel(e.target.value));
    onEl("stoveSelect", "change", (e) => applyStoveModel(e.target.value));
    onEl("proAiEstDismissBtn", "click", () => { state.isAiEstimated = false; updateUI(); });

    document.querySelectorAll(".tent-shape-btn").forEach((b) => {
      b.addEventListener("click", () => {
        state.tentShape = b.getAttribute("data-shape");
        updateUI();
      });
    });

    document.querySelectorAll(".stand-preset-btn").forEach((b) => {
      b.addEventListener("click", () => {
        state.standHeight = Number(b.getAttribute("data-stand")) || 0;
        syncInputsFromState();
        updateUI();
      });
    });

    document.querySelectorAll(".path-type-btn").forEach((b) => {
      b.addEventListener("click", () => {
        state.pathType = b.getAttribute("data-path");
        resetStoveAndJackPositions();
        updateUI();
      });
    });

    onEl("pipeSystemSelect", "change", (e) => {
      state.pipeSystem = e.target.value;
      syncMaterialSelectors();
      updateUI();
    });

    onEl("protectionSelect", "change", (e) => {
      state.protectionType = e.target.value;
      updateUI();
    });

    const linkPair = (numId, slId, key) => {
      const nEl = byId(numId), sEl = byId(slId);
      if (!nEl || !sEl) return;
      const min = Number(nEl.min), max = Number(nEl.max);
      nEl.addEventListener("input", () => {
        const v = Number(nEl.value);
        if (!Number.isFinite(v) || v < min || v > max) return;
        state[key] = v;
        sEl.value = v;
        if (key === "jackHeight") state.jackPosCm = clampJackForAngle(state.jackPosCm, state.jackHeight).jackPosCm;
        scheduleUpdateUI();
      });
      nEl.addEventListener("blur", () => {
        const v = Number(nEl.value);
        const c = Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : min;
        state[key] = c;
        nEl.value = c;
        sEl.value = c;
        if (key === "jackHeight") state.jackPosCm = clampJackForAngle(state.jackPosCm, state.jackHeight).jackPosCm;
        updateUI();
      });
      sEl.addEventListener("input", () => {
        state[key] = Number(sEl.value) || 0;
        nEl.value = state[key];
        if (key === "jackHeight") state.jackPosCm = clampJackForAngle(state.jackPosCm, state.jackHeight).jackPosCm;
        scheduleUpdateUI();
      });
    };
    linkPair("tentHeightInput", "tentHeightSlider", "tentHeight");
    linkPair("jackHeightInput", "jackHeightSlider", "jackHeight");
    linkPair("stoveHeightInput", "stoveHeightSlider", "stoveHeight");
    linkPair("standHeightInput", "standHeightSlider", "standHeight");

    // 4) 도면 토글 및 외부 연통 조절
    const vf = byId("viewFrontBtn"), vs = byId("viewSideBtn");
    const updateViewCls = () => {
      if (vf) vf.className = state.sectionViewMode === "front" ? "px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-900 text-white transition" : "px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition";
      if (vs) vs.className = state.sectionViewMode === "side" ? "px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-900 text-white transition" : "px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition";
    };
    onEl("viewFrontBtn", "click", () => { state.sectionViewMode = "front"; resetStoveAndJackPositions(); updateViewCls(); updateUI(); });
    onEl("viewSideBtn", "click", () => { state.sectionViewMode = "side"; resetStoveAndJackPositions(); updateViewCls(); updateUI(); });

    onEl("toggleDimBtn", "click", (e) => {
      state.showDimensions = !state.showDimensions;
      e.currentTarget.textContent = `📏 치수 ${state.showDimensions ? "ON" : "OFF"}`;
      e.currentTarget.className = state.showDimensions ? "px-2.5 py-1 rounded-lg text-xs font-bold bg-sky-600 text-white transition" : "px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-500 transition";
      updateUI();
    });

    onEl("toggleNodeBtn", "click", (e) => {
      state.showPipeNodes = !state.showPipeNodes;
      e.currentTarget.textContent = `🔩 마디 ${state.showPipeNodes ? "ON" : "OFF"}`;
      e.currentTarget.className = state.showPipeNodes ? "px-2.5 py-1 rounded-lg text-xs font-bold bg-orange-600 text-white transition" : "px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-500 transition";
      updateUI();
    });

    onEl("proExtraMinus", "click", () => { state.extraOutPipes = Math.max(-4, state.extraOutPipes - 1); updateUI(); });
    onEl("proExtraPlus", "click", () => { state.extraOutPipes = Math.min(6, state.extraOutPipes + 1); updateUI(); });
    onEl("proExtraReset", "click", () => { state.extraOutPipes = 0; updateUI(); });

    document.querySelectorAll(".stove-move-btn").forEach((b) => {
      b.addEventListener("click", () => {
        const a = b.getAttribute("data-move-stove");
        if (a === "left") state.stovePosCm = clampStovePos(-Math.round(getCurrentSpanCm() * 0.28));
        else if (a === "center") state.stovePosCm = 0;
        else if (a === "under_jack") state.stovePosCm = clampStovePos(state.jackPosCm);
        else resetStoveAndJackPositions();
        updateUI();
      });
    });

    // 5) SVG 드래그 (난로 좌우 / 홀잭 자유 이동)
    const svg = byId("simSvg");
    if (svg) {
      svg.addEventListener("pointerdown", (e) => {
        const el = e.target && typeof e.target.closest === "function" ? e.target : null;
        if (!el) return;
        const isJack = Boolean(el.closest("#draggableJackGroup"));
        const isStove = Boolean(el.closest("#draggableStoveGroup"));
        if (!isJack && !isStove) return;
        state.dragging = true;
        state.dragTarget = isJack ? "jack" : "stove";
        state.dragGeom = state.geom ? Object.assign({}, state.geom) : { cx: 395, scaleX: 1, gY: 412, scaleY: 1, span: 300 };
        const curSim = computeSimulation();
        state.lockedMaxH = Math.max(curSim.H_tent + 160, curSim.topH + 35, 405);
        try { svg.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
      });

      svg.addEventListener("pointermove", (e) => {
        if (!state.dragging || !state.dragGeom) return;
        const r = svg.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const xSvg = ((e.clientX - r.left) / r.width) * 860;
        const ySvg = ((e.clientY - r.top) / r.height) * 470;
        if (state.dragTarget === "jack") {
          const rawX = (xSvg - state.dragGeom.cx) / state.dragGeom.scaleX;
          const rawH = (state.dragGeom.gY - ySvg) / state.dragGeom.scaleY;
          const cl = clampJackForAngle(rawX, rawH);
          state.jackPosCm = cl.jackPosCm;
          state.jackHeight = cl.jackH;
          setVal("jackHeightInput", state.jackHeight);
          setVal("jackHeightSlider", state.jackHeight);
        } else {
          state.stovePosCm = clampStovePos((xSvg - state.dragGeom.cx) / state.dragGeom.scaleX);
          if (state.pathType === "elbow45" || state.pathType === "elbow90") {
            state.jackPosCm = clampJackForAngle(state.jackPosCm, state.jackHeight).jackPosCm;
          }
        }
        scheduleUpdateUI();
      });

      const stopDrag = (e) => {
        if (!state.dragging) return;
        state.dragging = false;
        state.dragTarget = null;
        state.dragGeom = null;
        state.lockedMaxH = null;
        try { svg.releasePointerCapture(e.pointerId); } catch (err) {}
        updateUI();
      };
      svg.addEventListener("pointerup", stopDrag);
      svg.addEventListener("pointercancel", stopDrag);
    }

    // 6) 경고창 자동 보정 및 BOM 인터랙션
    onEl("safetyAlertBox", "click", (e) => {
      const b = e.target && e.target.closest ? e.target.closest(".pro-qfix") : null;
      if (!b) return;
      const act = b.getAttribute("data-qfix");
      if (act === "no_stand") state.standHeight = 0;
      else if (act === "add_spark_pipe") state.extraOutPipes = Math.min(6, state.extraOutPipes + 1);
      else if (act === "switch_90") { state.pathType = "elbow90"; resetStoveAndJackPositions(); }
      else state.jackHeight = Math.min(state.tentHeight - 10, state.stoveHeight + state.standHeight + 60);
      syncInputsFromState();
      updateUI();
    });

    onEl("copyBomBtn", "click", () => {
      if (!state.lastBomText) return;
      copyTextToClipboard(state.lastBomText, "연통 구매 목록이 클립보드에 복사되었습니다.");
    });

    onEl("copyProShareUrlBtn", "click", () => {
      const q = buildShareQueryString();
      const base = (window.location && /^https?:\/\//i.test(window.location.href))
        ? `${window.location.origin}${window.location.pathname}`
        : "https://stove-iota.vercel.app/pro.html";
      copyTextToClipboard(`${base}?${q}`, "현재 시뮬레이터 세팅 링크가 복사되었습니다.");
    });

    onEl("proAddExtraBtn", "click", () => {
      const sel = byId("proAddExtraSelect");
      const pid = sel ? sel.value : "";
      if (!pid || !PRODUCTS[pid]) return;
      const sim = computeSimulation();
      const { buyList } = buildBomItems(sim);
      const existing = buyList.find((x) => x.id === pid);
      if (existing) {
        state.qtyOverrides[pid] = existing.qty + 1;
      } else {
        state.extraBuyItems[pid] = (Number(state.extraBuyItems[pid]) || 0) + 1;
      }
      delete state.excluded[pid];
      if (/품절/.test(PRODUCTS[pid].status)) state.includedSoldOut[pid] = true;
      updateUI();
      showToast(`"${PRODUCTS[pid].name}" 품목을 추가 구매 목록에 담았습니다.`);
    });

    onEl("proResetExtraBtn", "click", () => {
      state.extraBuyItems = {};
      state.qtyOverrides = {};
      state.excluded = {};
      state.includedSoldOut = {};
      updateUI();
      showToast("추가 구매 목록을 기본 추천값으로 초기화했습니다.");
    });

    onEl("proBomCards", "change", (e) => {
      const chk = e.target && e.target.closest ? e.target.closest(".pro-bom-chk") : null;
      if (!chk) return;
      const pid = chk.getAttribute("data-bom-id");
      const isSoldOut = chk.getAttribute("data-soldout") === "1";
      if (!pid) return;
      if (isSoldOut) {
        if (chk.checked) state.includedSoldOut[pid] = true;
        else delete state.includedSoldOut[pid];
      } else {
        if (chk.checked) delete state.excluded[pid];
        else state.excluded[pid] = true;
      }
      updateUI();
    });

    onEl("proBomCards", "click", (e) => {
      const target = e.target && e.target.closest ? e.target : null;
      if (!target) return;

      const incBtn = target.closest("[data-bom-inc]");
      if (incBtn) {
        const pid = incBtn.getAttribute("data-bom-inc");
        const { buyList } = buildBomItems(computeSimulation());
        const item = buyList.find((x) => x.id === pid);
        state.qtyOverrides[pid] = (item ? item.qty : 1) + 1;
        updateUI();
        return;
      }

      const decBtn = target.closest("[data-bom-dec]");
      if (decBtn) {
        const pid = decBtn.getAttribute("data-bom-dec");
        const { buyList } = buildBomItems(computeSimulation());
        const item = buyList.find((x) => x.id === pid);
        state.qtyOverrides[pid] = Math.max(1, (item ? item.qty : 1) - 1);
        updateUI();
        return;
      }

      const delBtn = target.closest("[data-bom-del]");
      if (delBtn) {
        const pid = delBtn.getAttribute("data-bom-del");
        delete state.extraBuyItems[pid];
        delete state.qtyOverrides[pid];
        updateUI();
        return;
      }

      const visitLink = target.closest("[data-bom-visit]");
      if (visitLink) {
        const pid = visitLink.getAttribute("data-bom-visit");
        if (pid) {
          state.visitedLinks[pid] = true;
          try { sessionStorage.setItem("ct_pro_visited_links", JSON.stringify(state.visitedLinks)); } catch (err) {}
          updateUI();
        }
        return;
      }

      const unvisitBtn = target.closest("[data-bom-unvisit]");
      if (unvisitBtn) {
        const pid = unvisitBtn.getAttribute("data-bom-unvisit");
        if (pid) {
          delete state.visitedLinks[pid];
          try { sessionStorage.setItem("ct_pro_visited_links", JSON.stringify(state.visitedLinks)); } catch (err) {}
          updateUI();
        }
      }
    });

    // 7) DB 탭 필터 및 관리자 모드 제어
    const openAdminModal = () => {
      const modal = byId("adminAuthModal");
      const locked = byId("adminModalLockedView");
      const unlocked = byId("adminModalUnlockedView");
      const icon = byId("adminModalIcon");
      const err = byId("adminPasswordError");
      if (err) err.classList.add("hidden");
      if (locked) locked.classList.toggle("hidden", state.adminUnlocked);
      if (unlocked) unlocked.classList.toggle("hidden", !state.adminUnlocked);
      if (icon) icon.textContent = state.adminUnlocked ? "🔓" : "🔒";
      if (modal) modal.classList.remove("hidden");
      if (!state.adminUnlocked) {
        const inp = byId("adminPasswordInput");
        if (inp) setTimeout(() => inp.focus(), 50);
      }
    };

    const closeAdminModal = () => {
      const modal = byId("adminAuthModal");
      if (modal) modal.classList.add("hidden");
    };

    const handleUnlock = async () => {
      const inp = byId("adminPasswordInput");
      const err = byId("adminPasswordError");
      const val = (inp ? inp.value : "").trim();
      if (!val) return;
      const hashed = await sha256Hex(val);
      if (hashed === ADMIN_PW_HASH) {
        state.adminUnlocked = true;
        state.adminPassword = val;
        if (inp) inp.value = "";
        closeAdminModal();
        renderAdminUiState();
        if (state.activeTab === "simulator") switchTab("products");
        showToast("관리자 인증 완료! 난로·연통 DB 및 텐트 DB 관리가 활성화되었습니다.");
      } else {
        if (err) err.classList.remove("hidden");
      }
    };

    onEl("adminToggleHeaderBtn", "click", openAdminModal);
    onEl("closeAdminModalBtn", "click", closeAdminModal);
    onEl("adminAuthModal", "click", (e) => { if (e.target && e.target.id === "adminAuthModal") closeAdminModal(); });
    onEl("adminUnlockSubmitBtn", "click", handleUnlock);
    onEl("adminPasswordInput", "keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); handleUnlock(); } });
    onEl("adminGoProductsBtn", "click", () => { closeAdminModal(); switchTab("products"); });
    onEl("adminGoTentsBtn", "click", () => { closeAdminModal(); switchTab("tents"); });
    onEl("adminSyncQuickBtn", "click", () => {
      closeAdminModal();
      syncProductsFromServer(true);
      syncTentsFromServer(true);
    });
    onEl("adminLockBtn", "click", () => {
      state.adminUnlocked = false;
      state.adminPassword = "";
      closeAdminModal();
      renderAdminUiState();
      showToast("관리자 잠금이 완료되었습니다.");
    });

    onEl("proManualSyncBtn", "click", () => syncProductsFromServer(true));
    onEl("proAdminSyncNowBtn", "click", () => syncProductsFromServer(true));
    onEl("proSaveSyncEndpointBtn", "click", () => {
      const inp = byId("proSyncEndpointInput");
      state.syncEndpoint = (inp && inp.value.trim()) ? inp.value.trim() : "/api/products";
      try { localStorage.setItem("ct_pro_sync_endpoint", state.syncEndpoint); } catch (e) {}
      syncProductsFromServer(true);
    });
    onEl("proAdminResetLocalBtn", "click", () => {
      try { localStorage.removeItem("ct_pro_products_override_v1"); } catch (e) {}
      resetLocalProductsInMemory();
      populateStoveDropdown();
      renderProductsTab();
      updateUI();
      showToast("로컬 상품 수정 기록을 초기 기본값으로 복원했습니다.");
      syncProductsFromServer(false);
    });
    onEl("adminAddProdBtn", "click", () => {
      const name = (byId("adminNewName") ? byId("adminNewName").value : "").trim();
      if (!name) { showToast("신규 상품명을 입력해 주세요."); return; }
      const mat = byId("adminNewMat") ? byId("adminNewMat").value : "stainless";
      const price = Math.max(0, Number(byId("adminNewPrice") ? byId("adminNewPrice").value : 0) || 0);
      const url = (byId("adminNewUrl") ? byId("adminNewUrl").value : "").trim() || STORE_URL;
      const id = `p_adm_${Date.now()}`;
      PRODUCTS[id] = { id, mat, isStove: false, name, price, status: "판매중", url };
      saveLocalAdminOverrides();
      renderProductsTab();
      updateUI();
      if (byId("adminNewName")) byId("adminNewName").value = "";
      if (byId("adminNewUrl")) byId("adminNewUrl").value = "";
      showToast(`"${name}" 상품이 추가되었습니다.`);
    });

    onEl("productCardsGrid", "change", (e) => {
      if (!state.adminUnlocked) return;
      const el = e.target;
      if (!el || !el.getAttribute) return;
      const pidName = el.getAttribute("data-adm-name");
      const pidSt = el.getAttribute("data-adm-status");
      const pidPr = el.getAttribute("data-adm-price");
      const pidUrl = el.getAttribute("data-adm-url");
      const pid = pidName || pidSt || pidPr || pidUrl;
      if (!pid || !PRODUCTS[pid]) return;
      if (pidName) PRODUCTS[pid].name = el.value.trim() || PRODUCTS[pid].name;
      if (pidSt) {
        PRODUCTS[pid].deleted = el.value === "삭제됨";
        PRODUCTS[pid].status = el.value;
      }
      if (pidPr) PRODUCTS[pid].price = Math.max(0, Number(el.value) || 0);
      if (pidUrl && el.value.trim()) PRODUCTS[pid].url = el.value.trim();
      syncStoveModelsFromProducts();
      saveLocalAdminOverrides();
      populateStoveDropdown();
      renderProductsTab();
      updateUI();
      showToast(`"${PRODUCTS[pid].name}" 변경사항이 저장되었습니다.`);
    });

    // 7-2) 관리자 모드: 텐트 DB Supabase 연동 + 추가·수정·삭제·초기화·JSON 복사
    onEl("proTentManualSyncBtn", "click", () => syncTentsFromServer(true));
    onEl("proAdminSyncTentsNowBtn", "click", () => syncTentsFromServer(true));
    const runExtractTentFromUrl = async () => {
      if (!state.adminUnlocked) return;
      const urlInp = byId("adminTentSourceUrl");
      const fetchBtn = byId("adminFetchTentUrlBtn");
      const fbEl = byId("adminTentUrlFeedback");
      const rawUrl = (urlInp ? urlInp.value : "").trim();
      if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
        showToast("http:// 또는 https:// 로 시작하는 텐트 페이지 주소를 입력해 주세요.");
        return;
      }

      if (fetchBtn) { fetchBtn.disabled = true; fetchBtn.textContent = "분석 중..."; }
      if (fbEl) {
        fbEl.className = "rounded-md px-2.5 py-1.5 text-[11px] font-semibold bg-sky-50 border border-sky-200 text-sky-800";
        fbEl.textContent = "⏳ 웹페이지에서 텐트 브랜드·모델명·설치 사이즈를 분석하고 있습니다...";
        fbEl.classList.remove("hidden");
      }

      const res = await pushTentToServer("POST", { action: "extract_url", url: rawUrl });

      if (fetchBtn) { fetchBtn.disabled = false; fetchBtn.textContent = "🔍 주소에서 사이즈 자동 입력"; }

      if (!res.ok || !res.data || !res.data.tent) {
        if (fbEl) {
          fbEl.className = "rounded-md px-2.5 py-1.5 text-[11px] font-semibold bg-amber-50 border border-amber-200 text-amber-900";
          fbEl.textContent = `⚠️ ${res.error || "페이지 분석에 실패했습니다."}`;
          fbEl.classList.remove("hidden");
        }
        return;
      }

      const t = res.data.tent;
      if (t.origin) setVal("adminTentOrigin", t.origin);
      if (t.brand) setVal("adminTentBrand", t.brand);
      if (t.name) setVal("adminTentName", t.name);
      if (t.shape) setVal("adminTentShape", t.shape);
      if (t.defaultPath) setVal("adminTentPath", t.defaultPath);
      if (t.w) setVal("adminTentWidth", t.w);
      if (t.l) setVal("adminTentLength", t.l);
      if (t.peakHeight) setVal("adminTentHeight", t.peakHeight);
      if (t.defaultJackHeight) setVal("adminTentJackHeight", t.defaultJackHeight);
      if (typeof t.sw === "number") setVal("adminTentSw", t.sw);

      if (fbEl) {
        if (res.data.foundDimensions) {
          fbEl.className = "rounded-md px-2.5 py-1.5 text-[11px] font-semibold bg-emerald-50 border border-emerald-200 text-emerald-800";
          fbEl.textContent = `✅ 자동 입력 완료 (${res.data.method === "ai" ? "AI 정밀 분석" : "규격 패턴 추출"}): ${t.brand} ${t.name} · 폭 ${t.w}×길이 ${t.l}×높이 ${t.peakHeight}cm (홀잭 ${t.defaultJackHeight}cm). 수치 확인 후 [➕ 텐트 추가]를 눌러주세요.`;
        } else {
          fbEl.className = "rounded-md px-2.5 py-1.5 text-[11px] font-semibold bg-amber-50 border border-amber-200 text-amber-900";
          fbEl.textContent = `⚠️ ${res.data.warning || "치수를 자동 추출하지 못해 기본값으로 채웠습니다. 수치를 확인해 주세요."}`;
        }
        fbEl.classList.remove("hidden");
      }
      showToast(res.data.foundDimensions ? "URL에서 텐트 사이즈를 자동으로 입력했습니다!" : "브랜드/제목만 추출되었습니다. 치수를 확인해 주세요.");
    };

    onEl("adminFetchTentUrlBtn", "click", runExtractTentFromUrl);
    onEl("adminTentSourceUrl", "keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); runExtractTentFromUrl(); }
    });

    onEl("adminAddTentBtn", "click", async () => {
      if (!state.adminUnlocked) return;
      const origin = byId("adminTentOrigin") ? byId("adminTentOrigin").value : "국내";
      const brand = (byId("adminTentBrand") ? byId("adminTentBrand").value : "").trim();
      const name = (byId("adminTentName") ? byId("adminTentName").value : "").trim();
      const shape = byId("adminTentShape") ? byId("adminTentShape").value : "dome";
      const defaultPath = byId("adminTentPath") ? byId("adminTentPath").value : "straight";
      const w = Math.round(Number(byId("adminTentWidth") ? byId("adminTentWidth").value : 0));
      const l = Math.round(Number(byId("adminTentLength") ? byId("adminTentLength").value : 0));
      const peakHeight = Math.round(Number(byId("adminTentHeight") ? byId("adminTentHeight").value : 0));
      const defaultJackHeight = Math.round(Number(byId("adminTentJackHeight") ? byId("adminTentJackHeight").value : 0));
      const swRaw = (byId("adminTentSw") ? byId("adminTentSw").value : "").trim();

      if (!brand || !name) {
        showToast("브랜드명과 텐트 모델명을 모두 입력해 주세요.");
        return;
      }
      if (!Number.isFinite(w) || w < 150 || w > 800 || !Number.isFinite(l) || l < 150 || l > 1000) {
        showToast("설치 폭(150~800cm)과 길이(150~1000cm)를 올바르게 입력해 주세요.");
        return;
      }
      if (!Number.isFinite(peakHeight) || peakHeight < 130 || peakHeight > 350) {
        showToast("최고 높이는 130~350cm 범위로 입력해 주세요.");
        return;
      }
      if (!Number.isFinite(defaultJackHeight) || defaultJackHeight < 80 || defaultJackHeight > 320 || defaultJackHeight >= peakHeight) {
        showToast("권장 홀잭 높이는 80cm 이상이며 텐트 최고 높이보다 낮아야 합니다.");
        return;
      }

      const sw = swRaw !== "" && Number.isFinite(Number(swRaw))
        ? Math.max(0, Math.min(peakHeight, Math.round(Number(swRaw))))
        : (shape === "tipi" ? 0 : Math.round(peakHeight * 0.6));

      const newTent = {
        id: `tent_adm_${Date.now()}`,
        origin,
        brand,
        name,
        shape,
        w,
        l,
        peakHeight,
        sw,
        defaultJackHeight,
        defaultPath,
        isAdminAdded: true
      };

      const addBtn = byId("adminAddTentBtn");
      if (addBtn) { addBtn.disabled = true; addBtn.textContent = "저장 중..."; }

      const remoteRes = await pushTentToServer("POST", newTent);
      if (remoteRes.ok) {
        newTent.isRemoteSynced = true;
      }

      TENT_MODELS.unshift(newTent);
      saveLocalTentOverrides();
      populateTentDropdown();
      renderTentsTab();

      if (addBtn) { addBtn.disabled = false; addBtn.textContent = "➕ 텐트 추가"; }
      if (byId("adminTentBrand")) byId("adminTentBrand").value = "";
      if (byId("adminTentName")) byId("adminTentName").value = "";
      if (byId("adminTentSw")) byId("adminTentSw").value = "";
      if (byId("adminTentSourceUrl")) byId("adminTentSourceUrl").value = "";
      if (byId("adminTentUrlFeedback")) byId("adminTentUrlFeedback").classList.add("hidden");

      if (remoteRes.ok) {
        showToast(`✅ "${brand} ${name}" Supabase에 영구 저장 완료! 모든 고객에게 자동 노출됩니다.`);
        syncTentsFromServer(false);
      } else if (remoteRes.offline) {
        showToast(`"${brand} ${name}" 추가됨 (로컬 미리보기 저장)`);
      } else {
        showToast(`로컬에만 추가됨 · Supabase 저장 실패: ${remoteRes.error}`);
      }
    });

    onEl("proAdminResetTentsBtn", "click", () => {
      if (!state.adminUnlocked) return;
      try { localStorage.removeItem("ct_pro_tents_override_v1"); } catch (e) {}
      resetLocalTentsInMemory();
      if (!TENT_MODELS.some((t) => t.id === state.selectedTentId) && state.selectedTentId !== "custom_tent") {
        state.selectedTentId = TENT_MODELS[0].id;
      }
      populateTentDropdown();
      renderTentsTab();
      updateUI();
      showToast("로컬 텐트 캐시를 초기화했습니다. Supabase 최신 데이터를 불러옵니다.");
      syncTentsFromServer(false);
    });

    onEl("proAdminExportTentsBtn", "click", () => {
      if (!state.adminUnlocked) return;
      const cleanList = TENT_MODELS.map(({ isAdminAdded, isRemoteSynced, ...rest }) => rest);
      copyTextToClipboard(JSON.stringify(cleanList, null, 2), "현재 텐트 DB JSON이 클립보드에 복사되었습니다.");
    });

    onEl("tentDbTableBody", "change", async (e) => {
      if (!state.adminUnlocked) return;
      const el = e.target;
      if (!el || !el.getAttribute) return;
      const tidH = el.getAttribute("data-adm-tent-h");
      const tidJh = el.getAttribute("data-adm-tent-jh");
      const tidPath = el.getAttribute("data-adm-tent-path");
      const tid = tidH || tidJh || tidPath;
      if (!tid) return;
      const tent = TENT_MODELS.find((t) => t.id === tid);
      if (!tent) return;

      if (tidH) {
        const v = Math.max(130, Math.min(350, Math.round(Number(el.value) || tent.peakHeight)));
        tent.peakHeight = v;
        if (tent.defaultJackHeight >= v) tent.defaultJackHeight = Math.max(80, v - 15);
      }
      if (tidJh) {
        const v = Math.max(80, Math.min(Math.min(320, tent.peakHeight - 5), Math.round(Number(el.value) || tent.defaultJackHeight)));
        tent.defaultJackHeight = v;
      }
      if (tidPath && ["straight", "elbow45", "elbow90"].includes(el.value)) {
        tent.defaultPath = el.value;
      }

      saveLocalTentOverrides();
      populateTentDropdown();
      renderTentsTab();
      if (state.selectedTentId === tent.id) {
        applyTentModel(tent.id);
      }

      const remoteRes = await pushTentToServer("PATCH", tent);
      if (remoteRes.ok) {
        tent.isRemoteSynced = true;
        showToast(`✅ "${tent.brand} ${tent.name}" 수정사항이 Supabase에 영구 반영되었습니다.`);
      } else if (remoteRes.offline) {
        showToast(`"${tent.brand} ${tent.name}" 제원이 수정되었습니다 (로컬 저장).`);
      } else {
        showToast(`로컬 수정됨 · Supabase 반영 실패: ${remoteRes.error}`);
      }
    });

    document.querySelectorAll(".prod-cat-btn").forEach((b) => {
      b.addEventListener("click", () => {
        state.productCategoryFilter = b.getAttribute("data-pcat");
        document.querySelectorAll(".prod-cat-btn").forEach((x) => {
          x.className = x.getAttribute("data-pcat") === state.productCategoryFilter
            ? "prod-cat-btn px-3 py-1.5 rounded-lg text-xs font-bold bg-orange-600 text-white"
            : "prod-cat-btn px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200";
        });
        renderProductsTab();
      });
    });

    document.querySelectorAll(".tent-db-filter-btn").forEach((b) => {
      b.addEventListener("click", () => {
        state.tentDbFilter = b.getAttribute("data-tfilter");
        document.querySelectorAll(".tent-db-filter-btn").forEach((x) => {
          x.className = x.getAttribute("data-tfilter") === state.tentDbFilter
            ? "tent-db-filter-btn px-3 py-1.5 rounded-lg text-xs font-bold bg-orange-600 text-white"
            : "tent-db-filter-btn px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700";
        });
        renderTentsTab();
      });
    });

    onEl("tentDbSearchInput", "input", (e) => {
      state.tentDbSearch = e.target.value;
      renderTentsTab();
    });

    onEl("tentDbTableBody", "click", async (e) => {
      const target = e.target && e.target.closest ? e.target : null;
      if (!target) return;

      const delBtn = target.closest("[data-adm-tent-del]");
      if (delBtn && state.adminUnlocked) {
        const tid = delBtn.getAttribute("data-adm-tent-del");
        const idx = TENT_MODELS.findIndex((t) => t.id === tid);
        if (idx === -1) return;
        const removed = TENT_MODELS[idx];
        if (TENT_MODELS.length <= 1) {
          showToast("최소 1개 이상의 텐트 모델이 필요합니다.");
          return;
        }
        TENT_MODELS.splice(idx, 1);
        saveLocalTentOverrides();
        if (state.selectedTentId === tid) {
          applyTentModel(TENT_MODELS[0].id);
        }
        populateTentDropdown();
        renderTentsTab();

        const remoteRes = await pushTentToServer("DELETE", removed);
        if (remoteRes.ok) {
          showToast(`✅ "${removed.brand} ${removed.name}" 삭제가 Supabase에 영구 반영되었습니다.`);
        } else if (remoteRes.offline) {
          showToast(`"${removed.brand} ${removed.name}" 텐트가 삭제되었습니다 (로컬 저장).`);
        } else {
          showToast(`로컬 삭제됨 · Supabase 반영 실패: ${remoteRes.error}`);
        }
        return;
      }

      const b = target.closest(".apply-tent-db-btn");
      if (!b) return;
      state.tentOriginFilter = "all";
      syncOriginFilterButtons();
      populateTentDropdown();
      applyTentModel(b.getAttribute("data-apply-tent"));
      switchTab("simulator");
      showToast("선택하신 텐트 제원이 시뮬레이터에 적용되었습니다.");
    });

    // 8) AI 텐트 검색
    const input = byId("custTentSearchInput");
    const btn = byId("custTentSearchBtn");
    const suggest = byId("custTentSuggestBox");
    const fb = byId("custTentSearchFeedback");
    const resBox = byId("custTentResultsBox");
    const resTitle = byId("custTentResultsTitle");
    const resList = byId("custTentResultsList");
    const resClose = byId("custTentResultsClose");
    const forceAiBtn = byId("custTentForceAiBtn");
    if (!input || !btn || !suggest || !fb || !resBox || !resTitle || !resList || !resClose || !forceAiBtn) return;

    const allLocalTents = () => [
      ...TENT_MODELS.map((t) => ({ source: "main", id: t.id, displayName: `${t.brand} ${t.name}`, aliases: `${t.brand} ${t.name} ${t.origin}`, shape: t.shape, w: t.w, l: t.l, h: t.peakHeight, jh: t.defaultJackHeight, path: t.defaultPath })),
      ...EXTRA_TENT_CATALOG.map((t) => ({ source: "extra", id: t.id, displayName: `${t.brand} ${t.name}`, aliases: `${t.brand} ${t.name} ${t.aliases || ""}`, shape: t.shape, w: t.w, l: t.l, h: t.h, jh: t.jh, path: t.path }))
    ];

    const searchLocal = (qRaw) => {
      const q = normalizeSearchStr(qRaw);
      if (!q) return [];
      const tokens = String(qRaw).toLowerCase().split(/\s+/).map(normalizeSearchStr).filter(Boolean);
      return allLocalTents()
        .map((item) => {
          const hay = normalizeSearchStr(item.displayName + " " + item.aliases);
          if (!tokens.every((tk) => hay.includes(tk))) return null;
          return { item, score: hay === q ? 100 : (hay.includes(q) ? 60 : 35) };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .slice(0, 7)
        .map((x) => x.item);
    };

    const applyLocal = (item) => {
      suggest.classList.add("hidden");
      resBox.classList.add("hidden");
      input.value = item.displayName;
      state.isAiEstimated = false;

      if (item.source === "main") {
        state.tentOriginFilter = "all";
        syncOriginFilterButtons();
        populateTentDropdown();
        applyTentModel(item.id);
      } else {
        state.selectedTentId = "custom_tent";
        state.customTentWidth = item.w || 340;
        state.customTentLength = item.l || 420;
        state.tentShape = item.shape || "dome";
        state.tentHeight = item.h || 200;
        state.jackHeight = item.jh || 150;
        state.pathType = item.path || "straight";
        state.extraOutPipes = 0;
        resetStoveAndJackPositions();
        syncInputsFromState();
        updateUI();
      }

      fb.className = "rounded-lg px-2.5 py-2 text-xs font-semibold bg-emerald-50 border border-emerald-200 text-emerald-800";
      fb.textContent = `✅ ${item.displayName} 자동 입력 완료 (높이 ${item.h}cm · 폭 ${item.w}cm · 홀잭 ${item.jh}cm)`;
      fb.classList.remove("hidden");
    };

    const applyAi = (item, sources, origQ) => {
      const label = `${item.brand ? item.brand + " " : ""}${item.name || origQ}`.trim();
      const peakH = Math.max(130, Math.min(350, Math.round(Number(item.peakHeight) || 200)));
      const jackH = Math.max(80, Math.min(Math.min(320, peakH - 10), Math.round(Number(item.jackHeight) || Math.round(peakH * 0.78))));
      const tentW = Math.max(150, Math.min(800, Math.round(Number(item.tentWidth) || 340)));
      const tentL = Math.max(150, Math.min(1000, Math.round(Number(item.tentLength) || 420)));

      input.value = label;
      state.selectedTentId = "custom_tent";
      state.customTentWidth = tentW;
      state.customTentLength = tentL;
      state.tentHeight = peakH;
      state.jackHeight = jackH;
      state.tentShape = ["dome", "tunnel", "tipi", "cabin"].includes(item.shape) ? item.shape : "dome";
      if (["straight", "elbow45", "elbow90"].includes(item.defaultPath)) state.pathType = item.defaultPath;
      state.extraOutPipes = 0;
      state.isAiEstimated = true;
      resetStoveAndJackPositions();
      syncInputsFromState();
      updateUI();
      resBox.classList.add("hidden");
      suggest.classList.add("hidden");
      const srcHtml = (Array.isArray(sources) && sources.length)
        ? ` · <a href="${sanitizeUrl(sources[0].url)}" target="_blank" rel="noopener noreferrer" class="underline font-bold">출처 ↗</a>`
        : "";
      fb.className = "rounded-lg px-2.5 py-2 text-xs font-semibold bg-emerald-50 border border-emerald-200 text-emerald-800";
      fb.innerHTML = `🤖 <strong>AI 자동입력:</strong> ${escapeHtml(label)} (높이 ${peakH}cm · 폭 ${tentW}cm · 홀잭 ${jackH}cm)${srcHtml}`;
      fb.classList.remove("hidden");
    };

    const showPicker = (title, items, isAi, sources, origQ) => {
      resTitle.textContent = title;
      resList.innerHTML = items.map((m, i) => {
        const label = m.displayName || `${m.brand ? m.brand + " " : ""}${m.name || ""}`.trim();
        const sub = m.summary || `높이 ${m.h || m.peakHeight}cm · 폭 ${m.w || m.tentWidth}cm · 홀잭 ${m.jh || m.jackHeight}cm`;
        return `<button type="button" data-pidx="${i}" class="w-full text-left px-2.5 py-2 rounded-lg bg-slate-50 hover:bg-orange-50 border border-slate-200 flex items-center justify-between gap-2"><div class="min-w-0"><div class="text-xs font-bold text-slate-900 truncate">${escapeHtml(label)}</div><div class="text-[11px] text-slate-500 truncate">${escapeHtml(sub)}</div></div><span class="px-2 py-0.5 rounded bg-orange-500 text-white text-[11px] font-bold">선택</span></button>`;
      }).join("");
      forceAiBtn.classList.toggle("hidden", isAi);
      resBox.classList.remove("hidden");
      resList.querySelectorAll("button[data-pidx]").forEach((b) => {
        b.addEventListener("click", () => {
          const chosen = items[Number(b.getAttribute("data-pidx"))];
          if (chosen) {
            if (isAi) applyAi(chosen, sources, origQ);
            else applyLocal(chosen);
          }
        });
      });
    };

    const runSearch = async (forceWeb) => {
      if (state.isSearchingAi) return;
      const q = input.value.trim();
      if (!q) { showToast("검색할 텐트 모델명을 입력해 주세요."); return; }
      suggest.classList.add("hidden");
      if (!forceWeb) {
        const local = searchLocal(q);
        if (local.length === 1) { applyLocal(local[0]); return; }
        if (local.length > 1) { fb.classList.add("hidden"); showPicker(`"${q}" 검색 결과 ${local.length}건`, local, false, [], q); return; }
      }
      state.isSearchingAi = true;
      resBox.classList.add("hidden");
      btn.disabled = true;
      btn.textContent = "AI 검색중...";
      fb.className = "rounded-lg px-2.5 py-2 text-xs font-semibold bg-sky-50 border border-sky-200 text-sky-800";
      fb.textContent = `🤖 AI가 인터넷에서 "${q}" 텐트 규격을 확인 중입니다... (최대 8초)`;
      fb.classList.remove("hidden");

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const isHttp = window.location && /^https?:\/\//i.test(window.location.href);
        if (!isHttp) {
          fb.className = "rounded-lg px-2.5 py-2 text-xs font-semibold bg-amber-50 border border-amber-200 text-amber-800";
          fb.textContent = "미리보기 환경입니다. Vercel 배포 사이트에서 AI 웹 검색이 실시간으로 작동합니다.";
        } else {
          const res = await fetch(`/api/tent-search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
          const data = await res.json().catch(() => null);
          if (res.ok && data && data.ok) {
            const list = Array.isArray(data.candidates) && data.candidates.length ? data.candidates : (data.tent ? [data.tent] : []);
            if (list.length === 1) applyAi(list[0], data.sources, q);
            else if (list.length > 1) { fb.classList.add("hidden"); showPicker(`🤖 AI 검색 결과 ${list.length}건`, list, true, data.sources, q); }
          } else {
            fb.className = "rounded-lg px-2.5 py-2 text-xs font-semibold bg-amber-50 border border-amber-200 text-amber-800";
            fb.textContent = (data && data.error) ? `⚠️ ${data.error}` : `"${q}"의 공식 규격을 찾지 못했습니다. 아래 슬라이더로 직접 입력해 주세요.`;
          }
        }
      } catch (err) {
        fb.className = "rounded-lg px-2.5 py-2 text-xs font-semibold bg-amber-50 border border-amber-200 text-amber-800";
        fb.textContent = (err && err.name === "AbortError")
          ? "⚠️ AI 검색 응답이 지연(8초 초과)되었습니다. 아래 슬라이더로 텐트 높이를 직접 입력해 주세요."
          : "⚠️ AI 검색 서버에 연결하지 못했습니다.";
      } finally {
        clearTimeout(timer);
        state.isSearchingAi = false;
        btn.disabled = false;
        btn.textContent = "AI 검색";
      }
    };

    input.addEventListener("input", () => {
      const q = input.value.trim();
      if (!q) { suggest.classList.add("hidden"); return; }
      const matches = searchLocal(q);
      suggest.innerHTML = matches.map((m, i) => `<button type="button" data-sidx="${i}" class="w-full text-left px-3 py-2 hover:bg-orange-50 flex items-center justify-between gap-2"><span class="text-xs font-bold text-slate-900 truncate">${escapeHtml(m.displayName)}</span><span class="text-[11px] text-slate-500">${m.h}cm</span></button>`).join("")
        + `<button type="button" id="proSuggestAiBtn" class="w-full text-left px-3 py-2 bg-sky-50 hover:bg-sky-100 flex items-center justify-between gap-2"><span class="text-xs font-extrabold text-sky-700 truncate">🤖 "${escapeHtml(q)}" AI 인터넷 자동 검색</span><span class="text-[11px] font-bold text-sky-600">실시간 ↗</span></button>`;
      suggest.classList.remove("hidden");
      suggest.querySelectorAll("button[data-sidx]").forEach((b) => b.addEventListener("click", () => applyLocal(matches[Number(b.getAttribute("data-sidx"))])));
      onEl("proSuggestAiBtn", "click", () => runSearch(true));
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(false); } });
    btn.addEventListener("click", () => runSearch(false));
    resClose.addEventListener("click", () => resBox.classList.add("hidden"));
    forceAiBtn.addEventListener("click", () => runSearch(true));
    document.addEventListener("click", (e) => {
      if (!input.contains(e.target) && !suggest.contains(e.target)) suggest.classList.add("hidden");
    });
  }

  /* =========================================================
   * 11. 앱 초기화 엔트리포인트
   * ========================================================= */
  function initProApp() {
    if (window.__ctProInitialized) return;
    window.__ctProInitialized = true;

    // 1단계: UI 이벤트 최우선 바인딩
    try { bindEvents(); } catch (err) { console.error("[Pro bindEvents Error]", err); }

    // 2단계: 로컬 캐시 선행 로드 (URL 파라미터 복원 시 추가된 텐트/상품 인식 보장)
    try { loadLocalAdminOverrides(); } catch (e) {}
    try { loadLocalTentOverrides(); } catch (e) {}
    try { syncStoveModelsFromProducts(); } catch (e) {}

    // 3단계: 세션 및 URL 파라미터 복원
    try {
      const rawV = sessionStorage.getItem("ct_pro_visited_links");
      if (rawV) state.visitedLinks = JSON.parse(rawV) || {};
    } catch (e) {}

    try {
      const p = new URLSearchParams(window.location.search);
      const tId = p.get("tent") || "";
      if (tId === "custom_tent") {
        state.selectedTentId = "custom_tent";
      } else if (tId) {
        const ft = TENT_MODELS.find((t) => t.id === tId || t.id.endsWith("_" + tId));
        if (ft) {
          state.selectedTentId = ft.id;
          state.tentShape = ft.shape;
          state.tentHeight = ft.peakHeight;
          state.jackHeight = ft.defaultJackHeight;
          state.pathType = ft.defaultPath;
        }
      }
      const stId = p.get("stove") || "";
      if (stId) {
        const fs = STOVE_MODELS.find((s) => !s.deleted && (s.id === stId || s.id.startsWith(stId)));
        if (fs) {
          state.selectedStoveId = fs.id;
          state.stoveHeight = fs.stoveHeight;
          state.pipeSystem = fs.recommendedPipeSystem;
        }
      }
      const th = p.get("th") !== null ? Number(p.get("th")) : NaN;
      if (Number.isFinite(th) && th >= 130 && th <= 350) state.tentHeight = th;
      const jh = p.get("jh") !== null ? Number(p.get("jh")) : NaN;
      if (Number.isFinite(jh) && jh >= 80 && jh <= 320) state.jackHeight = jh;
      const sh = p.get("sh") !== null ? Number(p.get("sh")) : NaN;
      if (Number.isFinite(sh) && sh >= 20 && sh <= 90) state.stoveHeight = sh;
      const stH = p.get("st") !== null ? Number(p.get("st")) : NaN;
      if (Number.isFinite(stH) && stH >= 0 && stH <= 80) state.standHeight = stH;
      const path = p.get("path");
      if (["straight", "elbow45", "elbow90"].includes(path)) state.pathType = path;
      const pipe = p.get("pipe");
      if (["tapered_70_73_76", "single_70", "single_75", "ti_nested_70_76", "ti_single_70_76", "ti_nested_83_89"].includes(pipe)) state.pipeSystem = pipe;
      const prot = p.get("prot");
      if (["double_pipe", "mesh_guard", "both_guard", "ti_guard_70"].includes(prot)) state.protectionType = prot;
      const ex = p.get("ex") !== null ? Number(p.get("ex")) : NaN;
      if (Number.isFinite(ex) && ex >= -4 && ex <= 6) state.extraOutPipes = ex;
    } catch (e) {}

    // 4단계: 드롭다운·도면·DB 초기 렌더링 및 서버(Supabase) 자동 동기화
    try { populateStoveDropdown(); } catch (e) {}
    try { populateTentDropdown(); } catch (e) {}
    try { syncOriginFilterButtons(); } catch (e) {}
    try { syncMaterialSelectors(); } catch (e) {}
    try { resetStoveAndJackPositions(); } catch (e) {}
    try { syncInputsFromState(); } catch (e) {}
    try { renderAdminUiState(); } catch (e) {}
    try { updateUI(); } catch (e) {}
    try { syncProductsFromServer(false); } catch (e) {}
    try { syncTentsFromServer(false); } catch (e) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initProApp);
  } else {
    initProApp();
  }
})();