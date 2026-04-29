require("dotenv").config({ path: ".env" });

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ❗ 오타 수정 (KEY)
const ORS_API_KEY = process.env.ORS_API_KEY;

app.use(express.json());
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/index.html", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});


// ✅ ORS 경로 API (최종)
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

    // ORS 호출
    const routeData = await fetchWalkingRouteFromORS(origin, destination);

    const coords = routeData.features[0].geometry.coordinates;

    const path = coords.map(([lng, lat]) => ({
      lat,
      lng,
    }));

    // 위험지역 (선택)
    let hitZones = [];
    try {
      const rawReports = await fetchDangerReportsFromMapService();
      const dangerZones = normalizeDangerZones(rawReports);
      hitZones = findDangerZonesOnRoute(path, dangerZones);
    } catch (err) {
      console.warn("MapService 생략:", err.message);
    }

    res.json({
      ok: true,
      summary: {
        distance: routeData.features[0].properties.summary.distance,
        duration: routeData.features[0].properties.summary.duration,
      },
      path,
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


// ✅ ORS 함수
async function fetchWalkingRouteFromORS(origin, destination) {
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


// ================= 위험구간 (옵션 기능) =================

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
    .filter((z) => !isNaN(z.lat) && !isNaN(z.lng));
}

function findDangerZonesOnRoute(path, zones) {
  return zones.filter((zone) =>
    path.some(
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


// 서버 실행
app.listen(PORT, () => {
<<<<<<< HEAD
  console.log("=== 새 서버 실행 성공 ===");
  console.log(`AccessNav backend running on http://localhost:${PORT}`);
});
=======
  console.log(`🔥 서버 실행: http://localhost:${PORT}`);
});
>>>>>>> 71aedcb (ORS 수정)
