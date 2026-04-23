require("dotenv").config({ path: ".env" });

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;

const MAPSERVICE_BASE_URL =
  process.env.MAPSERVICE_BASE_URL || "http://localhost:8080";

const MAPSERVICE_REPORTS_ENDPOINT =
  process.env.MAPSERVICE_REPORTS_ENDPOINT || "/api/reports";

app.use(express.json());
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/index.html", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/where", (req, res) => {
  res.send(__dirname);
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "AccessNav backend is running",
    dir: __dirname,
    file: __filename,
    cwd: process.cwd(),
    hasRestKey: !!process.env.KAKAO_REST_API_KEY,
    restKeyPreview: process.env.KAKAO_REST_API_KEY
      ? process.env.KAKAO_REST_API_KEY.slice(0, 6) + "..."
      : null,
    mapServiceBaseUrl: MAPSERVICE_BASE_URL,
    mapServiceReportsEndpoint: MAPSERVICE_REPORTS_ENDPOINT,
  });
});

app.post("/api/walking-route", async (req, res) => {
  try {
    const { origin, destination } = req.body || {};

   console.log("요청 body:", req.body);
   console.log("origin:", origin);
   console.log("destination:", destination);


    if (
      !origin ||
      !destination ||
      origin.x == null ||
      origin.y == null ||
      destination.x == null ||
      destination.y == null
    ) {
      return res.status(400).json({
        ok: false,
        message: "origin/destination 좌표가 필요합니다.",
      });
    }

    if (!KAKAO_REST_API_KEY) {
      return res.status(500).json({
        ok: false,
        message: "KAKAO_REST_API_KEY가 설정되지 않았습니다.",
      });
    }

    const routeData = await fetchWalkingRouteFromKakao(origin, destination);

    const route = routeData?.routes?.[0];
    const section = route?.sections?.[0];
    const roads = section?.roads || [];

    if (!route || !section || !roads.length) {
      return res.status(502).json({
        ok: false,
        message: "도보 경로 데이터를 정상적으로 받지 못했습니다.",
        raw: routeData,
      });
    }

    const pathPoints = extractPathPoints(roads);

    let hitZones = [];
    try {
      const rawReports = await fetchDangerReportsFromMapService();
      const dangerZones = normalizeDangerZones(rawReports);
      hitZones = findDangerZonesOnRoute(pathPoints, dangerZones);
    } catch (err) {
      console.warn("MapService 생략:", err.message);
      hitZones = [];
    }

    return res.json({
      ok: true,
      summary: {
        distance: route.summary?.distance ?? 0,
        duration: route.summary?.duration ?? 0,
      },
      path: pathPoints,
      dangerZones: hitZones,
      dangerCount: hitZones.length,
    });
  } catch (error) {
    console.error("POST /api/walking-route error:", error);

    return res.status(500).json({
      ok: false,
      message: error.message || "도보 경로 처리 중 서버 오류가 발생했습니다.",
      error: String(error.stack || error.message || error),
    });
  }
});

async function fetchWalkingRouteFromKakao(origin, destination) {
  const url =
    "https://apis-navi.kakaomobility.com/affiliate/walking/v1/directions" +
    `?origin=${origin.x},${origin.y}` +
    `&destination=${destination.x},${destination.y}`;

  console.log("카카오 요청 URL:", url);
  console.log("카카오 키 존재:", !!KAKAO_REST_API_KEY);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `KakaoAK ${KAKAO_REST_API_KEY}`,
      Accept: "application/json",
    },
  });

  const text = await response.text();

  console.log("카카오 응답 상태:", response.status);
  console.log("카카오 응답 본문:", text);

  if (!response.ok) {
    throw new Error(`카카오 API 오류 ${response.status}: ${text}`);
  }

  return JSON.parse(text);
}

async function fetchDangerReportsFromMapService() {
  const url = `${MAPSERVICE_BASE_URL}${MAPSERVICE_REPORTS_ENDPOINT}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    const text = await response.text();

    if (!response.ok) {
      console.warn(`MapService 조회 실패: ${response.status} ${text}`);
      return [];
    }

    const parsed = JSON.parse(text);

    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.data)) return parsed.data;
    if (Array.isArray(parsed.reports)) return parsed.reports;

    return [];
  } catch (error) {
    console.warn("MapService 요청 오류:", error.message);
    return [];
  }
}

function extractPathPoints(roads) {
  const points = [];

  for (const road of roads) {
    const vertexes = road?.vertexes || [];

    for (let i = 0; i < vertexes.length; i += 2) {
      const lng = Number(vertexes[i]);
      const lat = Number(vertexes[i + 1]);

      if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
        points.push({ lat, lng });
      }
    }
  }

  return points;
}

function normalizeDangerZones(rawReports) {
  if (!Array.isArray(rawReports)) return [];

  return rawReports
    .map((item) => {
      const lat = Number(item.latitude ?? item.lat);
      const lng = Number(item.longitude ?? item.lng);

      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        return null;
      }

      return {
        id: item.report_id ?? item.id ?? `${lat},${lng}`,
        lat,
        lng,
        radius: inferDangerRadius(item),
        type: item.category ?? item.type ?? "위험 제보",
        level: inferDangerLevel(item),
        description: item.description ?? "",
        status: item.status ?? "",
        createdAt: item.created_at ?? null,
      };
    })
    .filter(Boolean);
}

function inferDangerRadius(item) {
  const category = String(item.category ?? item.type ?? "").trim();

  switch (category) {
    case "공사":
      return 35;
    case "불법주차":
      return 20;
    case "단차":
      return 18;
    case "보도블록 파손":
      return 20;
    default:
      return 25;
  }
}

function inferDangerLevel(item) {
  const category = String(item.category ?? item.type ?? "").trim();

  switch (category) {
    case "공사":
    case "단차":
      return "high";
    case "불법주차":
    case "보도블록 파손":
      return "medium";
    default:
      return "low";
  }
}

function findDangerZonesOnRoute(pathPoints, dangerZones) {
  const hits = [];

  for (const zone of dangerZones) {
    const matched = pathPoints.some((point) => {
      const distance = getDistanceMeters(
        point.lat,
        point.lng,
        zone.lat,
        zone.lng
      );
      return distance <= zone.radius;
    });

    if (matched) {
      hits.push(zone);
    }
  }

  return hits;
}

function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

console.log("현재 실행 중인 파일:", __filename);
console.log("현재 작업 폴더:", process.cwd());
console.log("REST KEY 존재 여부:", !!process.env.KAKAO_REST_API_KEY);

app.listen(PORT, () => {
  console.log("=== 새 서버 실행 성공 ===");
  console.log(`AccessNav backend running on http://localhost:${PORT}`);
});
