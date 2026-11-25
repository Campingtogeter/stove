/* =========================================================
 * 캠핑투게더 난로·연통 시뮬레이터 (상세 버전) 기준 데이터
 * - window.CT_PRO_DATA 전역 객체로 노출
 * - pro-app.js 보다 먼저 로드되어야 합니다.
 * ========================================================= */

(function (global) {
  "use strict";

  const STORE_URL = "https://smartstore.naver.com/camping-together";
  const SPARK_MIN_CLEARANCE_CM = 60;
  const ADMIN_PW_HASH = "c4b2fa036cc79e0f84169a1cafa18f89eb9a7431b7fa6842336d91245b12f483";

  const PRODUCTS = {
    p_mstove_v3: { id: "p_mstove_v3", mat: "stainless", isStove: true, name: "캠핑투게더 엠스토브 v3 3도어 IGT", price: 728000, status: "판매중", url: "https://smartstore.naver.com/camping-together/products/12412109224" },
    p_mstove_v2_down: { id: "p_mstove_v2_down", mat: "stainless", isStove: true, name: "캠핑투게더 엠스토브 v2 다운사이징", price: 724000, status: "품절", url: "https://smartstore.naver.com/camping-together/products/11193147629" },
    p_mjolnir_ddakkung: { id: "p_mjolnir_ddakkung", mat: "stainless", isStove: true, name: "캠핑투게더 묠니르 + 따꿍 화목난로 키트", price: 157000, status: "판매중", url: "https://campingtogether.co.kr/product/%EB%94%B0%EA%BF%8D-%ED%99%94%EB%AA%A9%EB%82%9C%EB%A1%9C-%EC%97%85%EA%B7%B8%EB%A0%88%EC%9D%B4%EB%93%9C-%ED%82%A4%ED%8A%B8-%EB%AC%A0%EB%8B%88%EB%A5%B4-%ED%99%94%EB%A1%9C%EB%8C%80-%EC%A0%84%EC%9A%A9/15/" },
    p_dweller_max3: { id: "p_dweller_max3", mat: "stainless", isStove: true, name: "포몰리 드웰러 맥스 3 (스테인리스)", price: 780000, status: "품절", url: "https://smartstore.naver.com/camping-together/products/11241535740" },
    p_lumora_ti: { id: "p_lumora_ti", mat: "titanium", isStove: true, name: "포몰리 루모라 Ti 티타늄 화목난로", price: 1480000, status: "판매중", url: "https://smartstore.naver.com/camping-together/products/13876525264" },
    p_dweller_ti3: { id: "p_dweller_ti3", mat: "titanium", isStove: true, name: "포몰리 드웰러 맥스 티아이 3 (티타늄)", price: 1180000, status: "판매중", url: "https://smartstore.naver.com/camping-together/products/9935043562" },
    p_pomoly_xti5: { id: "p_pomoly_xti5", mat: "titanium", isStove: true, name: "포몰리 엑스-티아이 5 (X-Ti 5 티타늄)", price: 680000, status: "판매중", url: "https://campingtogether.co.kr/product/%ED%8F%AC%EB%AA%B0%EB%A6%AC-%EC%97%91%EC%8A%A4-%ED%8B%B0%EC%95%84%EC%9D%B4-5-%ED%8B%B0%ED%83%80%EB%8A%84-%EC%BA%A0%ED%95%91-%ED%99%94%EB%AA%A9%EB%82%9C%EB%A1%9C-pomoly-x-ti-5/52/" },

    p_set_33m: { id: "p_set_33m", mat: "stainless", name: "스텐 70-73-76파이 3.3m 연통 세트 (12본)", price: 86000, status: "품절", url: "https://smartstore.naver.com/camping-together/products/11196831287" },
    p_damper_70: { id: "p_damper_70", mat: "stainless", name: "스텐 70파이 댐퍼 연통 (28cm)", price: 17000, status: "판매중", url: "https://smartstore.naver.com/camping-together/products/11471381958" },
    p_pipe_70: { id: "p_pipe_70", mat: "stainless", name: "스텐 70파이 연통 직관 (33cm)", price: 5500, status: "판매중", url: "https://smartstore.naver.com/camping-together/products/11209918526" },
    p_pipe_73: { id: "p_pipe_73", mat: "stainless", name: "스텐 73파이 연통 직관 (33cm)", price: 6000, status: "판매중", url: "https://smartstore.naver.com/camping-together/products/11209932324" },
    p_pipe_76: { id: "p_pipe_76", mat: "stainless", name: "스텐 76파이 연장 직관 (33cm)", price: 6500, status: "판매중", url: "https://smartstore.naver.com/camping-together/products/11209936765" },
    p_flange_v2: { id: "p_flange_v2", mat: "stainless", name: "스텐 연통 후렌지 (엠스토브·묠니르·따꿍)", price: 17000, status: "판매중", url: "https://smartstore.naver.com/camping-together/products/11201633536" },
    p_pellet_docking: { id: "p_pellet_docking", mat: "stainless", name: "펠릿연소기 도킹툴 (엠스토브 V2·V3용)", price: 9500, status: "판매중", url: "https://smartstore.naver.com/camping-together/products/8013047406" },
    p_reducer_70_75: { id: "p_reducer_70_75", mat: "stainless", name: "스텐 레듀셔 Ø70수-75암 (30cm)", price: 9000, status: "판매중", url: "https://smartstore.naver.com/camping-together/products/13851610962" },
    p_pipe_75: { id: "p_pipe_75", mat: "stainless", name: "스텐 75파이 연통 직관 (32cm)", price: 6000, status: "판매중", url: "https://smartstore.naver.com/camping-together/products/12692680424" },
    p_spark_cap_75: { id: "p_spark_cap_75", mat: "stainless", name: "스텐 이중 불티캡 75파이 최상단", price: 19500, status: "판매중", url: "https://smartstore.naver.com/camping-together/products/12691610683" },
    p_elbow_70: { id: "p_elbow_70", mat: "stainless", name: "스텐 70파이 연통 엘보 45°/90°", price: 7500, status: "판매중", url: "https://smartstore.naver.com/camping-together/products/11320456470" },
    p_elbow_75: { id: "p_elbow_75", mat: "stainless", name: "스텐 75파이 연통 엘보 45°/90°", price: 6500, status: "판매중", url: "https://smartstore.naver.com/camping-together/products/12692644054" },
    p_double_70: { id: "p_double_70", mat: "stainless", name: "스텐 70파이 이중연통 (50cm)", price: 29000, status: "판매중", url: "https://smartstore.naver.com/camping-together/products/11318998547" },
    p_double_75: { id: "p_double_75", mat: "stainless", name: "스텐 75파이 이중연통 (50cm)", price: 27000, status: "판매중", url: "https://smartstore.naver.com/camping-together/products/11427862458" },
    p_mesh_guard: { id: "p_mesh_guard", mat: "both", name: "스텐 메쉬 텐트 보호망 (50cm · Ø60~90mm 스텐·티타늄 호환)", price: 33000, status: "판매중", url: "https://smartstore.naver.com/camping-together/products/12670070982" },

    p_ti_set_70_76: { id: "p_ti_set_70_76", mat: "titanium", name: "포몰리 티타늄 70-76파이 네스티드 연통 세트", price: 375000, status: "품절", url: "https://smartstore.naver.com/camping-together/products/11564393919" },
    p_ti_set_83_89: { id: "p_ti_set_83_89", mat: "titanium", name: "포몰리 티타늄 83-89파이 대형 연통 세트", price: 405000, status: "품절", url: "https://smartstore.naver.com/camping-together/products/12456936065" },
    p_ti_pipe_70_76: { id: "p_ti_pipe_70_76", mat: "titanium", name: "포몰리 티타늄 연통 70·76파이 단품 (Nested)", price: 55000, status: "판매중", url: "https://smartstore.naver.com/camping-together/products/11564468737" },
    p_ti_damper_base: { id: "p_ti_damper_base", mat: "titanium", name: "포몰리 티타늄 댐퍼 베이스 후렌지 70파이", price: 85000, status: "품절", url: "https://smartstore.naver.com/camping-together/products/11469982000" },
    p_ti_elbow_70: { id: "p_ti_elbow_70", mat: "titanium", name: "포몰리 티타늄 70파이 엘보 45°/90°", price: 64000, status: "품절", url: "https://smartstore.naver.com/camping-together/products/12456831949" },
    p_ti_guard_70: { id: "p_ti_guard_70", mat: "both", name: "포몰리 티타늄 스킨 홀잭 보호망 (가변식 · 고정 Ø60·70mm 전용)", price: 198000, status: "품절", url: "https://smartstore.naver.com/camping-together/products/11247319252" },

    p_guide_ring: { id: "p_guide_ring", mat: "both", name: "티타늄 76파이 연통 고정링 (가이드링)", price: 8500, status: "판매중", url: "https://smartstore.naver.com/camping-together/products/12673273220" },
    p_stand_550: { id: "p_stand_550", mat: "both", name: "유니버셜 스탠드 550 (55cm)", price: 115000, status: "품절", url: "https://smartstore.naver.com/camping-together/products/12412259304" },
    p_dweller_stand: { id: "p_dweller_stand", mat: "both", name: "포몰리 드웰러 맥스 전용 철재 수납 스탠드", price: 299000, status: "품절", url: "https://smartstore.naver.com/camping-together/products/11225250383" }
  };

  const STOVE_MODELS = [
    {
      id: "mstove_v3", mat: "stainless", name: "[스텐] 캠핑투게더 엠스토브 v3 3도어 IGT (35cm)", stoveHeight: 35, recommendedPipeSystem: "tapered_70_73_76", pid: "p_mstove_v3",
      includedPipes: 12, includedRings: 0, isRollPipe: false,
      compatDia: "스텐 Ø70-73-76mm (76파이 연장 시 3중 겹침 수납 호환)",
      includedSummary: "스텐 70-73-76파이 3.3m 연통 세트 총 12본 (Ø70 댐퍼 1 + Ø70 직관 4 + Ø70-73 레듀셔 1 + Ø73 직관 4 + Ø73-76 레듀셔 1 + Ø76 최상단 1)",
      optionsNote: "옵션: 난로 수납가방 · 유니버셜 스탠드 550(55cm) · 스탠드 가방 · 펠릿연소기 도킹툴"
    },
    {
      id: "mstove_v2_down", mat: "stainless", name: "[스텐] 캠핑투게더 엠스토브 v2 다운사이징 (35cm)", stoveHeight: 35, recommendedPipeSystem: "tapered_70_73_76", pid: "p_mstove_v2_down",
      includedPipes: 12, includedRings: 0, isRollPipe: false,
      compatDia: "스텐 Ø70-73-76mm (후렌지·70/73/76 단품 호환)",
      includedSummary: "스텐 70-73-76파이 3.3m 연통 세트 총 12본 (Ø70 댐퍼 1 + 직관 8 + 레듀셔 2 + Ø76 상단 1)",
      optionsNote: "옵션/호환: 펠릿연소기 도킹툴 · 연통 후렌지 · 70/73/76파이 연장 직관 · 70파이 엘보"
    },
    {
      id: "mjolnir_ddakkung", mat: "stainless", name: "[스텐] 캠핑투게더 묠니르 + 따꿍 키트 (38cm)", stoveHeight: 38, recommendedPipeSystem: "tapered_70_73_76", pid: "p_mjolnir_ddakkung",
      includedPipes: 0, includedRings: 0, isRollPipe: false,
      compatDia: "스텐 Ø70mm 베이스 (70-73-76파이 3.3m 세트 · 70파이 댐퍼/직관 호환)",
      includedSummary: "기본 포함 연통 없음 (연통 세트 별도 구매 필수)",
      optionsNote: "옵션/호환: 연통 후렌지 · 70-73-76파이 3.3m 연통 세트 · 70파이 댐퍼 연통"
    },
    {
      id: "dweller_max3", mat: "stainless", name: "[스텐] 포몰리 드웰러 맥스 3 다리펼침 (49cm)", stoveHeight: 49, recommendedPipeSystem: "single_70", pid: "p_dweller_max3",
      includedPipes: 9, includedRings: 1, isRollPipe: false,
      compatDia: "스텐 Ø70-75mm (304SS 70파이/75파이 직관·레듀셔 호환)",
      includedSummary: "스텐 연통 총 9본 (직관 8본 + 불티방지캡 연통 1본) + 연통 고정링 1개",
      optionsNote: "옵션/호환: 포몰리 드웰러 철재 스탠드 · 70/75파이 직관 · Ø70-75 레듀셔 · 70/75파이 이중연통"
    },
    {
      id: "lumora_ti", mat: "titanium", name: "[티타늄] 포몰리 루모라 Ti 다리펼침 (49cm)", stoveHeight: 49, recommendedPipeSystem: "ti_nested_70_76", pid: "p_lumora_ti",
      includedPipes: 11, includedRings: 1, isRollPipe: false,
      compatDia: "티타늄 Ø70-76mm (각 300mm · 마디 겹침 30mm · 결합 총 3,000mm)",
      includedSummary: "티타늄 3.0m 기본세트 총 11본 (Ø70 직관 5 + Ø70-76 레듀셔 1 + Ø76 직관 4 + Ø76 최상단 불티캡 1)",
      optionsNote: "옵션/호환: 티타늄 70·76파이 단품 연통 · 티타늄 70파이 엘보 · 스텐 메쉬 보호망(Ø60~90mm)"
    },
    {
      id: "dweller_ti3", mat: "titanium", name: "[티타늄] 포몰리 드웰러 맥스 티아이 3 다리펼침 (49cm)", stoveHeight: 49, recommendedPipeSystem: "ti_nested_70_76", pid: "p_dweller_ti3",
      includedPipes: 11, includedRings: 1, isRollPipe: false,
      compatDia: "티타늄 Ø70-76mm (각 300mm · 마디 겹침 30mm · 결합 총 3,000mm)",
      includedSummary: "티타늄 3.0m 기본세트 총 11본 (Ø70 직관 5 + Ø70-76 레듀셔 1 + Ø76 직관 4 + Ø76 최상단 불티캡 1)",
      optionsNote: "옵션/호환: 포몰리 드웰러 철재 스탠드 · 티타늄 70·76파이 단품 · 티타늄 70파이 엘보 · 스텐 메쉬 보호망(Ø60~90mm)"
    },
    {
      id: "pomoly_xti5", mat: "titanium", name: "[티타늄] 포몰리 엑스-티아이 5 / X-Ti 5 (35cm)", stoveHeight: 35, recommendedPipeSystem: "ti_nested_70_76", pid: "p_pomoly_xti5",
      includedPipes: 10, includedRings: 1, isRollPipe: true,
      compatDia: "티타늄 Ø70mm (롤타입 3m 기본 포함 · 원통형 70파이 티타늄 연통 호환)",
      includedSummary: "티타늄 Ø70mm 롤타입 연통 3m + 댐퍼 베이스 + 불티방지캡 + 고정 클립 3개",
      optionsNote: "별매 옵션: 티타늄 랜턴 스탠드 · 티타늄 측면 선반 · 원통형 70파이 티타늄 연통·엘보 호환"
    }
  ];

  const TENT_MODELS = [
    { id: "helsport_valhall", origin: "해외", brand: "헬스포츠", name: "발할 (Valhall)", shape: "tunnel", w: 300, l: 780, peakHeight: 210, sw: 135, defaultJackHeight: 180, defaultPath: "straight" },
    { id: "helsport_varanger_8_10", origin: "해외", brand: "헬스포츠", name: "바랑에르 돔 8-10", shape: "dome", w: 435, l: 470, peakHeight: 210, sw: 115, defaultJackHeight: 175, defaultPath: "straight" },
    { id: "minimalworks_shelter_g", origin: "국내", brand: "미니멀웍스", name: "쉘터 G / GH", shape: "dome", w: 300, l: 350, peakHeight: 170, sw: 88, defaultJackHeight: 135, defaultPath: "elbow45" },
    { id: "minimalworks_shelter_ghe", origin: "국내", brand: "미니멀웍스", name: "쉘터 GHE (TC면)", shape: "dome", w: 380, l: 400, peakHeight: 185, sw: 98, defaultJackHeight: 145, defaultPath: "elbow45" },
    { id: "minimalworks_jack_shelter_plus", origin: "국내", brand: "미니멀웍스", name: "잭 쉘터 플러스", shape: "cabin", w: 300, l: 300, peakHeight: 190, sw: 125, defaultJackHeight: 150, defaultPath: "straight" },
    { id: "minimalworks_vhouse_m", origin: "국내", brand: "미니멀웍스", name: "브이하우스 M", shape: "tunnel", w: 305, l: 540, peakHeight: 190, sw: 120, defaultJackHeight: 140, defaultPath: "elbow90" },
    { id: "minimalworks_vhouse_l", origin: "국내", brand: "미니멀웍스", name: "브이하우스 L", shape: "tunnel", w: 305, l: 700, peakHeight: 205, sw: 130, defaultJackHeight: 150, defaultPath: "elbow90" },
    { id: "backcountry_orison", origin: "국내", brand: "백컨트리", name: "오리손 얼티메이트", shape: "dome", w: 310, l: 320, peakHeight: 190, sw: 95, defaultJackHeight: 155, defaultPath: "straight" },
    { id: "backcountry_280", origin: "국내", brand: "백컨트리", name: "280 쉘터 얼티메이트", shape: "dome", w: 280, l: 280, peakHeight: 190, sw: 95, defaultJackHeight: 155, defaultPath: "straight" },
    { id: "coody_13_6", origin: "국내", brand: "쿠디", name: "에어텐트 13.6", shape: "cabin", w: 360, l: 380, peakHeight: 220, sw: 140, defaultJackHeight: 165, defaultPath: "straight" },
    { id: "coody_familia_17_2", origin: "국내", brand: "쿠디", name: "파밀리아 17.2", shape: "cabin", w: 360, l: 480, peakHeight: 220, sw: 145, defaultJackHeight: 165, defaultPath: "straight" },
    { id: "northpeak_a7_ex", origin: "국내", brand: "노스피크", name: "A7 EX 플러스 에어텐트", shape: "tunnel", w: 380, l: 610, peakHeight: 215, sw: 150, defaultJackHeight: 150, defaultPath: "elbow90" },
    { id: "northpeak_pacific_ocean_ex", origin: "국내", brand: "노스피크", name: "퍼시픽오션 EX", shape: "tunnel", w: 420, l: 630, peakHeight: 215, sw: 155, defaultJackHeight: 150, defaultPath: "elbow90" },
    { id: "kzm_attica_x", origin: "국내", brand: "카즈미", name: "아티카 X", shape: "tunnel", w: 375, l: 620, peakHeight: 210, sw: 148, defaultJackHeight: 148, defaultPath: "elbow90" },
    { id: "kzm_vivadome_plus", origin: "국내", brand: "카즈미", name: "비바돔 쉘터 플러스", shape: "dome", w: 360, l: 360, peakHeight: 195, sw: 105, defaultJackHeight: 150, defaultPath: "elbow45" },
    { id: "kovea_ghost_plus", origin: "국내", brand: "코베아", name: "고스트 플러스", shape: "tunnel", w: 315, l: 630, peakHeight: 205, sw: 140, defaultJackHeight: 145, defaultPath: "elbow90" },
    { id: "kovea_nest_w", origin: "국내", brand: "코베아", name: "네스트 W", shape: "tunnel", w: 330, l: 620, peakHeight: 210, sw: 145, defaultJackHeight: 145, defaultPath: "elbow90" },
    { id: "zed_tmax_ex", origin: "국내", brand: "제드", name: "티맥스 EX", shape: "tunnel", w: 400, l: 680, peakHeight: 225, sw: 160, defaultJackHeight: 155, defaultPath: "elbow90" },
    { id: "snowline_miracle_family", origin: "국내", brand: "스노우라인", name: "미라클 패밀리", shape: "tunnel", w: 320, l: 575, peakHeight: 200, sw: 138, defaultJackHeight: 140, defaultPath: "elbow90" },
    { id: "jeep_grand_sylvester", origin: "국내", brand: "지프", name: "그랜드 실베스터", shape: "tunnel", w: 370, l: 670, peakHeight: 220, sw: 155, defaultJackHeight: 155, defaultPath: "elbow90" },
    { id: "durango_r2", origin: "국내", brand: "듀랑고", name: "R2 코튼 면텐트", shape: "cabin", w: 300, l: 420, peakHeight: 200, sw: 135, defaultJackHeight: 145, defaultPath: "elbow90" },
    { id: "idoogen_vantagon_max", origin: "국내", brand: "아이두젠", name: "반타곤 MAX", shape: "dome", w: 300, l: 370, peakHeight: 220, sw: 125, defaultJackHeight: 160, defaultPath: "elbow45" },
    { id: "idoogen_octagon_max", origin: "국내", brand: "아이두젠", name: "옥타곤 MAX", shape: "dome", w: 305, l: 360, peakHeight: 218, sw: 122, defaultJackHeight: 160, defaultPath: "elbow45" },
    { id: "polaris_dx4", origin: "국내", brand: "폴라리스", name: "DX4 대형 쉘터", shape: "dome", w: 400, l: 400, peakHeight: 233, sw: 135, defaultJackHeight: 175, defaultPath: "elbow45" },
    { id: "snowpeak_landlock", origin: "해외", brand: "스노우피크", name: "랜드락 (TP-671R)", shape: "tunnel", w: 405, l: 625, peakHeight: 205, sw: 145, defaultJackHeight: 145, defaultPath: "elbow90" },
    { id: "coleman_cocoon3", origin: "해외", brand: "콜맨", name: "와이드 2룸 코쿤 3", shape: "tunnel", w: 400, l: 670, peakHeight: 220, sw: 158, defaultJackHeight: 155, defaultPath: "elbow90" },
    { id: "nordisk_asgard_12_6", origin: "해외", brand: "노르디스크", name: "아스가르드 12.6", shape: "cabin", w: 375, l: 400, peakHeight: 250, sw: 75, defaultJackHeight: 175, defaultPath: "elbow45" },
    { id: "nordisk_alfheim_12_6", origin: "해외", brand: "노르디스크", name: "알페임 12.6", shape: "tipi", w: 400, l: 400, peakHeight: 275, sw: 0, defaultJackHeight: 190, defaultPath: "elbow45" },
    { id: "hilleberg_atlas", origin: "해외", brand: "힐레베르그", name: "아틀라스", shape: "dome", w: 420, l: 435, peakHeight: 200, sw: 110, defaultJackHeight: 160, defaultPath: "elbow45" },
    { id: "naturehike_village_13", origin: "해외", brand: "네이처하이크", name: "빌리지 13", shape: "cabin", w: 270, l: 395, peakHeight: 183, sw: 145, defaultJackHeight: 135, defaultPath: "elbow90" },
    { id: "dod_kamaboko_3m", origin: "해외", brand: "DOD", name: "가마보코 3M", shape: "tunnel", w: 300, l: 640, peakHeight: 195, sw: 130, defaultJackHeight: 140, defaultPath: "elbow90" },
    { id: "dod_kamaboko_3l", origin: "해외", brand: "DOD", name: "가마보코 3L", shape: "tunnel", w: 380, l: 760, peakHeight: 218, sw: 152, defaultJackHeight: 155, defaultPath: "elbow90" },
    { id: "onetigris_solo_homestead_tc", origin: "해외", brand: "원티그리스", name: "솔로 홈스테드 TC", shape: "cabin", w: 240, l: 400, peakHeight: 160, sw: 100, defaultJackHeight: 125, defaultPath: "straight" },
    { id: "naturehike_wormhole_6", origin: "해외", brand: "네이처하이크", name: "웜홀 6인용 에어텐트", shape: "tunnel", w: 315, l: 490, peakHeight: 200, sw: 138, defaultJackHeight: 145, defaultPath: "elbow90" },
    { id: "naturehike_wormhole_10", origin: "해외", brand: "네이처하이크", name: "웜홀 10인용 에어텐트", shape: "tunnel", w: 315, l: 730, peakHeight: 210, sw: 145, defaultJackHeight: 150, defaultPath: "elbow90" },
    { id: "naturehike_dune_10_9", origin: "해외", brand: "네이처하이크", name: "듄 10.9 캐노피 텐트", shape: "tunnel", w: 260, l: 420, peakHeight: 200, sw: 135, defaultJackHeight: 145, defaultPath: "elbow90" }
  ];

  const EXTRA_TENT_CATALOG = [
    { id: "ext_pomoly_dome_x4", brand: "포몰리", name: "Dome X4 (독립형 돔 핫텐트)", aliases: "pomoly dome x4 돔x4", shape: "dome", w: 320, l: 320, h: 165, jh: 120, path: "straight" },
    { id: "ext_pomoly_dome_x4_pro", brand: "포몰리", name: "Dome X4 Pro", aliases: "pomoly dome x4 pro 돔x4 프로", shape: "dome", w: 320, l: 320, h: 165, jh: 120, path: "straight" },
    { id: "ext_pomoly_dome_x6", brand: "포몰리", name: "Dome X6 Pro", aliases: "pomoly dome x6 pro 돔x6", shape: "dome", w: 400, l: 400, h: 200, jh: 150, path: "straight" },
    { id: "ext_sabbatical_mg", brand: "사바티컬", name: "모닝글로리 TC", aliases: "sabbatical morning glory 모닝글로리", shape: "tipi", w: 440, l: 470, h: 270, jh: 185, path: "straight" },
    { id: "ext_sabbatical_arnica", brand: "사바티컬", name: "아르니카", aliases: "sabbatical arnica 아르니카", shape: "tunnel", w: 320, l: 620, h: 210, jh: 150, path: "elbow90" },
    { id: "ext_zanearts_lolo", brand: "제인아트", name: "로로 (LOLO)", aliases: "zanearts lolo 로로", shape: "tipi", w: 440, l: 520, h: 285, jh: 195, path: "straight" },
    { id: "ext_robens_klondike", brand: "로벤스", name: "클론다이크 (6인용)", aliases: "robens klondike 클론다이크", shape: "cabin", w: 390, l: 370, h: 270, jh: 190, path: "straight" },
    { id: "ext_wiwo_yak460", brand: "위오", name: "야크돔 460", aliases: "wiwo yakdome 460 야크돔460", shape: "dome", w: 460, l: 440, h: 210, jh: 160, path: "elbow45" },
    { id: "ext_nordisk_reisa6", brand: "노르디스크", name: "레이사 6", aliases: "nordisk reisa6 레이사6", shape: "tunnel", w: 295, l: 645, h: 210, jh: 150, path: "elbow90" },
    { id: "ext_tentmark_circus", brand: "텐트마크디자인", name: "서커스 TC DX", aliases: "tentmark circus tc 서커스tc", shape: "tipi", w: 420, l: 442, h: 280, jh: 195, path: "straight" }
  ];

  global.CT_PRO_DATA = {
    STORE_URL,
    SPARK_MIN_CLEARANCE_CM,
    ADMIN_PW_HASH,
    PRODUCTS,
    STOVE_MODELS,
    TENT_MODELS,
    EXTRA_TENT_CATALOG
  };
})(window);