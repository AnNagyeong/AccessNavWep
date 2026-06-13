const container = document.getElementById("map");

const options = {
  center: new kakao.maps.LatLng(37.56184, 127.03811),
  level: 3,
};

const map = new kakao.maps.Map(container, options);
const placesService = new kakao.maps.services.Places();

let markers = [];
let startPlace = null;
let endPlace = null;
let currentPolyline = null;
let currentRoutePolylines = [];
let dangerCircles = [];
let startMarker = null;
let endMarker = null;
let currentLocationMarker = null;
let currentWatchId = null;
let kioskMarkers = [];
let nearbyInfoWindow = null;
let currentLocationPosition = null;
let infoPanelState = "route";
let nearbyPanelPlaces = [];
let nearbyPanelKeyword = "주변";

const NEARBY_SEARCH_RADIUS = 1000;
const NEARBY_CATEGORY_CODES = {
  "편의점": "CS2",
  "카페": "CE7",
  "음식점": "FD6",
  "병원": "HP8",
};

const searchInput = document.getElementById("searchInput");
const backBtn = document.getElementById("backBtn");
const searchBtn = document.getElementById("searchBtn");
const resultList = document.getElementById("resultList");

const placeSheet = document.getElementById("placeSheet");
const panelContent = document.getElementById("panelContent");
const placeName = document.getElementById("placeName");
const placeAddress = document.getElementById("placeAddress");
const sheetHandle = document.getElementById("sheetHandle");

const startRouteBtn = document.getElementById("startRouteBtn");
const routeListBtn = document.getElementById("routeListBtn");

const chipButtons = document.querySelectorAll(".chip");

const favoriteBtn = document.getElementById("favoriteBtn");
const filterBtn = document.getElementById("filterBtn");
const currentLocationBtn = document.getElementById("currentLocationBtn");
const filterPanel = document.getElementById("filterPanel");
const closeFilterBtn = document.getElementById("closeFilterBtn");
const favoritesPanel = document.getElementById("favoritesPanel");
const closeFavoritesPanelBtn = document.getElementById("closeFavoritesPanelBtn");

const loginNavBtn = document.getElementById("loginNavBtn");
const cameraNavBtn = document.getElementById("cameraNavBtn");
const bookmarkNavBtn = document.getElementById("bookmarkNavBtn");

loadSelectedRouteFromQuery();

if (backBtn) {
  backBtn.addEventListener("click", handleBackButton);
}

if (loginNavBtn) {
  loginNavBtn.addEventListener("click", () => {
    location.href = "mypage.html";
  });
}

if (cameraNavBtn) {
  cameraNavBtn.addEventListener("click", () => {
    location.href = "report.html";
  });
}

if (bookmarkNavBtn) {
  bookmarkNavBtn.addEventListener("click", openFavoritesPage);
}

if (sheetHandle && placeSheet) {
  sheetHandle.addEventListener("click", () => {
    placeSheet.classList.toggle("collapsed");
    placeSheet.classList.toggle("expanded");
  });
}

searchBtn.addEventListener("click", () => {
  const keyword = searchInput.value.trim();
  if (!keyword) return;
  searchPlaces(keyword);
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const keyword = searchInput.value.trim();
    if (!keyword) return;
    searchPlaces(keyword);
  }
});

chipButtons.forEach((chip) => {
  chip.addEventListener("click", () => {
    const keyword = chip.dataset.keyword;
    searchInput.value = keyword;
    searchNearbyPlaces(keyword);
  });
});

if (currentLocationBtn) {
  currentLocationBtn.addEventListener("click", moveToCurrentLocation);
}

if (favoriteBtn) {
  favoriteBtn.addEventListener("click", openFavoritesPage);
}

function openFavoritesPage() {
  if (!favoritesPanel) return;
  hideResultList();
  placeSheet.classList.add("hidden");
  filterPanel?.classList.add("hidden");
  favoritesPanel.classList.remove("hidden");
}

if (closeFavoritesPanelBtn && favoritesPanel) {
  closeFavoritesPanelBtn.addEventListener("click", () => {
    favoritesPanel.classList.add("hidden");
  });
}

if (new URLSearchParams(location.search).get("panel") === "favorites") {
  openFavoritesPage();

  if (history.replaceState) {
    history.replaceState(null, "", "index.html");
  }
}

if (filterBtn && filterPanel) {
  filterBtn.addEventListener("click", () => {
    filterPanel.classList.remove("hidden");
    map.relayout();
  });
}

if (closeFilterBtn && filterPanel) {
  closeFilterBtn.addEventListener("click", () => {
    filterPanel.classList.add("hidden");
  });
}

if (filterPanel) {
  filterPanel.addEventListener("click", (event) => {
    if (event.target === filterPanel) {
      filterPanel.classList.add("hidden");
    }
  });
}

document.querySelectorAll("#filterPanel input[type='checkbox']").forEach((checkbox) => {
  checkbox.addEventListener("change", () => {
    if (checkbox.dataset.filter === "barrier_free_kiosk") {
      if (checkbox.checked) {
        loadBarrierFreeKiosks();
      } else {
        clearKioskMarkers();
      }
    }
  });
});


document.addEventListener("click", (event) => {
  const nearbyCard = event.target.closest(".nearby-place-card");

  if (nearbyCard) {
    const place = nearbyPanelPlaces[Number(nearbyCard.dataset.index)];
    if (place) {
      showNearbyPlaceDetail(place);
    }
    return;
  }

  if (event.target.closest("#nearbyBackBtn")) {
    renderNearbyPanel(nearbyPanelPlaces, nearbyPanelKeyword);
    return;
  }

  if (event.target.closest("#routeListBtn")) {
    if (!startPlace || !endPlace) {
      alert("출발지와 목적지를 모두 선택해주세요.");
      return;
    }

    location.href = `route-list.html?${routeQueryParams()}`;
    return;
  }

  if (event.target.closest("#startRouteBtn")) {
    if (!startPlace || !endPlace) {
      alert("출발지와 목적지를 모두 선택해주세요.");
      return;
    }

    location.href = `guidance.html?${routeQueryParams()}`;
  }
});

function openReportPage() {
  const targetPlace = endPlace || startPlace;

  if (!targetPlace) {
    alert("먼저 장소를 선택해주세요.");
    return;
  }

  location.href =
    `report.html?name=${encodeURIComponent(targetPlace.place_name)}` +
    `&address=${encodeURIComponent(
      targetPlace.road_address_name || targetPlace.address_name || ""
    )}` +
    `&x=${targetPlace.x}&y=${targetPlace.y}`;
}

function searchPlaces(keyword) {
  Promise.all([
    fetchMapServicePlaces(keyword),
    new Promise((resolve) => {
      placesService.keywordSearch(keyword, (data, status) => {
        resolve(status === kakao.maps.services.Status.OK ? data : []);
      });
    }),
  ]).then(([mapServicePlaces, kakaoPlaces]) => {
    const places = [...mapServicePlaces, ...kakaoPlaces];

    if (!places.length) {
      alert("검색 결과가 없습니다.");
      hideResultList();
      return;
    }

    renderResultList(places);
  });
}

async function fetchMapServicePlaces(keyword) {
  try {
    const response = await fetch(
      `/api/access-places?query=${encodeURIComponent(keyword)}`
    );
    const data = await response.json();

    if (!response.ok || !data.ok) return [];
    return data.items || [];
  } catch {
    return [];
  }
}

function searchNearbyPlaces(keyword) {
  if (currentLocationPosition) {
    searchNearbyPlacesFromPosition(keyword, currentLocationPosition);
    return;
  }

  if (!navigator.geolocation) {
    alert("현재 위치 기능을 지원하지 않는 브라우저입니다.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const currentPosition = new kakao.maps.LatLng(lat, lng);

      searchNearbyPlacesFromPosition(keyword, currentPosition);
    },
    () => {
      alert("현재 위치를 가져올 수 없습니다. 위치 권한을 허용해주세요.");
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }
  );
}

function searchNearbyPlacesFromPosition(keyword, currentPosition) {
  favoritesPanel?.classList.add("hidden");
  updateCurrentLocationMarker(currentPosition.getLat(), currentPosition.getLng());
  smoothMoveTo(currentPosition);

  const options = {
    location: currentPosition,
    radius: NEARBY_SEARCH_RADIUS,
    sort: kakao.maps.services.SortBy.DISTANCE,
  };

  const callback = (data, status) => {
    clearSearchMarkers();
    hideResultList();

    if (status !== kakao.maps.services.Status.OK || data.length === 0) {
      alert(`현재 위치 1km 안에 ${keyword} 검색 결과가 없습니다.`);
      return;
    }

    drawNearbyPlaceMarkers(data);
    renderNearbyPanel(data, keyword);
    openPlaceSheet();
  };

  const categoryCode = NEARBY_CATEGORY_CODES[keyword];

  if (categoryCode) {
    placesService.categorySearch(categoryCode, callback, options);
  } else {
    placesService.keywordSearch(keyword, callback, options);
  }
}

function drawNearbyPlaceMarkers(places) {
  const bounds = new kakao.maps.LatLngBounds();

  if (currentLocationMarker) {
    bounds.extend(currentLocationMarker.getPosition());
  }

  places.forEach((place) => {
    const position = new kakao.maps.LatLng(place.y, place.x);
    const marker = new kakao.maps.Marker({
      map,
      position,
      title: place.place_name,
    });

    place._marker = marker;

    kakao.maps.event.addListener(marker, "click", () => {
      if (nearbyInfoWindow) {
        nearbyInfoWindow.close();
      }

      nearbyInfoWindow = new kakao.maps.InfoWindow({
        content: `
          <div style="padding:8px 10px; font-size:13px; line-height:1.4;">
            <strong>${place.place_name}</strong><br />
            <span>${place.road_address_name || place.address_name || "주소 정보 없음"}</span>
          </div>
        `,
      });

      nearbyInfoWindow.open(map, marker);
      showNearbyPlaceDetail(place);
    });

    markers.push(marker);
    bounds.extend(position);
  });

  map.setBounds(bounds);
}

function renderResultList(places) {
  resultList.innerHTML = "";

  places.forEach((place) => {
    const item = document.createElement("div");
    item.className = "result-item";
    item.innerHTML = `
      <strong>${place.place_name}</strong>
      <span>${place.road_address_name || place.address_name || "주소 정보 없음"}</span>
    `;

    item.addEventListener("click", () => {
      selectPlace(place);
      smoothMoveTo(new kakao.maps.LatLng(place.y, place.x));
      hideResultList();
    });

    resultList.appendChild(item);
  });

  resultList.classList.remove("hidden");
}

function hideResultList() {
  resultList.classList.add("hidden");
}

function selectPlace(place) {
  if (!startPlace) {
    startPlace = place;
    updateStartMarker(place);
    alert(`출발지 설정: ${place.place_name}`);
  } else if (!endPlace) {
    endPlace = place;
    updateEndMarker(place);
    document.body.classList.add("route-mode");
  } else {
    endPlace = place;
    updateEndMarker(place);
    document.body.classList.add("route-mode");
  }

  updatePlaceSheet();
  openPlaceSheet();

  if (startPlace && endPlace) {
    drawDefaultRouteFromSelection();
  }
}

function routeQueryParams() {
  const params = new URLSearchParams({
    startName: startPlace.place_name,
    startAddress: startPlace.road_address_name || startPlace.address_name || "",
    startX: startPlace.x,
    startY: startPlace.y,
    name: endPlace.place_name,
    address: endPlace.road_address_name || endPlace.address_name || "",
    x: endPlace.x,
    y: endPlace.y,
  });

  return params.toString();
}

async function loadSelectedRouteFromQuery() {
  const params = new URLSearchParams(location.search);
  const routeType = params.get("routeType");

  if (!routeType) return;

  try {
    const response = await fetch(`/api/access-routes?${params.toString()}`);
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "경로를 불러오지 못했습니다.");
    }

    const route = data.routes.find((item) => item.id === routeType) || data.routes[0];
    if (!route) {
      throw new Error("선택한 경로를 찾을 수 없습니다.");
    }

    startPlace = {
      place_name: data.start.name,
      y: data.start.lat,
      x: data.start.lng,
      road_address_name: "",
      address_name: data.start.name,
    };
    endPlace = {
      place_name: data.destination.name,
      y: data.destination.lat,
      x: data.destination.lng,
      road_address_name: "",
      address_name: data.destination.name,
    };

    updateStartMarker(startPlace);
    updateEndMarker(endPlace);
    drawRoute({ path: route.path, colored: true });
    drawDangerZones(dangerZonesFromRoute(route.path));
    updateSelectedRouteSheet(route);
    updateRouteInfo({
      distance: route.distance,
      duration: route.duration * 60,
    });
    updateDangerCount(route.dangerCount);
    updateSafetyRatio(route);

    document.body.classList.add("route-mode");
    openPlaceSheet();
  } catch (error) {
    console.error("선택 경로 로딩 실패:", error);
    alert(error.message);
  }
}

async function drawDefaultRouteFromSelection() {
  try {
    const response = await fetch(`/api/access-routes?${routeQueryParams()}`);
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "경로를 불러오지 못했습니다.");
    }

    const route =
      data.routes.find((item) => item.id === "accessible") || data.routes[0];

    if (!route) {
      throw new Error("사용 가능한 경로가 없습니다.");
    }

    drawRoute({ path: route.path, colored: true });
    drawDangerZones(dangerZonesFromRoute(route.path));
    updateSelectedRouteSheet(route);
    updateRouteInfo({
      distance: route.distance,
      duration: route.duration * 60,
    });
    updateDangerCount(route.dangerCount);
    updateSafetyRatio(route);
  } catch (error) {
    console.error("기본 경로 로딩 실패:", error);
    alert(error.message);
  }
}

function updateSelectedRouteSheet(route) {
  const routeLabel = route.id === "accessible" ? "추천 경로" : "최단 경로";
  renderRoutePanel(
    `${endPlace.place_name}까지 ${routeLabel}`,
    `계단 ${route.features.stairs}개 · 경사로 ${route.features.ramps}개 · ` +
      `엘리베이터 ${route.features.elevators}개 · 횡단보도 ${route.features.crosswalks}개`
  );
}

function updateSafetyRatio(route) {
  const ratio = calculateSafetyRatio(route.path || []);
  const safeBar = document.querySelector(".safety-bar .safe");
  const warnBar = document.querySelector(".safety-bar .warn");
  const labels = document.querySelectorAll(".safety-labels span");

  if (safeBar) {
    safeBar.style.width = `${ratio.safe}%`;
    safeBar.style.flexBasis = `${ratio.safe}%`;
  }
  if (warnBar) {
    warnBar.style.width = `${ratio.warn}%`;
    warnBar.style.flexBasis = `${ratio.warn}%`;
  }
  if (labels[0]) labels[0].textContent = `안전 ${ratio.safe}%`;
  if (labels[1]) labels[1].textContent = `주의 ${ratio.warn}%`;
}

function calculateSafetyRatio(path) {
  if (path.length < 2) {
    return { safe: 100, warn: 0 };
  }

  let safeDistance = 0;
  let warnDistance = 0;

  for (let i = 0; i < path.length - 1; i += 1) {
    const fromNode = path[i];
    const toNode = path[i + 1];
    const distance = getDistance(fromNode.lat, fromNode.lng, toNode.lat, toNode.lng);
    const color = routeSegmentColor(fromNode, toNode);

    if (color === "#48d10f") {
      safeDistance += distance;
    } else {
      warnDistance += distance;
    }
  }

  const total = safeDistance + warnDistance;
  if (!total) {
    return { safe: 100, warn: 0 };
  }

  const safe = Math.round((safeDistance / total) * 100);
  return {
    safe,
    warn: 100 - safe,
  };
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

function handleBackButton() {
  if (startPlace || endPlace || currentPolyline || currentRoutePolylines.length) {
    resetRouteState();
    return;
  }

  history.back();
}

function resetRouteState() {
  clearSearchMarkers();
  clearRoutePolylines();
  clearDangerZones();

  if (startMarker) {
    startMarker.setMap(null);
    startMarker = null;
  }

  if (endMarker) {
    endMarker.setMap(null);
    endMarker = null;
  }

  startPlace = null;
  endPlace = null;
  searchInput.value = "";
  hideResultList();
  document.body.classList.remove("route-mode");
  resetPlaceSheet();

  if (history.replaceState) {
    history.replaceState(null, "", "index.html");
  }
}

function clearDangerZones() {
  dangerCircles.forEach((circle) => circle.setMap(null));
  dangerCircles = [];
}

function resetPlaceSheet() {
  renderRoutePanel("장소명", "주소가 여기에 표시됩니다.");
  placeSheet.classList.add("hidden");
  placeSheet.classList.remove("collapsed");
  placeSheet.classList.add("expanded");
  updateSafetyRatio({ path: [] });
}

function moveToCurrentLocation() {
  if (!navigator.geolocation) {
    alert("이 브라우저는 현재 위치 기능을 지원하지 않습니다.");
    return;
  }

  if (currentWatchId !== null) {
    navigator.geolocation.clearWatch(currentWatchId);
  }

  currentWatchId = navigator.geolocation.watchPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      const currentPosition = new kakao.maps.LatLng(lat, lng);

      startPlace = {
        place_name: "현재 위치",
        y: lat,
        x: lng,
        road_address_name: "",
        address_name: "현재 위치에서 출발",
      };

      smoothMoveTo(currentPosition);

      setTimeout(() => {
        map.setLevel(3);
      }, 700);

      updateCurrentLocationMarker(lat, lng);
      updatePlaceSheet();
      collapsePlaceSheet();
    },
    () => {
      alert("현재 위치를 가져올 수 없습니다. 위치 권한을 허용해주세요.");
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }
  );
}

function smoothMoveTo(targetPosition) {
  const currentCenter = map.getCenter();

  const startLat = currentCenter.getLat();
  const startLng = currentCenter.getLng();
  const endLat = targetPosition.getLat();
  const endLng = targetPosition.getLng();

  const duration = 700;
  const startTime = performance.now();

  function animate(now) {
    const progress = Math.min((now - startTime) / duration, 1);

    const easedProgress = 1 - Math.pow(1 - progress, 3);

    const lat = startLat + (endLat - startLat) * easedProgress;
    const lng = startLng + (endLng - startLng) * easedProgress;

    map.setCenter(new kakao.maps.LatLng(lat, lng));

    if (progress < 1) {
      requestAnimationFrame(animate);
    }
  }

  requestAnimationFrame(animate);
}

function updateCurrentLocationMarker(lat, lng) {
  const position = new kakao.maps.LatLng(lat, lng);
  currentLocationPosition = position;

  const markerImage = new kakao.maps.MarkerImage(
    "images/current-location.svg",
    new kakao.maps.Size(90, 90),
    {
      offset: new kakao.maps.Point(45, 45),
    }
  );

  if (!currentLocationMarker) {
    currentLocationMarker = new kakao.maps.Marker({
      map,
      position,
      image: markerImage,
      title: "현재 위치",
      zIndex: 20,
    });
  } else {
    currentLocationMarker.setPosition(position);
  }
}

function updatePlaceSheet() {
  if (!startPlace && !endPlace) return;

  if (startPlace && endPlace) {
    renderRoutePanel(`${endPlace.place_name}까지`, "");
  } else if (startPlace) {
    renderRoutePanel(
      `출발지: ${startPlace.place_name}`,
      startPlace.road_address_name || startPlace.address_name || "주소 정보 없음"
    );
  } else {
    renderRoutePanel(
      `목적지: ${endPlace.place_name}`,
      endPlace.road_address_name || endPlace.address_name || "주소 정보 없음"
    );
  }
}

function renderRoutePanel(title, subtitle = "") {
  infoPanelState = "route";
  if (!panelContent) return;

  panelContent.innerHTML = `
    <p class="sheet-label">선택한 목적지</p>
    <h3 id="placeName">${escapeHTML(title)}</h3>
    <p id="placeAddress" class="muted">${escapeHTML(subtitle)}</p>

    <div class="info-cards">
      <div class="info-card">
        <strong>3분</strong>
        <span>예상 시간</span>
      </div>
      <div class="info-card">
        <strong>100m</strong>
        <span>거리</span>
      </div>
      <div class="info-card danger">
        <strong>2곳</strong>
        <span>위험 구간</span>
      </div>
    </div>

    <div class="safety-bar">
      <div class="safe"></div>
      <div class="warn"></div>
    </div>

    <div class="safety-labels">
      <span>안전 20%</span>
      <span>주의 80%</span>
    </div>

    <div class="sheet-actions">
      <button class="secondary-btn" id="routeListBtn">경로 목록</button>
      <button class="primary-btn" id="startRouteBtn">안내 시작</button>
    </div>
  `;
}

function renderNearbyPanel(places, keyword = "주변") {
  infoPanelState = "nearby";
  nearbyPanelPlaces = places;
  nearbyPanelKeyword = keyword;
  if (!panelContent) return;

  const cards = places
    .map((place, index) => {
      const category = placeCategory(place);
      return `
        <article class="nearby-place-card" data-index="${index}">
          <div class="nearby-photo" aria-hidden="true"></div>
          <div class="nearby-place-body">
            <div class="nearby-title-row">
              <h4>${escapeHTML(place.place_name || "이름 없음")}</h4>
              <span>${escapeHTML(category)}</span>
            </div>
            <p>${escapeHTML(formatPlaceDistance(place))}</p>
            <p class="nearby-accessibility">${escapeHTML(accessibilityLabel(place))}</p>
          </div>
        </article>
      `;
    })
    .join("");

  panelContent.innerHTML = `
    <div class="info-panel-heading">
      <p class="sheet-label">주변 시설</p>
      <h3>${escapeHTML(keyword)} 주변 목록</h3>
      <p class="muted">현재 위치 기준으로 가까운 시설을 보여줍니다.</p>
    </div>
    <div class="nearby-list">
      ${cards}
    </div>
  `;
}

function showNearbyPlaceDetail(place) {
  infoPanelState = "detail";
  if (!panelContent) return;

  const position = new kakao.maps.LatLng(place.y, place.x);
  smoothMoveTo(position);

  if (place._marker) {
    place._marker.setMap(map);
  }

  panelContent.innerHTML = `
    <button class="panel-back-button" id="nearbyBackBtn" type="button">← 목록</button>
    <div class="nearby-detail-photo" aria-hidden="true"></div>
    <div class="nearby-detail">
      <p class="sheet-label">${escapeHTML(placeCategory(place))}</p>
      <h3>${escapeHTML(place.place_name || "이름 없음")}</h3>
      <p class="muted">${escapeHTML(place.road_address_name || place.address_name || "주소 정보 없음")}</p>
      <div class="nearby-detail-meta">
        <span>${escapeHTML(formatPlaceDistance(place))}</span>
        <span>${escapeHTML(accessibilityLabel(place))}</span>
      </div>
    </div>
  `;

  openPlaceSheet();
}

function placeCategory(place) {
  const category = place.category_group_name || place.category_name || "시설";
  return String(category).split(">").pop().trim() || "시설";
}

function formatPlaceDistance(place) {
  const distance = Number(place.distance);

  if (!Number.isNaN(distance) && distance > 0) {
    return `현재 위치에서 ${formatDistance(distance)}`;
  }

  if (currentLocationPosition && place.y && place.x) {
    const meters = getDistance(
      currentLocationPosition.getLat(),
      currentLocationPosition.getLng(),
      Number(place.y),
      Number(place.x)
    );
    return `현재 위치에서 ${formatDistance(meters)}`;
  }

  return "현재 위치 기준 거리 확인 중";
}

function formatDistance(meters) {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)}km`;
  }

  return `${Math.round(meters)}m`;
}

function accessibilityLabel(place) {
  const category = placeCategory(place);

  if (category.includes("병원") || category.includes("약국")) {
    return "휠체어 진입 정보 확인 필요";
  }

  return "휠체어 진입 가능";
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function openPlaceSheet() {
  placeSheet.classList.remove("hidden");
  placeSheet.classList.remove("collapsed");
  placeSheet.classList.add("expanded");
}

function collapsePlaceSheet() {
  placeSheet.classList.remove("hidden");
  placeSheet.classList.remove("expanded");
  placeSheet.classList.add("collapsed");
}

function updateStartMarker(place) {
  const position = new kakao.maps.LatLng(place.y, place.x);

  if (startMarker) {
    startMarker.setMap(null);
  }

  startMarker = new kakao.maps.Marker({
    map,
    position,
    title: "출발지",
  });
}

function updateEndMarker(place) {
  const position = new kakao.maps.LatLng(place.y, place.x);

  if (endMarker) {
    endMarker.setMap(null);
  }

  endMarker = new kakao.maps.Marker({
    map,
    position,
    title: "목적지",
  });
}

function drawRoute(data) {
  const routeNodes = data.path || [];
  const path = routeNodes.map((p) => new kakao.maps.LatLng(p.lat, p.lng));

  if (!path.length) {
    alert("경로 좌표가 없습니다.");
    return;
  }

  clearRoutePolylines();

  if (data.colored && routeNodes.length > 1) {
    for (let i = 0; i < routeNodes.length - 1; i += 1) {
      const segment = new kakao.maps.Polyline({
        path: [path[i], path[i + 1]],
        strokeWeight: 7,
        strokeColor: routeSegmentColor(routeNodes[i], routeNodes[i + 1]),
        strokeOpacity: 0.95,
        strokeStyle: "solid",
        zIndex: 10,
      });

      segment.setMap(map);
      currentRoutePolylines.push(segment);
    }
  } else {
    currentPolyline = new kakao.maps.Polyline({
      path,
      strokeWeight: 5,
      strokeColor: "#48d10f",
      strokeOpacity: 0.9,
      strokeStyle: "solid",
    });

    currentPolyline.setMap(map);
  }

  const bounds = new kakao.maps.LatLngBounds();
  path.forEach((point) => bounds.extend(point));
  map.setBounds(bounds);

  if (data.colored) {
    updateSafetyRatio({ path: routeNodes });
  }
}

function clearRoutePolylines() {
  if (currentPolyline) {
    currentPolyline.setMap(null);
    currentPolyline = null;
  }

  currentRoutePolylines.forEach((polyline) => polyline.setMap(null));
  currentRoutePolylines = [];
}

function routeSegmentColor(fromNode, toNode) {
  const types = [fromNode?.type, toNode?.type];

  if (types.includes("stair")) {
    return "#f26a6a";
  }

  if (
    types.includes("crosswalk") ||
    types.includes("ramp") ||
    types.includes("elevator")
  ) {
    return "#f4c20d";
  }

  return "#48d10f";
}

function dangerZonesFromRoute(path) {
  const zones = new Map();

  for (let i = 0; i < path.length - 1; i += 1) {
    const fromNode = path[i];
    const toNode = path[i + 1];

    if (routeSegmentColor(fromNode, toNode) !== "#f26a6a") {
      continue;
    }

    [fromNode, toNode].forEach((node) => {
      zones.set(node.id || `${node.lat},${node.lng}`, {
        lat: node.lat,
        lng: node.lng,
        radius: 13,
      });
    });
  }

  return [...zones.values()];
}

function drawDangerZones(zones) {
  clearDangerZones();

  zones.forEach((zone) => {
    const circle = new kakao.maps.Circle({
      center: new kakao.maps.LatLng(zone.lat, zone.lng),
      radius: zone.radius || 25,
      strokeWeight: 2,
      strokeColor: "#ff4d4f",
      strokeOpacity: 0.9,
      fillColor: "#ff4d4f",
      fillOpacity: 0.25,
    });

    circle.setMap(map);
    dangerCircles.push(circle);
  });
}

//키오스크 API 관련
async function loadBarrierFreeKiosks() {
  try {
    const res = await fetch(
  "/api/barrier-free-kiosks?query=서울특별시&page=1&size=100"
);
    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(data.error || "키오스크 정보를 불러오지 못했습니다.");
    }

    drawKioskMarkers(data.items || []);
  } catch (error) {
    console.error("키오스크 마커 로딩 실패:", error);
    alert(error.message);
  }
}

function drawKioskMarkers(items) {
  clearKioskMarkers();

  items.forEach((item) => {
    const position = new kakao.maps.LatLng(item.lat, item.lng);

    const marker = new kakao.maps.Marker({
      map,
      position,
      title: item.name,
    });

    const infoWindow = new kakao.maps.InfoWindow({
      content: `
        <div style="padding:8px 10px; font-size:13px; line-height:1.4;">
          <strong>${item.name}</strong><br />
          <span>${item.address || "주소 정보 없음"}</span>
        </div>
      `,
    });

    kakao.maps.event.addListener(marker, "click", () => {
      infoWindow.open(map, marker);
    });

    kioskMarkers.push(marker);
  });
}

function clearKioskMarkers() {
  kioskMarkers.forEach((marker) => marker.setMap(null));
  kioskMarkers = [];
}


function updateRouteInfo(summary) {
  const distance = Number(summary.distance || 0);
  const duration = Number(summary.duration || 0);

  const distanceText =
    distance < 1000
      ? `${Math.round(distance)}m`
      : `${(distance / 1000).toFixed(1)}km`;

  const minutes = Math.ceil(duration / 60);
  const timeText = minutes > 0 ? `${minutes}분` : "-";

  const timeCard = document.querySelector(".info-card:nth-child(1) strong");
  const distanceCard = document.querySelector(".info-card:nth-child(2) strong");

  if (timeCard) timeCard.innerText = timeText;
  if (distanceCard) distanceCard.innerText = distanceText;
}

function updateDangerCount(count) {
  const dangerCard = document.querySelector(".info-card:nth-child(3) strong");

  if (dangerCard) {
    dangerCard.innerText = `${count}곳`;
  }
}

function clearSearchMarkers() {
  if (nearbyInfoWindow) {
    nearbyInfoWindow.close();
    nearbyInfoWindow = null;
  }

  markers.forEach((marker) => marker.setMap(null));
  markers = [];
}
