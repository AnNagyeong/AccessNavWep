console.log("🔥 지금 실행 중인 파일:", __filename);

require("dotenv").config({ path: ".env" });

const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const mysql = require("mysql2/promise");
const { randomUUID } = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_NEARBY_ROUTE_TARGET_DISTANCE = 150;
const DATA_DIR = path.join(__dirname, "data");
const ACCESSIBILITY_REPORTS_FILE = path.join(DATA_DIR, "accessibility-reports.json");
const PLACE_ACCESSIBILITY_FILE = path.join(DATA_DIR, "place-accessibility.json");
const MAPSERVICE_PROJECT_DIR =
  process.env.MAPSERVICE_PROJECT_DIR || "C:/MapService-main/MapService";
const MAPSERVICE_ADMIN_DIR = path.join(MAPSERVICE_PROJECT_DIR, "Test", "graphManager2");
const MAPSERVICE_IMAGES_DIR = path.join(MAPSERVICE_PROJECT_DIR, "Test", "images");
const KAKAO_MAP_JS_KEY =
  process.env.KAKAO_MAP_KEY ||
  process.env.KAKAO_JAVASCRIPT_KEY ||
  "80e48dd01aae3f043d16e5ad41071f5d";

const ORS_API_KEY = process.env.ORS_API_KEY;
const GOOGLE_PLACES_API_KEY =
  process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const googlePhotoCache = new Map();

app.use(express.json({ limit: "8mb" }));

app.use((req, res, next) => {
  console.log("요청 들어옴:", req.method, req.url);
  next();
});

app.use(express.static(__dirname));

const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || process.env.DB_PASS,
  database: process.env.DB_NAME,
});

const mapServiceDb = mysql.createPool({
  host: process.env.MAPSERVICE_DB_HOST || process.env.DB_HOST,
  port: Number(process.env.MAPSERVICE_DB_PORT || process.env.DB_PORT || 3306),
  user: process.env.MAPSERVICE_DB_USER || process.env.DB_USER,
  password:
    process.env.MAPSERVICE_DB_PASSWORD ||
    process.env.MAPSERVICE_DB_PASS ||
    process.env.DB_PASSWORD ||
    process.env.DB_PASS,
  database: process.env.MAPSERVICE_DB_NAME || "barrier_free_db",
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

app.use("/map-admin", express.static(MAPSERVICE_ADMIN_DIR));
app.use("/images", express.static(MAPSERVICE_IMAGES_DIR));
app.use("/panoramas", express.static(path.join(MAPSERVICE_PROJECT_DIR, "Test", "panoramas")));

app.get("/admin", async (req, res) => {
  try {
    let html = await fs.readFile(
      path.join(MAPSERVICE_ADMIN_DIR, "graphManager2.html"),
      "utf-8"
    );

    html = html
      .replace(/href="graphManager2\.css"/g, 'href="/map-admin/graphManager2.css"')
      .replace(/src="graphManager2\.js"/g, 'src="/map-admin/graphManager2.js"')
      .replace(/src="adminPanel\.js"/g, 'src="/map-admin/adminPanel.js"')
      .replace(/__KAKAO_KEY__/g, KAKAO_MAP_JS_KEY);

    res.type("html").send(html);
  } catch (error) {
    res.status(500).send(`Admin page load failed: ${error.message}`);
  }
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

app.get("/api/weather", async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({
        ok: false,
        error: "lat, lng 값이 필요합니다.",
      });
    }

    const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
    weatherUrl.searchParams.set("latitude", String(lat));
    weatherUrl.searchParams.set("longitude", String(lng));
    weatherUrl.searchParams.set(
      "current",
      [
        "temperature_2m",
        "apparent_temperature",
        "precipitation",
        "rain",
        "snowfall",
        "weather_code",
        "wind_speed_10m",
      ].join(",")
    );
    weatherUrl.searchParams.set(
      "daily",
      [
        "temperature_2m_max",
        "temperature_2m_min",
        "precipitation_probability_max",
        "precipitation_sum",
      ].join(",")
    );
    weatherUrl.searchParams.set("forecast_days", "1");
    weatherUrl.searchParams.set("timezone", "auto");

    const response = await fetch(weatherUrl);
    const text = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: text,
      });
    }

    const data = JSON.parse(text);
    const current = data.current || {};
    const daily = data.daily || {};
    const code = Number(current.weather_code);

    res.json({
      ok: true,
      weather: {
        temperature: roundWeatherValue(current.temperature_2m),
        apparentTemperature: roundWeatherValue(current.apparent_temperature),
        windSpeed: roundWeatherValue(current.wind_speed_10m),
        precipitation: roundWeatherValue(current.precipitation),
        rain: roundWeatherValue(current.rain),
        snowfall: roundWeatherValue(current.snowfall),
        precipitationProbability: daily.precipitation_probability_max?.[0] ?? null,
        temperatureMax: roundWeatherValue(daily.temperature_2m_max?.[0]),
        temperatureMin: roundWeatherValue(daily.temperature_2m_min?.[0]),
        code,
        label: weatherCodeLabel(code),
        icon: weatherCodeIcon(code),
        time: current.time || null,
      },
    });
  } catch (err) {
    console.error("Open-Meteo weather error:", err);
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

async function buildOrsAccessRoute(startName, destinationName, startPoint, destinationPoint) {
  const routeData = await fetchWalkingRouteFromORS(
    { x: startPoint.lng, y: startPoint.lat },
    { x: destinationPoint.lng, y: destinationPoint.lat }
  );
  const feature = routeData.features?.[0];
  const coords = feature?.geometry?.coordinates || [];
  const summary = feature?.properties?.summary || {};
  const routePath = coords.map(([lng, lat], index) => ({
    id: `ors-${index}`,
    name:
      index === 0
        ? startName || "출발지"
        : index === coords.length - 1
          ? destinationName || "목적지"
          : "도보 경로",
    lat,
    lng,
    type: "path",
  }));

  let hitZones = [];

  try {
    const rawReports = await fetchDangerReportsFromMapService();
    const dangerZones = normalizeDangerZones(rawReports);
    hitZones = findDangerZonesOnRoute(routePath, dangerZones);
  } catch (err) {
    console.warn("MapService 위험 구간 조회 실패:", err.message);
  }

  const dangerPath = routePath.map((point) => ({
    ...point,
    type: hitZones.some(
      (zone) => getDistance(point.lat, point.lng, zone.lat, zone.lng) <= zone.radius
    )
      ? "danger"
      : point.type,
  }));

  return {
    ok: true,
    start: {
      id: "ors-start",
      name: startName || "출발지",
      lat: startPoint.lat,
      lng: startPoint.lng,
    },
    destination: {
      id: "ors-destination",
      name: destinationName || "목적지",
      lat: destinationPoint.lat,
      lng: destinationPoint.lng,
    },
    routes: [
      {
        id: "walking",
        title: "도보 경로",
        distance: Math.round(Number(summary.distance || 0)),
        duration: Math.max(1, Math.ceil(Number(summary.duration || 0) / 60)),
        dangerCount: hitZones.length,
        dangerZones: hitZones,
        features: {
          stairs: 0,
          ramps: 0,
          elevators: 0,
          crosswalks: 0,
        },
        path: dangerPath,
      },
    ],
  };
}


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

const MAPSERVICE_ACCESSIBILITY_REPORTS_ENDPOINT =
  process.env.MAPSERVICE_ACCESSIBILITY_REPORTS_ENDPOINT || "";

const MAPSERVICE_PLACE_ACCESSIBILITY_ENDPOINT =
  process.env.MAPSERVICE_PLACE_ACCESSIBILITY_ENDPOINT || "";

async function handlePlacePhoto(req, res) {
  try {
    if (!GOOGLE_PLACES_API_KEY) {
      return res.status(501).json({
        ok: false,
        error: "GOOGLE_PLACES_API_KEY is not configured.",
      });
    }

    const name = String(req.query.name || "").trim();
    const address = String(req.query.address || "").trim();
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const maxWidthPx = clampNumber(req.query.maxWidthPx, 160, 800, 360);

    if (!name) {
      return res.status(400).json({
        ok: false,
        error: "name is required.",
      });
    }

    const cacheKey = [
      name,
      address,
      Number.isNaN(lat) ? "" : lat.toFixed(5),
      Number.isNaN(lng) ? "" : lng.toFixed(5),
      maxWidthPx,
    ].join("|");

    if (googlePhotoCache.has(cacheKey)) {
      return res.json(googlePhotoCache.get(cacheKey));
    }

    const textQuery = [name, address].filter(Boolean).join(" ");
    const searchBody = {
      textQuery,
      languageCode: "ko",
      maxResultCount: 1,
    };

    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      searchBody.locationBias = {
        circle: {
          center: {
            latitude: lat,
            longitude: lng,
          },
          radius: 120,
        },
      };
    }

    const searchResponse = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.photos,places.formattedAddress",
        },
        body: JSON.stringify(searchBody),
      }
    );
    const searchText = await searchResponse.text();

    if (!searchResponse.ok) {
      return res.status(searchResponse.status).json({
        ok: false,
        error: searchText,
      });
    }

    const searchData = JSON.parse(searchText);
    const place = searchData.places?.[0];
    const photo = place?.photos?.[0];

    if (!photo?.name) {
      const emptyResult = { ok: true, photoUri: null, attributions: [] };
      googlePhotoCache.set(cacheKey, emptyResult);
      return res.json(emptyResult);
    }

    const photoUrl = new URL(
      `https://places.googleapis.com/v1/${photo.name}/media`
    );
    photoUrl.searchParams.set("maxWidthPx", String(maxWidthPx));
    photoUrl.searchParams.set("skipHttpRedirect", "true");
    photoUrl.searchParams.set("key", GOOGLE_PLACES_API_KEY);

    const photoResponse = await fetch(photoUrl);
    const photoText = await photoResponse.text();

    if (!photoResponse.ok) {
      return res.status(photoResponse.status).json({
        ok: false,
        error: photoText,
      });
    }

    const photoData = JSON.parse(photoText);
    const result = {
      ok: true,
      photoUri: photoData.photoUri || null,
      attributions: photo.authorAttributions || [],
      place: {
        id: place.id,
        name: place.displayName?.text || name,
        address: place.formattedAddress || address,
      },
    };

    googlePhotoCache.set(cacheKey, result);
    return res.json(result);
  } catch (error) {
    console.error("Google place photo error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function roundWeatherValue(value) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return null;
  return Math.round(parsed * 10) / 10;
}

function weatherCodeLabel(code) {
  if (code === 0) return "맑음";
  if ([1, 2].includes(code)) return "구름 조금";
  if (code === 3) return "흐림";
  if ([45, 48].includes(code)) return "안개";
  if ([51, 53, 55, 56, 57].includes(code)) return "이슬비";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "비";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "눈";
  if ([95, 96, 99].includes(code)) return "뇌우";
  return "날씨";
}

function weatherCodeIcon(code) {
  if (code === 0) return "맑음";
  if ([1, 2, 3].includes(code)) return "구름";
  if ([45, 48].includes(code)) return "안개";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
    return "비";
  }
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "눈";
  if ([95, 96, 99].includes(code)) return "번개";
  return "날씨";
}

async function readJsonFile(filePath, fallback) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonFile(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

function normalizePlaceKeyPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function placeKeyFromPayload(payload = {}) {
  const name = normalizePlaceKeyPart(payload.placeName || payload.name);
  const address = normalizePlaceKeyPart(payload.address);

  if (name || address) {
    return `${name}|${address}`;
  }

  const lat = Number(payload.y ?? payload.lat);
  const lng = Number(payload.x ?? payload.lng);
  if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
    return `coord:${lat.toFixed(5)},${lng.toFixed(5)}`;
  }

  return "";
}

function accessibilityLabelFromStatus(status) {
  if (status === "accessible") return "휠체어 진입 가능";
  if (status === "not_accessible") return "휠체어 진입 어려움";
  return "휠체어 진입 정보 확인 필요";
}

function normalizeAccessibilityStatus(status) {
  const value = String(status || "").trim();
  if (["accessible", "not_accessible", "unknown"].includes(value)) return value;
  return "unknown";
}

function mapServiceUrl(endpoint) {
  if (!endpoint) return null;
  return new URL(endpoint, MAPSERVICE_BASE_URL).toString();
}

async function fetchMapServiceJson(endpoint, options = {}) {
  const url = mapServiceUrl(endpoint);
  if (!url) return null;

  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.error || data?.message || text || "MapService 요청에 실패했습니다.");
  }

  return data;
}

async function handlePlaceAccessibility(req, res) {
  try {
    const key = placeKeyFromPayload(req.query);
    if (!key) {
      return res.status(400).json({ ok: false, error: "place name or coordinate is required." });
    }

    if (!MAPSERVICE_PLACE_ACCESSIBILITY_ENDPOINT) {
      return res.status(503).json({
        ok: false,
        error: "MapService place accessibility endpoint is not configured.",
      });
    }

    if (MAPSERVICE_PLACE_ACCESSIBILITY_ENDPOINT) {
      const url = new URL(mapServiceUrl(MAPSERVICE_PLACE_ACCESSIBILITY_ENDPOINT));
      url.searchParams.set("name", req.query.name || req.query.placeName || "");
      url.searchParams.set("address", req.query.address || "");
      url.searchParams.set("lat", req.query.lat || req.query.y || "");
      url.searchParams.set("lng", req.query.lng || req.query.x || "");

      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || "MapService 접근성 조회에 실패했습니다.");
      }

      const status = normalizeAccessibilityStatus(data.status || data.wheelchairAccess);
      return res.json({
        ok: true,
        status,
        label: data.label || accessibilityLabelFromStatus(status),
        verified: Boolean(data.verified ?? data.record),
        record: data.record || data,
        source: "mapservice",
      });
    }

    const places = await readJsonFile(PLACE_ACCESSIBILITY_FILE, {});
    const record = places[key] || null;

    return res.json({
      ok: true,
      status: record?.status || "unknown",
      label: accessibilityLabelFromStatus(record?.status),
      verified: Boolean(record),
      record,
      source: "local",
    });
  } catch (error) {
    console.error("Accessibility lookup error:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

async function handleCreateAccessibilityReport(req, res) {
  try {
    const placeName = String(req.body.placeName || req.body.name || "").trim();
    const address = String(req.body.address || "").trim();
    const key = placeKeyFromPayload(req.body);

    if (!key) {
      return res.status(400).json({ ok: false, error: "placeName 또는 위치 정보가 필요합니다." });
    }

    const report = {
      id: randomUUID(),
      placeKey: key,
      placeName,
      address,
      x: req.body.x ?? req.body.lng ?? null,
      y: req.body.y ?? req.body.lat ?? null,
      type: String(req.body.type || "").trim(),
      slope: req.body.slope || "",
      wheelchairAccess: normalizeAccessibilityStatus(req.body.wheelchairAccess),
      detail: String(req.body.detail || "").trim(),
      imageData: typeof req.body.imageData === "string" ? req.body.imageData : "",
      status: "pending",
      createdAt: new Date().toISOString(),
      reviewedAt: null,
    };

    if (!MAPSERVICE_ACCESSIBILITY_REPORTS_ENDPOINT) {
      return res.status(503).json({
        ok: false,
        error: "MapService accessibility reports endpoint is not configured.",
      });
    }

    if (MAPSERVICE_ACCESSIBILITY_REPORTS_ENDPOINT) {
      const data = await fetchMapServiceJson(MAPSERVICE_ACCESSIBILITY_REPORTS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(report),
      });

      return res.status(201).json({
        ok: true,
        report: data?.report || data || report,
        source: "mapservice",
      });
    }

    const reports = await readJsonFile(ACCESSIBILITY_REPORTS_FILE, []);

    reports.unshift(report);
    await writeJsonFile(ACCESSIBILITY_REPORTS_FILE, reports);

    return res.status(201).json({ ok: true, report, source: "local" });
  } catch (error) {
    console.error("Accessibility report create error:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}


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

app.get("/api/access-routes", handleAccessRoutes);
app.get("/api/access-places", handleAccessPlaces);
app.get("/api/place-photo", handlePlacePhoto);
app.get("/api/place-accessibility", handlePlaceAccessibility);
app.post("/api/accessibility-reports", handleCreateAccessibilityReport);

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

async function handleAccessRoutes(req, res) {
  try {
    const startName = req.query.startName || req.query.from || "";
    const destinationName = req.query.name || req.query.to || "";
    const startPoint = toPoint(req.query.startY, req.query.startX);
    const destinationPoint = toPoint(req.query.y, req.query.x);

    const graphData = await loadMapServiceGraph();
    const startTarget = findRouteTarget(graphData, startName, startPoint);
    const destinationTarget = findRouteTarget(
      graphData,
      destinationName,
      destinationPoint
    );

    if (!startTarget || !destinationTarget) {
      if (startPoint && destinationPoint) {
        const orsRoute = await buildOrsAccessRoute(
          startName,
          destinationName,
          startPoint,
          destinationPoint
        );
        return res.json(orsRoute);
      }

      return res.status(404).json({
        ok: false,
        error: "출발지 또는 목적지를 MapService POI 데이터에서 찾을 수 없습니다.",
        candidates: [
          ...graphData.buildings.map((building) => building.name),
          ...graphData.nodes.map((node) => node.name),
        ],
      });
    }
    if (startTarget.id === destinationTarget.id) {
      if (
        startPoint &&
        destinationPoint &&
        getDistance(
          startPoint.lat,
          startPoint.lng,
          destinationPoint.lat,
          destinationPoint.lng
        ) > 15
      ) {
        const orsRoute = await buildOrsAccessRoute(
          startName,
          destinationName,
          startPoint,
          destinationPoint
        );
        return res.json(orsRoute);
      }

      return res.status(400).json({
        ok: false,
        error: "출발지와 목적지가 같습니다.",
      });
    }
    const shortest = findTargetPath(
      startTarget,
      destinationTarget,
      graphData,
      { avoidStairs: false }
    );
    const accessible = findTargetPath(
      startTarget,
      destinationTarget,
      graphData,
      { avoidStairs: true }
    );

    const routes = [
      formatAccessRoute("accessible", "추천 경로", accessible, graphData),
      formatAccessRoute("shortest", "최단 경로", shortest, graphData),
    ].filter(Boolean);

    if (!routes.length) {
      return res.status(404).json({
        ok: false,
        error: "사용 가능한 경로가 없습니다.",
      });
    }

    res.json({
      ok: true,
      start: summarizeRouteTarget(startTarget, graphData),
      destination: summarizeRouteTarget(destinationTarget, graphData),
      routes,
    });
  } catch (error) {
    console.error("Access route error:", error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}

async function handleAccessPlaces(req, res) {
  try {
    const query = normalizePlaceName(req.query.query || "");
    if (!query) {
      return res.json({ ok: true, items: [] });
    }

    const graphData = await loadMapServiceGraph();
    const items = [
      ...graphData.buildings.map((building) => ({
        id: building.id,
        place_name: building.name,
        address_name: "MapService 건물",
        road_address_name: "",
        x: building.lng,
        y: building.lat,
        source: "mapservice",
      })),
      ...graphData.nodes.map((node) => ({
        id: node.id,
        place_name: node.name,
        address_name: `MapService POI · ${node.type}`,
        road_address_name: "",
        x: node.lng,
        y: node.lat,
        source: "mapservice",
      })),
    ]
      .filter((item) => {
        return placeMatchesQuery(item, query);
      })
      .sort((a, b) => placeSearchScore(b, query) - placeSearchScore(a, query));

    res.json({
      ok: true,
      items: items.slice(0, 20),
    });
  } catch (error) {
    console.error("Access places error:", error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}

function placeSearchScore(item, query) {
  const names = searchNamesForPlace(item);
  let score = 0;

  if (names.some((name) => name === query)) score += 100;
  if (names.some((name) => name.startsWith(query))) score += 50;
  if (String(item.id).startsWith("virtual-building:") && names.some((name) => name === query)) {
    score += 40;
  }
  if (item.source === "mapservice" && !String(item.id).startsWith("virtual-building:")) {
    score += 20;
  }
  if (names.some((name) => name.includes(query))) score += 10;

  return score;
}

function placeMatchesQuery(item, query) {
  return searchNamesForPlace(item).some(
    (name) =>
      name.includes(query) || (!isGenericEntranceQuery(name) && query.includes(name))
  );
}

function isGenericEntranceQuery(value) {
  return ["정문", "쪽문", "후문", "입구", "출입구"].includes(
    String(value || "")
  );
}

function searchNamesForPlace(item) {
  const rawName = String(item.place_name || "");
  const baseName = rawName.split("_")[0];
  const names = new Set([
    normalizePlaceName(rawName),
    normalizePlaceName(baseName),
  ]);

  if (item.address_name?.includes("entrance") || /정문|쪽문|입구|출입구/.test(rawName)) {
    names.add(normalizePlaceName(`${baseName} 입구`));
    names.add(normalizePlaceName(`${baseName} 출입구`));
    names.add(normalizePlaceName(`한양여자대학교 ${baseName} 입구`));
    names.add(normalizePlaceName(`한양여대 ${baseName} 입구`));
  }

  return [...names].filter(Boolean);
}

async function loadMapServiceGraph() {
  const [nodes] = await mapServiceDb.execute(
    `
    SELECT poi_id as id, poi_name as name,
      latitude as lat, longitude as lng, poi_type as type
    FROM poi
    WHERE poi_type != 'building'
    `
  );

  const [buildingRows] = await mapServiceDb.execute(
    `
    SELECT p.poi_id as id, p.poi_name as name,
      p.latitude as lat, p.longitude as lng, p.poi_type as type,
      be.entrance_poi_id
    FROM poi p
    JOIN building_entrance be
      ON p.poi_id COLLATE utf8mb4_unicode_ci = be.building_poi_id
    WHERE p.poi_type = 'building'
    `
  );

  const [edges] = await mapServiceDb.execute(
    `
    SELECT start_poi_id as \`from\`, end_poi_id as \`to\`,
      distance as weight
    FROM path_connection
    `
  );

  const parsedNodes = nodes.map(parsePoiRow);
  const nodeMap = Object.fromEntries(parsedNodes.map((node) => [node.id, node]));
  const buildingMap = {};

  buildingRows.forEach((row) => {
    const id = String(row.id);
    if (!buildingMap[id]) {
      buildingMap[id] = {
        id,
        name: row.name,
        lat: Number(row.lat),
        lng: Number(row.lng),
        type: row.type,
        entrances: [],
      };
    }
    buildingMap[id].entrances.push(String(row.entrance_poi_id));
  });

  if (!Object.keys(buildingMap).length) {
    parsedNodes
      .filter((node) => node.type === "entrance")
      .forEach((node) => {
        const name = node.name.split("_")[0];
        const id = `virtual-building:${name}`;

        if (!buildingMap[id]) {
          buildingMap[id] = {
            id,
            name,
            lat: node.lat,
            lng: node.lng,
            type: "building",
            entrances: [],
          };
        }

        buildingMap[id].entrances.push(node.id);
      });

    Object.values(buildingMap).forEach((building) => {
      const entrances = building.entrances
        .map((id) => nodeMap[id])
        .filter(Boolean);

      if (!entrances.length) return;

      building.lat =
        entrances.reduce((sum, node) => sum + node.lat, 0) / entrances.length;
      building.lng =
        entrances.reduce((sum, node) => sum + node.lng, 0) / entrances.length;
    });
  }

  return {
    nodes: parsedNodes,
    nodeMap,
    buildings: Object.values(buildingMap),
    edges: edges.map((edge) => ({
      from: String(edge.from),
      to: String(edge.to),
      weight: Number(edge.weight),
    })),
  };
}

function parsePoiRow(row) {
  return {
    id: String(row.id),
    name: row.name,
    lat: Number(row.lat),
    lng: Number(row.lng),
    type: row.type,
  };
}

function findBuilding(buildings, rawName, point) {
  const name = normalizePlaceName(rawName);
  const byName = buildings.find((building) => {
    const buildingName = normalizePlaceName(building.name);
    return name.includes(buildingName) || buildingName.includes(name);
  });

  if (byName) return byName;
  if (!point) return null;

  const nearest = buildings
    .map((building) => ({
      building,
      distance: getDistance(point.lat, point.lng, building.lat, building.lng),
    }))
    .sort((a, b) => a.distance - b.distance)[0];

  if (!nearest || nearest.distance > MAX_NEARBY_ROUTE_TARGET_DISTANCE) {
    return null;
  }

  return nearest.building;
}

function findRouteTarget(graphData, rawName, point) {
  if (!hasEntranceQualifier(rawName)) {
    const building = findBuilding(graphData.buildings, rawName, point);
    if (building) {
      return {
        ...building,
        nodeIds: preferredBuildingEntrances(building, graphData),
        type: "building",
      };
    }
  }

  const exactPoi = findPoiNode(graphData.nodes, rawName);
  if (exactPoi) {
    return {
      id: exactPoi.id,
      name: exactPoi.name,
      lat: exactPoi.lat,
      lng: exactPoi.lng,
      nodeIds: [exactPoi.id],
      type: "poi",
    };
  }

  const building = findBuilding(graphData.buildings, rawName, point);
  if (!building) return null;

  return {
    ...building,
    nodeIds: preferredBuildingEntrances(building, graphData),
    type: "building",
  };
}

function preferredBuildingEntrances(building, graphData) {
  const entrances = building.entrances || [];
  const mainEntrances = entrances.filter((id) => {
    const nodeName = graphData.nodeMap[id]?.name || "";
    return /(^|_)정문($|_)/.test(nodeName);
  });

  return mainEntrances.length ? mainEntrances : entrances;
}

function hasEntranceQualifier(value) {
  return /정문|쪽문|후문|입구|출입구|경사로|계단|엘리베이터|횡단보도/.test(
    String(value || "")
  );
}

function findPoiNode(nodes, rawName) {
  const name = normalizePlaceName(rawName);
  if (!name) return null;

  const exact = nodes.find((node) => normalizePlaceName(node.name) === name);
  if (exact) return exact;

  return (
    nodes
      .map((node) => {
        const item = {
          id: node.id,
          place_name: node.name,
          address_name: `MapService POI · ${node.type}`,
          source: "mapservice",
        };

        return {
          node,
          score: placeMatchesQuery(item, name) ? placeSearchScore(item, name) : 0,
        };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.node || null
  );
}

function normalizePlaceName(value) {
  return String(value || "")
    .replace(/한양여자대학교|한양여대|서울특별시|성동구/g, "")
    .replace(/[\s_()\-]/g, "")
    .toLowerCase();
}

function toPoint(lat, lng) {
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  if (Number.isNaN(parsedLat) || Number.isNaN(parsedLng)) return null;
  return { lat: parsedLat, lng: parsedLng };
}

function findTargetPath(startTarget, destinationTarget, graphData, options) {
  let best = null;

  startTarget.nodeIds.forEach((startId) => {
    destinationTarget.nodeIds.forEach((endId) => {
      const route = dijkstra(startId, endId, graphData, options);
      if (route && (!best || route.distance < best.distance)) {
        best = {
          ...route,
          fromEntrance: startId,
          toEntrance: endId,
        };
      }
    });
  });

  return best;
}

function dijkstra(startId, endId, graphData, options = {}) {
  const graph = {};
  const isBlocked = (nodeId) =>
    options.avoidStairs && graphData.nodeMap[nodeId]?.type === "stair";

  graphData.edges.forEach((edge) => {
    if (isBlocked(edge.from) || isBlocked(edge.to)) return;
    if (!graph[edge.from]) graph[edge.from] = [];
    if (!graph[edge.to]) graph[edge.to] = [];
    graph[edge.from].push({ node: edge.to, weight: edge.weight });
    graph[edge.to].push({ node: edge.from, weight: edge.weight });
  });

  const dist = {};
  const prev = {};
  const visited = new Set();
  const queue = [[0, startId]];

  dist[startId] = 0;

  while (queue.length) {
    queue.sort((a, b) => a[0] - b[0]);
    const [distance, current] = queue.shift();

    if (visited.has(current)) continue;
    visited.add(current);
    if (current === endId) break;

    (graph[current] || []).forEach(({ node, weight }) => {
      const nextDistance = distance + weight;
      if (nextDistance < (dist[node] ?? Infinity)) {
        dist[node] = nextDistance;
        prev[node] = current;
        queue.push([nextDistance, node]);
      }
    });
  }

  if (!Number.isFinite(dist[endId])) return null;

  const path = [];
  let current = endId;
  while (current !== undefined) {
    path.unshift(current);
    current = prev[current];
  }

  return {
    path,
    distance: Math.round(dist[endId]),
  };
}

function formatAccessRoute(id, title, route, graphData) {
  if (!route) return null;

  const path = route.path
    .map((nodeId) => graphData.nodeMap[nodeId])
    .filter(Boolean);
  const stairCount = path.filter((node) => node.type === "stair").length;
  const rampCount = path.filter((node) => node.type === "ramp").length;
  const elevatorCount = path.filter((node) => node.type === "elevator").length;
  const crosswalkCount = path.filter((node) => node.type === "crosswalk").length;

  return {
    id,
    title,
    distance: route.distance,
    duration: Math.max(1, Math.ceil(route.distance / 60)),
    dangerCount: stairCount,
    features: {
      stairs: stairCount,
      ramps: rampCount,
      elevators: elevatorCount,
      crosswalks: crosswalkCount,
    },
    path,
  };
}

function summarizeBuilding(building) {
  return {
    id: building.id,
    name: building.name,
    lat: building.lat,
    lng: building.lng,
  };
}

function summarizeRouteTarget(target, graphData) {
  if (target.type === "poi") {
    const node = graphData.nodeMap[target.id] || target;
    return {
      id: node.id,
      name: node.name,
      lat: node.lat,
      lng: node.lng,
      type: node.type,
    };
  }

  return summarizeBuilding(target);
}
