console.log("🔥 지금 실행 중인 파일:", __filename);

require("dotenv").config({ path: ".env" });

const express = require("express");
const path = require("path");
const mysql = require("mysql2/promise");
const { randomUUID } = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const ORS_API_KEY = process.env.ORS_API_KEY;

app.use(express.json());

app.use((req, res, next) => {
  console.log("요청 들어옴:", req.method, req.url);
  next();
});

app.use(express.static(__dirname));

const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

function uuidToBuffer(uuid) {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/index.html", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ================= 테스트 API =================

app.get("/api/test", (req, res) => {
  res.json({
    ok: true,
    message: "API 연결 성공!",
  });
});

// ================= 테스트 사용자 생성 API =================

app.post("/api/test-users", async (req, res) => {
  try {
    const { email, nickname, provider, providerUserId } = req.body;

    if (!email || !provider || !providerUserId) {
      return res.status(400).json({
        ok: false,
        error: "email, provider, providerUserId가 필요합니다.",
      });
    }

    const userId = randomUUID();

    await db.execute(
      `
      INSERT INTO users (id, email, nickname)
      VALUES (?, ?, ?)
      `,
      [uuidToBuffer(userId), email, nickname || null]
    );

    await db.execute(
      `
      INSERT INTO user_auth_providers
        (user_id, provider, provider_user_id, provider_email)
      VALUES (?, ?, ?, ?)
      `,
      [uuidToBuffer(userId), provider, providerUserId, email]
    );

    res.json({
      ok: true,
      user: {
        id: userId,
        email,
        nickname,
        provider,
      },
    });
  } catch (error) {
    console.error("사용자 생성 실패:", error);

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// ================= ORS 경로 API =================

app.get("/api/walking-route", async (req, res) => {
  try {
    const origin = {
      x: req.query.ox,
      y: req.query.oy,
    };

    const destination = {
      x: req.query.dx,
      y: req.query.dy,
    };

    if (!origin.x || !origin.y || !destination.x || !destination.y) {
      return res.status(400).json({
        ok: false,
        error: "ox, oy, dx, dy 값이 필요합니다.",
      });
    }

    const routeData = await fetchWalkingRouteFromORS(origin, destination);
    const coords = routeData.features[0].geometry.coordinates;

    const routePath = coords.map(([lng, lat]) => ({
      lat,
      lng,
    }));

    let hitZones = [];

    try {
      const rawReports = await fetchDangerReportsFromMapService();
      const dangerZones = normalizeDangerZones(rawReports);
      hitZones = findDangerZonesOnRoute(routePath, dangerZones);
    } catch (err) {
      console.warn("MapService 생략:", err.message);
    }

    res.json({
      ok: true,
      summary: {
        distance: routeData.features[0].properties.summary.distance,
        duration: routeData.features[0].properties.summary.duration,
      },
      path: routePath,
      dangerZones: hitZones,
      dangerCount: hitZones.length,
    });
  } catch (err) {
    console.error("ORS 경로 오류:", err);

    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

async function fetchWalkingRouteFromORS(origin, destination) {
  if (!ORS_API_KEY) {
    throw new Error("ORS_API_KEY가 .env에 설정되지 않았습니다.");
  }

  const response = await fetch(
    "https://api.openrouteservice.org/v2/directions/foot-walking/geojson",
    {
      method: "POST",
      headers: {
        Authorization: ORS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        coordinates: [
          [Number(origin.x), Number(origin.y)],
          [Number(destination.x), Number(destination.y)],
        ],
      }),
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(text);
  }

  return JSON.parse(text);
}

// ================= 배리어프리 키오스크 API =================

app.get("/api/barrier-free-kiosks", async (req, res) => {
  try {
    const apiUrl = process.env.KIOSK_API_URL;
    const apiKey = process.env.KIOSK_API_KEY;

    if (!apiUrl || !apiKey) {
      return res.status(500).json({
        ok: false,
        error: "KIOSK_API_URL 또는 KIOSK_API_KEY가 .env에 설정되지 않았습니다.",
      });
    }

    const url = new URL(apiUrl);
    url.searchParams.set("query", req.query.query || "서울특별시");
    url.searchParams.set("keyword", req.query.keyword || "");
    url.searchParams.set("page", req.query.page || "1");
    url.searchParams.set("size", req.query.size || "100");

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json;charset=UTF-8",
      },
    });

    const text = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: text,
      });
    }

    const raw = JSON.parse(text);

    res.json({
      ok: true,
      totalCount: raw.kioskTotalCount || 0,
      items: normalizeKioskItems(raw.kioskList || []),
    });
  } catch (error) {
    console.error("배리어프리 키오스크 API 오류:", error);

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

function normalizeKioskItems(list) {
  return list
    .map((item) => ({
      name: item.kioskName || "배리어프리 키오스크",
      locationName: item.locationName || "",
      categoryMain: item.categoryMain || item.catergoryMain || "",
      categorySub: item.categorySub || "",
      address: item.roadFullAddr || "",
      lng: Number(item.xLong),
      lat: Number(item.yLat),
      accessType: item.accessType || "",
      raw: item,
    }))
    .filter((item) => !Number.isNaN(item.lat) && !Number.isNaN(item.lng));
}

// ================= 택시 승강장 API =================

app.get("/api/taxi-stands", async (req, res) => {
  try {
    const apiUrl = process.env.TAXI_STAND_API_URL;
    const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY;

    if (!apiUrl || !serviceKey) {
      return res.status(500).json({
        ok: false,
        error: "TAXI_STAND_API_URL 또는 DATA_GO_KR_SERVICE_KEY가 .env에 없습니다.",
      });
    }

    const url = new URL(apiUrl);
    url.searchParams.set("serviceKey", serviceKey);
    url.searchParams.set("pageNo", req.query.pageNo || "1");
    url.searchParams.set("numOfRows", req.query.numOfRows || "100");
    url.searchParams.set("type", "json");

    if (req.query.ctpv) {
      url.searchParams.set("CTPV_NM", req.query.ctpv);
    }

    if (req.query.sgg) {
      url.searchParams.set("SGG_NM", req.query.sgg);
    }

    const response = await fetch(url);
    const text = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: text,
      });
    }

    const raw = JSON.parse(text);
    const items = raw.response?.body?.items?.item || [];

    res.json({
      ok: true,
      totalCount: raw.response?.body?.totalCount || 0,
      items: normalizeTaxiStandItems(Array.isArray(items) ? items : [items]),
    });
  } catch (error) {
    console.error("택시 승강장 API 오류:", error);

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

function normalizeTaxiStandItems(items) {
  return items.map((item) => ({
    id: item.MNG_NO || "",
    name: item.DTL_PSTN || "택시 승강장",
    sido: item.CTPV_NM || "",
    sigungu: item.SGG_NM || "",
    roadAddress: item.LCTN_ROAD_NM_ADDR || "",
    lotAddress: item.LCTN_LOTNO_ADDR || "",
    parkingCount: item.TAX_EXCLS_SCPLC_CNT || "",
    date: item.DATA_CRTR_YMD || "",
    raw: item,
  }));
}

// ================= 위험구간 옵션 기능 =================

const MAPSERVICE_BASE_URL =
  process.env.MAPSERVICE_BASE_URL || "http://localhost:8080";

const MAPSERVICE_REPORTS_ENDPOINT =
  process.env.MAPSERVICE_REPORTS_ENDPOINT || "/api/reports";

async function fetchDangerReportsFromMapService() {
  const url = `${MAPSERVICE_BASE_URL}${MAPSERVICE_REPORTS_ENDPOINT}`;

  try {
    const response = await fetch(url);
    if (!response.ok) return [];

    const data = await response.json();
    return Array.isArray(data) ? data : data.data || [];
  } catch {
    return [];
  }
}

function normalizeDangerZones(rawReports) {
  return rawReports
    .map((r) => ({
      lat: Number(r.latitude ?? r.lat),
      lng: Number(r.longitude ?? r.lng),
      radius: 25,
    }))
    .filter((z) => !Number.isNaN(z.lat) && !Number.isNaN(z.lng));
}

function findDangerZonesOnRoute(routePath, zones) {
  return zones.filter((zone) =>
    routePath.some(
      (p) => getDistance(p.lat, p.lng, zone.lat, zone.lng) <= zone.radius
    )
  );
}

function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// ================= 정적 파일 제공 =================
// API 라우트들을 먼저 등록한 뒤 HTML/CSS/JS 파일을 제공함

app.use(express.static(__dirname));

// ================= API 404 처리 =================
// API 주소가 잘못됐을 때 HTML 대신 JSON으로 응답

app.use("/api", (req, res) => {
  res.status(404).json({
    ok: false,
    error: `API 라우트를 찾을 수 없습니다: ${req.method} ${req.originalUrl}`,
  });
});

// ================= 서버 실행 =================

app.listen(PORT, () => {
  console.log("=== 새 서버 실행 성공 ===");
  console.log(`AccessNav backend running on http://localhost:${PORT}`);
  console.log("등록 확인: GET  /api/test");
  console.log("등록 확인: POST /api/test-users");
});