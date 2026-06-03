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
  password: process.env.DB_PASSWORD || process.env.DB_PASS,
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

app.get("/api/access-routes", handleAccessRoutes);
app.get("/api/access-places", handleAccessPlaces);

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
  if (item.source === "mapservice" && !String(item.id).startsWith("virtual-building:")) {
    score += 20;
  }
  if (names.some((name) => name.includes(query))) score += 10;

  return score;
}

function placeMatchesQuery(item, query) {
  return searchNamesForPlace(item).some(
    (name) => name.includes(query) || query.includes(name)
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
  const [nodes] = await db.execute(
    `
    SELECT poi_id as id, poi_name as name,
      latitude as lat, longitude as lng, poi_type as type
    FROM poi
    WHERE poi_type != 'building'
    `
  );

  const [buildingRows] = await db.execute(
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

  const [edges] = await db.execute(
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

  return buildings
    .map((building) => ({
      building,
      distance: getDistance(point.lat, point.lng, building.lat, building.lng),
    }))
    .sort((a, b) => a.distance - b.distance)[0]?.building || null;
}

function findRouteTarget(graphData, rawName, point) {
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
    nodeIds: building.entrances,
    type: "building",
  };
}

function findPoiNode(nodes, rawName) {
  const name = normalizePlaceName(rawName);
  if (!name) return null;

  const exact = nodes.find((node) => normalizePlaceName(node.name) === name);
  if (exact) return exact;

  return nodes.find((node) => {
    return searchNamesForPlace({
      id: node.id,
      place_name: node.name,
      address_name: `MapService POI · ${node.type}`,
      source: "mapservice",
    }).some((nodeName) => name.includes(nodeName) || nodeName.includes(name));
  });
}

function normalizePlaceName(value) {
  return String(value || "")
    .replace(/한양여자대학교|한양여대|서울특별시|성동구/g, "")
    .replace(/\s|\(|\)|-/g, "")
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
