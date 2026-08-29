const container = document.getElementById("map");

const options = {
  center: new kakao.maps.LatLng(37.56184, 127.03811),
  level: 3,
};

const map = new kakao.maps.Map(container, options);
const placesService = new kakao.maps.services.Places();
const restoredMapViewFromQuery = restoreMapViewFromQuery();

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
let currentRouteData = null;
let selectedPlaceForRoute = null;

// false 일 땐 지도만 보는 중, true 일 땐 실제 길안내 중
let navigationMode = false;
let lastNavigationPosition = null;

if (!restoredMapViewFromQuery) {
  centerMapOnCurrentLocation({
    setStartPlace: false,
    updatePanel: false,
    collapsePanel: false,
    silentError: true,
  });
}

function restoreMapViewFromQuery() {
  const params = new URLSearchParams(location.search);
  let restoredCenter = false;

  if (params.has("mapX") && params.has("mapY")) {
    const mapX = Number(params.get("mapX"));
    const mapY = Number(params.get("mapY"));

    if (!Number.isNaN(mapX) && !Number.isNaN(mapY)) {
      map.setCenter(new kakao.maps.LatLng(mapY, mapX));
      restoredCenter = true;
    }
  }

  if (params.has("mapLevel")) {
    const mapLevel = Number(params.get("mapLevel"));

    if (!Number.isNaN(mapLevel)) {
      map.setLevel(mapLevel);
    }
  }

  return restoredCenter;
}

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
const weatherBadge = document.getElementById("weatherBadge");
const weatherIcon = document.getElementById("weatherIcon") || document.querySelector(".weather-icon");
const weatherTemp = document.getElementById("weatherTemp");
const weatherSummary = document.getElementById("weatherSummary");

let lastWeatherKey = "";

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
  cameraNavBtn.addEventListener("click", openReportPanelAtCurrentMap);
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
  keepCurrentMapView(() => {
    hideResultList();
    placeSheet.classList.add("hidden");
    filterPanel?.classList.add("hidden");
    favoritesPanel.classList.remove("hidden");
  });
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

  if (event.target.closest("#routePanelBackBtn")) {
    if (currentRouteData?.selectedRoute) {
      updateSelectedRouteSheet(currentRouteData.selectedRoute);
    } else {
      updatePlaceSheet();
    }
    openPlaceSheet();
    return;
  }

  const routeOption = event.target.closest(".route-option");
  if (routeOption && currentRouteData) {
    const route =
      currentRouteData.routes.find((item) => item.id === routeOption.dataset.routeId) ||
      currentRouteData.routes[0];
    if (route) {
      applyRouteSelection(currentRouteData, route);
    }
    return;
  }

  const inlineChip = event.target.closest(".inline-chip");
  if (inlineChip) {
    inlineChip
      .closest(".inline-chip-group")
      ?.querySelectorAll(".inline-chip")
      .forEach((chip) => chip.classList.remove("active"));
    inlineChip.classList.add("active");
    return;
  }

  if (event.target.closest("#inlineSubmitReportBtn")) {
    submitInlineReport();
    return;
  }

  if (event.target.closest("#placeReportBtn")) {
    if (selectedPlaceForRoute) {
      location.href = reportUrlForPlace(selectedPlaceForRoute);
    }
    return;
  }

  if (event.target.closest("#routeListBtn")) {
    if (!startPlace || !endPlace) {
      alert("출발지와 목적지를 모두 선택해주세요.");
      return;
    }

    openRouteListPanel();
    return;
  }

  const routeRoleButton = event.target.closest("[data-route-role]");
  if (routeRoleButton && selectedPlaceForRoute) {
    setRouteEndpoint(selectedPlaceForRoute, routeRoleButton.dataset.routeRole);
    return;
  }

  if (event.target.closest("#clearStartPlaceBtn")) {
    startPlace = null;
    if (startMarker) {
      startMarker.setMap(null);
      startMarker = null;
    }
    clearRoutePolylines();
    clearDangerZones();
    currentRouteData = null;
    updatePlaceSheet();
    openPlaceSheet();
    return;
  }

  if (event.target.closest("#clearEndPlaceBtn")) {
    endPlace = null;
    if (endMarker) {
      endMarker.setMap(null);
      endMarker = null;
    }
    clearRoutePolylines();
    clearDangerZones();
    currentRouteData = null;
    updatePlaceSheet();
    openPlaceSheet();
    return;
  }

  if (event.target.closest("#startRouteBtn")) {
    if (!startPlace || !endPlace) {
      alert("출발지와 목적지를 모두 선택해주세요.");
      return;
    }

    startNavigationTracking();
    openPlaceSheet();
  }
});

function openReportPage() {
  const targetPlace = endPlace || startPlace;

  if (!targetPlace) {
    alert("먼저 장소를 선택해주세요.");
    return;
  }

  location.href = reportUrlForPlace(targetPlace);
}

function reportUrlForPlace(place) {
  return (
    `report.html?v=20260830-accessibility` +
    `&name=${encodeURIComponent(place.place_name || place.name || "")}` +
    `&address=${encodeURIComponent(
      place.road_address_name || place.address_name || place.address || ""
    )}` +
    `&x=${place.x || place.lng}&y=${place.y || place.lat}`
  );
}

function openReportAtCurrentLocation() {
  if (currentLocationPosition) {
    location.href =
      "report.html?name=" +
      encodeURIComponent("현재 위치") +
      "&address=" +
      encodeURIComponent("현재 위치에서 제보") +
      `&x=${currentLocationPosition.getLng()}&y=${currentLocationPosition.getLat()}` +
      "&v=20260830-accessibility";
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
      location.href =
        "report.html?name=" +
        encodeURIComponent("현재 위치") +
        "&address=" +
        encodeURIComponent("현재 위치에서 제보") +
        `&x=${lng}&y=${lat}` +
        "&v=20260830-accessibility";
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

function openReportPanelAtCurrentMap() {
  keepCurrentMapView(() => {
    const center = map.getCenter();
    const lat = center.getLat();
    const lng = center.getLng();

    hideResultList();
    favoritesPanel?.classList.add("hidden");
    filterPanel?.classList.add("hidden");
    placeSheet?.classList.add("route-sheet");
    placeSheet?.classList.remove("route-list-sheet");

    panelContent.innerHTML = `
      <div class="report-panel-inline">
        <div class="report-panel-heading">
          <p class="sheet-label">위험 구간 제보</p>
          <h3>위험 구간 제보</h3>
          <p class="muted">현재 지도 위치 기준으로 제보합니다.</p>
        </div>

        <label class="inline-field-label" for="inlineReportLocation">위치</label>
        <input
          id="inlineReportLocation"
          class="inline-field"
          type="text"
          value="지도 중심 위치 (${lat.toFixed(6)}, ${lng.toFixed(6)})"
        />

        <label class="inline-field-label">제보 유형</label>
        <div class="inline-chip-group" id="inlineReportTypes">
          <button class="inline-chip active" type="button" data-type="급경사">급경사</button>
          <button class="inline-chip" type="button" data-type="계단">계단</button>
          <button class="inline-chip" type="button" data-type="장애물">장애물</button>
        </div>

        <label class="inline-field-label">휠체어 진입 정보</label>
        <div class="inline-chip-group" id="inlineAccessibilityTypes">
          <button class="inline-chip active" type="button" data-accessibility="unknown">확인 필요</button>
          <button class="inline-chip" type="button" data-accessibility="accessible">진입 가능</button>
          <button class="inline-chip" type="button" data-accessibility="not_accessible">진입 어려움</button>
        </div>

        <label class="inline-field-label" for="inlineReportDetail">상세 설명</label>
        <textarea
          id="inlineReportDetail"
          class="inline-field inline-textarea"
          placeholder="어떤 위험이 있었나요?"
        ></textarea>

        <label class="inline-field-label" for="inlineReportImage">사진 첨부</label>
        <label class="inline-upload-box" for="inlineReportImage" id="inlineReportUploadBox">
          사진 촬영 또는 앨범에서 선택
          <input id="inlineReportImage" type="file" accept="image/*" capture="environment" />
        </label>

        <button class="primary-btn inline-submit-btn" id="inlineSubmitReportBtn" type="button">
          제보하기
        </button>
      </div>
    `;

    const imageInput = document.getElementById("inlineReportImage");
    const uploadBox = document.getElementById("inlineReportUploadBox");

    imageInput?.addEventListener("change", () => {
      if (imageInput.files.length > 0) {
        uploadBox.childNodes[0].nodeValue = imageInput.files[0].name;
      }
    });

    openPlaceSheet();
  });
}

async function submitInlineReport() {
  const submitButton = document.getElementById("inlineSubmitReportBtn");
  const imageInput = document.getElementById("inlineReportImage");
  const locationInput = document.getElementById("inlineReportLocation");
  const detailInput = document.getElementById("inlineReportDetail");
  const center = map.getCenter();
  const selectedType =
    document.querySelector("#inlineReportTypes .inline-chip.active")?.dataset.type || "기타";
  const wheelchairAccess =
    document.querySelector("#inlineAccessibilityTypes .inline-chip.active")?.dataset.accessibility ||
    "unknown";
  const imageData = imageInput?.files?.[0]
    ? await readImageFileAsDataURL(imageInput.files[0])
    : "";

  submitButton.disabled = true;
  submitButton.textContent = "등록 중...";

  try {
    const response = await fetch("/api/accessibility-reports", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        placeName: locationInput?.value || "지도 중심 위치",
        address: locationInput?.value || "지도 중심 위치",
        x: center.getLng(),
        y: center.getLat(),
        type: selectedType,
        wheelchairAccess,
        detail: detailInput?.value || "",
        imageData,
      }),
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "제보 등록에 실패했습니다.");
    }

    alert("제보가 등록되었습니다. 관리자가 확인하면 장소 정보에 반영됩니다.");
    collapsePlaceSheet();
  } catch (error) {
    alert(error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "제보하기";
  }
}

function readImageFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("사진을 읽을 수 없습니다."));
    reader.readAsDataURL(file);
  });
}

function keepCurrentMapView(callback) {
  const center = map.getCenter();
  const level = map.getLevel();
  callback();
  map.setCenter(center);
  map.setLevel(level);
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
      showPlaceSelectionPanel(place);
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

function showPlaceSelectionPanel(place) {
  selectedPlaceForRoute = place;
  infoPanelState = "place-select";
  if (!panelContent) return;

  placeSheet?.classList.remove("route-list-sheet");
  placeSheet?.classList.add("route-sheet");

  panelContent.innerHTML = `
    <div class="place-select-panel">
      <p class="sheet-label">&#51109;&#49548; &#49440;&#53469;</p>
      <h3>${escapeHTML(place.place_name || "\uC774\uB984 \uC5C6\uC74C")}</h3>
      <p class="muted">${escapeHTML(place.road_address_name || place.address_name || "\uC8FC\uC18C \uC815\uBCF4 \uC5C6\uC74C")}</p>

      <div class="route-endpoint-summary">
        ${routeEndpointSummary()}
      </div>

      <div class="place-select-actions">
        <button class="secondary-btn" type="button" data-route-role="start">&#52636;&#48156;&#51648;&#47196;</button>
        <button class="primary-btn" type="button" data-route-role="end">&#47785;&#51201;&#51648;&#47196;</button>
      </div>
      <button class="report-link-btn place-report-btn" id="placeReportBtn" type="button">
        이 장소 제보하기
      </button>
    </div>
  `;

  openPlaceSheet();
}

function setRouteEndpoint(place, role) {
  if (role === "start") {
    startPlace = place;
    updateStartMarker(place);
  } else {
    endPlace = place;
    updateEndMarker(place);
  }

  selectedPlaceForRoute = null;
  currentRouteData = null;
  clearRoutePolylines();
  clearDangerZones();
  updatePlaceSheet();

  if (startPlace && endPlace) {
    document.body.classList.add("route-mode");
    openPlaceSheet();
    drawDefaultRouteFromSelection();
  } else {
    openPlaceSheet();
  }
}

function routeEndpointSummary() {
  return `
    <div class="route-endpoint-row">
      <span>&#52636;&#48156;</span>
      <strong>${escapeHTML(startPlace?.place_name || "\uC544\uC9C1 \uC120\uD0DD \uC548 \uD568")}</strong>
      ${startPlace ? '<button type="button" id="clearStartPlaceBtn">&#48320;&#44221;</button>' : ""}
    </div>
    <div class="route-endpoint-row">
      <span>&#46020;&#52265;</span>
      <strong>${escapeHTML(endPlace?.place_name || "\uC544\uC9C1 \uC120\uD0DD \uC548 \uD568")}</strong>
      ${endPlace ? '<button type="button" id="clearEndPlaceBtn">&#48320;&#44221;</button>' : ""}
    </div>
  `;
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

    syncRouteEndpoints(data, route);
    updateStartMarker(startPlace);
    updateEndMarker(endPlace);
    drawRoute({ path: route.path, colored: true });
    drawDangerZones(routeDangerZones(route));
    updateSelectedRouteSheet(route);
    updateRouteInfo({
      distance: route.distance,
      duration: route.duration * 60,
    });
    updateDangerCount(route.dangerCount);
    updateSafetyRatio(route);

    currentRouteData = {
      ...data,
      selectedRoute: route,
    };
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

    syncRouteEndpoints(data, route);
    updateStartMarker(startPlace);
    updateEndMarker(endPlace);
    drawRoute({ path: route.path, colored: true });
    drawDangerZones(routeDangerZones(route));
    updateSelectedRouteSheet(route);
    updateRouteInfo({
      distance: route.distance,
      duration: route.duration * 60,
    });
    updateDangerCount(route.dangerCount);
    updateSafetyRatio(route);
    currentRouteData = {
      ...data,
      selectedRoute: route,
    };
  } catch (error) {
    console.error("기본 경로 로딩 실패:", error);
    alert(error.message);
  }
}

async function openRouteListPanel() {
  try {
    let data = currentRouteData;

    if (!data?.routes?.length) {
      const response = await fetch(`/api/access-routes?${routeQueryParams()}`);
      data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "경로를 불러오지 못했습니다.");
      }
    }

    currentRouteData = {
      ...data,
      selectedRoute: data.selectedRoute || currentRouteData?.selectedRoute || data.routes[0],
    };
    renderRouteListPanel(currentRouteData);
    openPlaceSheet();
  } catch (error) {
    console.error("경로 목록 로딩 실패:", error);
    alert(error.message);
  }
}

function renderRouteListPanel(data) {
  infoPanelState = "route-list";
  if (!panelContent) return;
  placeSheet?.classList.add("route-sheet", "route-list-sheet");

  const routes = data.routes || [];
  const summaryTitle = `${data.destination?.name || endPlace?.place_name || "목적지"}까지 경로 ${routes.length}개`;
  const routeItems = routes
    .map((route) => {
      const selected = route.id === data.selectedRoute?.id ? " selected" : "";
      const danger = route.dangerCount ? " danger" : "";
      return `
        <button class="route-option${selected}${danger}" type="button" data-route-id="${escapeHTML(route.id)}">
          <span class="route-option-bar" aria-hidden="true"></span>
          <span class="route-option-body">
            <strong>${escapeHTML(route.title)}</strong>
            <span>${route.duration}분 · ${route.distance}m · 계단 ${route.features.stairs}개 · 경사로 ${route.features.ramps}개 · 횡단보도 ${route.features.crosswalks}개</span>
          </span>
        </button>
      `;
    })
    .join("");

  panelContent.innerHTML = `
    <button class="panel-back-button" id="routePanelBackBtn" type="button">← 경로로 돌아가기</button>
    <div class="route-list-panel-heading">
      <p class="sheet-label">경로 목록</p>
      <h3>${escapeHTML(summaryTitle)}</h3>
    </div>
    <div class="route-options">
      ${routeItems}
    </div>
  `;
}

function applyRouteSelection(data, route) {
  currentRouteData = {
    ...data,
    selectedRoute: route,
  };

  syncRouteEndpoints(data, route);
  updateStartMarker(startPlace);
  updateEndMarker(endPlace);
  drawRoute({ path: route.path, colored: true });
  drawDangerZones(routeDangerZones(route));
  updateSelectedRouteSheet(route);
  updateRouteInfo({
    distance: route.distance,
    duration: route.duration * 60,
  });
  updateDangerCount(route.dangerCount);
  updateSafetyRatio(route);
  document.body.classList.add("route-mode");
  openPlaceSheet();
}

function syncRouteEndpoints(data, route) {
  const path = route?.path || [];
  const routeStart = path[0];
  const routeEnd = path[path.length - 1];

  if (data.start) {
    startPlace = {
      ...startPlace,
      place_name: data.start.name || startPlace?.place_name || "",
      y: routeStart?.lat ?? data.start.lat,
      x: routeStart?.lng ?? data.start.lng,
      road_address_name: startPlace?.road_address_name || "",
      address_name: data.start.name || startPlace?.address_name || "",
    };
  }

  if (data.destination) {
    endPlace = {
      ...endPlace,
      place_name: data.destination.name || endPlace?.place_name || "",
      y: routeEnd?.lat ?? data.destination.lat,
      x: routeEnd?.lng ?? data.destination.lng,
      road_address_name: endPlace?.road_address_name || "",
      address_name: data.destination.name || endPlace?.address_name || "",
    };
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

function centerMapOnCurrentLocation({
  setStartPlace = true,
  updatePanel = true,
  collapsePanel = true,
  silentError = false,
} = {}) {
  const isLocalhost =
    location.hostname === "localhost" || location.hostname === "127.0.0.1";

  if (!window.isSecureContext && !isLocalhost) {
    if (!silentError) {
      alert("휴대폰 브라우저에서 현재 위치를 쓰려면 HTTPS 주소가 필요합니다.");
    }
    return;
  }

  if (!navigator.geolocation) {
    if (!silentError) {
      alert("현재 위치 기능을 지원하지 않는 브라우저입니다.");
    }
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const currentPosition = new kakao.maps.LatLng(lat, lng);

      if (setStartPlace) {
        startPlace = {
          place_name: "현재 위치",
          y: lat,
          x: lng,
          road_address_name: "",
          address_name: "현재 위치에서 출발",
        };
      }

      smoothMoveTo(currentPosition);

      setTimeout(() => {
        map.setLevel(3);
      }, 700);

      updateCurrentLocationMarker(lat, lng);

      if (updatePanel) {
        updatePlaceSheet();
      }

      if (collapsePanel) {
        collapsePlaceSheet();
      }
    },
    () => {
      if (!silentError) {
        alert("현재 위치를 가져올 수 없습니다. 위치 권한을 허용해주세요.");
      }
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }
  );
}

function moveToCurrentLocation() {
  centerMapOnCurrentLocation();
}

function startNavigationTracking() {
  if (!navigator.geolocation) {
    alert("현재 위치 기능을 지원하지 않습니다.");
    return;
  }

  // 이미 GPS 추적 중이라면 기존 추적 중지
  if (currentWatchId !== null) {
    navigator.geolocation.clearWatch(currentWatchId);
  }

  navigationMode = true;

  currentWatchId = navigator.geolocation.watchPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      const currentPosition = new kakao.maps.LatLng(lat, lng);

      // 현재 위치 저장
      currentLocationPosition = currentPosition;

      // 현재 위치 마커 이동
      updateCurrentLocationMarker(lat, lng);

      // 안내 중이라면 지도 중심도 현재 위치를 따라감
      if (navigationMode) {
        map.setCenter(currentPosition);
        map.setLevel(3);
      }

      lastNavigationPosition = currentPosition;

      console.log("현재 위치:", lat, lng);
    },

    (error) => {
      console.error("GPS 오류:", error);

      if (error.code === 1) {
        alert("위치 권한이 거부되었습니다.");
      } else if (error.code === 2) {
        alert("현재 위치를 확인할 수 없습니다.");
      } else if (error.code === 3) {
        console.warn("위치 확인 시간이 초과되었습니다.");
      }
    },

    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }
  );
}


// 길안내 중지
function stopNavigationTracking() {
  navigationMode = false;

  if (currentWatchId !== null) {
    navigator.geolocation.clearWatch(currentWatchId);
    currentWatchId = null;
  }

  lastNavigationPosition = null;

  console.log("길안내 종료");
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

  updateWeatherBadge(lat, lng);
}

async function updateWeatherBadge(lat, lng) {
  if (!weatherBadge || !weatherTemp || !weatherSummary) return;

  const weatherKey = `${Number(lat).toFixed(2)},${Number(lng).toFixed(2)}`;
  if (weatherKey === lastWeatherKey) return;
  lastWeatherKey = weatherKey;

  weatherBadge.classList.remove("hidden");
  weatherTemp.textContent = "--°";
  weatherSummary.textContent = "";
  if (weatherIcon) weatherIcon.textContent = "";

  try {
    const params = new URLSearchParams({ lat, lng });
    const response = await fetch(`/api/weather?${params.toString()}`);
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "날씨 정보를 불러오지 못했습니다.");
    }

    const weather = data.weather;
    const temp = weather.temperature;

    if (weatherIcon) weatherIcon.textContent = "";
    weatherTemp.textContent = temp === null ? "--°" : `${Math.round(temp)}°`;
    weatherSummary.textContent = "";
  } catch (error) {
    console.warn("Weather badge error:", error);
    weatherTemp.textContent = "--°";
    weatherSummary.textContent = "";
    if (weatherIcon) weatherIcon.textContent = "";
  }
}

function updatePlaceSheet() {
  if (startPlace && endPlace) {
    renderRoutePanel(`${endPlace.place_name}\uAE4C\uC9C0`, "");
  } else if (startPlace) {
    renderRoutePanel(
      `\uCD9C\uBC1C\uC9C0: ${startPlace.place_name}`,
      startPlace.road_address_name || startPlace.address_name || "\uC8FC\uC18C \uC815\uBCF4 \uC5C6\uC74C"
    );
  } else if (endPlace) {
    renderRoutePanel(
      `\uBAA9\uC801\uC9C0: ${endPlace.place_name}`,
      endPlace.road_address_name || endPlace.address_name || "\uC8FC\uC18C \uC815\uBCF4 \uC5C6\uC74C"
    );
  } else {
    renderRoutePanel("\uCD9C\uBC1C\uC9C0\uC640 \uBAA9\uC801\uC9C0\uB97C \uC120\uD0DD\uD574\uC8FC\uC138\uC694", "\uC7A5\uC18C\uB97C \uAC80\uC0C9\uD55C \uB4A4 \uCD9C\uBC1C\uC9C0 \uB610\uB294 \uBAA9\uC801\uC9C0\uB85C \uC9C0\uC815\uD560 \uC218 \uC788\uC5B4\uC694.");
  }
}

function renderRoutePanel(title, subtitle = "") {
  infoPanelState = "route";
  if (!panelContent) return;
  placeSheet?.classList.add("route-sheet");
  placeSheet?.classList.remove("route-list-sheet");

  const hasBothEndpoints = Boolean(startPlace && endPlace);
  const routeDetails = hasBothEndpoints
    ? `
      <div class="info-cards">
        <div class="info-card">
          <strong>-</strong>
          <span>&#50696;&#49345; &#49884;&#44036;</span>
        </div>
        <div class="info-card">
          <strong>-</strong>
          <span>&#44144;&#47532;</span>
        </div>
        <div class="info-card danger">
          <strong>-</strong>
          <span>&#50948;&#54744; &#44396;&#44036;</span>
        </div>
      </div>

      <div class="safety-bar">
        <div class="safe"></div>
        <div class="warn"></div>
      </div>

      <div class="safety-labels">
        <span>&#50504;&#51204;</span>
        <span>&#51452;&#51032;</span>
      </div>

      <div class="sheet-actions">
        <button class="secondary-btn" id="routeListBtn" type="button">&#44221;&#47196; &#47785;&#47197;</button>
        <button class="primary-btn" id="startRouteBtn" type="button">&#50504;&#45236; &#49884;&#51089;</button>
      </div>
    `
    : `
      <div class="route-next-step">
        <p>${startPlace ? "\uBAA9\uC801\uC9C0\uB97C \uAC80\uC0C9\uD574\uC11C \uC120\uD0DD\uD574\uC8FC\uC138\uC694." : "\uCD9C\uBC1C\uC9C0\uB97C \uAC80\uC0C9\uD574\uC11C \uC120\uD0DD\uD574\uC8FC\uC138\uC694."}</p>
      </div>
    `;

  panelContent.innerHTML = `
    <p class="sheet-label">&#44221;&#47196; &#49444;&#51221;</p>
    <h3 id="placeName">${escapeHTML(title)}</h3>
    <p id="placeAddress" class="muted">${escapeHTML(subtitle)}</p>

    <div class="route-endpoint-summary compact">
      ${routeEndpointSummary()}
    </div>

    ${routeDetails}
  `;
}

function renderNearbyPanel(places, keyword = "주변") {
  infoPanelState = "nearby";
  nearbyPanelPlaces = places;
  nearbyPanelKeyword = keyword;
  if (!panelContent) return;
  placeSheet?.classList.remove("route-sheet", "route-list-sheet");

  const cards = places
    .map((place, index) => {
      const category = placeCategory(place);
      return `
        <article class="nearby-place-card" data-index="${index}">
          ${nearbyPhotoMarkup(index, "list")}
          <div class="nearby-place-body">
            <div class="nearby-title-row">
              <h4>${escapeHTML(place.place_name || "이름 없음")}</h4>
              <span>${escapeHTML(category)}</span>
            </div>
            <p>${escapeHTML(formatPlaceDistance(place))}</p>
            <p class="nearby-accessibility" data-accessibility-index="${index}">${escapeHTML(accessibilityLabel(place))}</p>
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

  loadNearbyPlacePhotos(places);
  loadNearbyAccessibility(places);
}

function showNearbyPlaceDetail(place) {
  infoPanelState = "detail";
  selectedPlaceForRoute = place;
  if (!panelContent) return;
  placeSheet?.classList.remove("route-sheet", "route-list-sheet");

  const position = new kakao.maps.LatLng(place.y, place.x);
  smoothMoveTo(position);

  if (place._marker) {
    place._marker.setMap(map);
  }

  panelContent.innerHTML = `
    <button class="panel-back-button" id="nearbyBackBtn" type="button">← 목록</button>
    ${nearbyPhotoMarkup(0, "detail")}
    <div class="nearby-detail">
      <p class="sheet-label">${escapeHTML(placeCategory(place))}</p>
      <h3>${escapeHTML(place.place_name || "이름 없음")}</h3>
      <p class="muted">${escapeHTML(place.road_address_name || place.address_name || "주소 정보 없음")}</p>
      <div class="nearby-detail-meta">
        <span>${escapeHTML(formatPlaceDistance(place))}</span>
        <span data-accessibility-detail>${escapeHTML(accessibilityLabel(place))}</span>
      </div>
      <div class="route-endpoint-summary">
        ${routeEndpointSummary()}
      </div>
      <div class="place-select-actions">
        <button class="secondary-btn" type="button" data-route-role="start">&#52636;&#48156;&#51648;&#47196;</button>
        <button class="primary-btn" type="button" data-route-role="end">&#47785;&#51201;&#51648;&#47196;</button>
      </div>
      <button class="report-link-btn place-report-btn" id="placeReportBtn" type="button">
        이 장소 제보하기
      </button>
    </div>
  `;

  loadPlacePhoto(place, panelContent.querySelector("[data-photo-target]"), "detail");
  loadPlaceAccessibility(place, panelContent.querySelector("[data-accessibility-detail]"));
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
  if (place?.accessibilityStatus) {
    return accessibilityTextFromStatus(place.accessibilityStatus);
  }

  return "휠체어 진입 정보 확인 필요";
}

function accessibilityTextFromStatus(status) {
  if (status === "accessible") return "휠체어 진입 가능";
  if (status === "not_accessible") return "휠체어 진입 어려움";
  return "휠체어 진입 정보 확인 필요";
}

function nearbyPhotoMarkup(index, variant = "list") {
  const className = variant === "detail" ? "nearby-detail-photo" : "nearby-photo";
  return `
    <div class="${className} nearby-photo-placeholder" data-photo-target data-photo-index="${index}" aria-hidden="true">
      <span></span>
    </div>
  `;
}

function loadNearbyPlacePhotos(places) {
  places.forEach((place, index) => {
    const target = panelContent?.querySelector(`[data-photo-index="${index}"]`);
    loadPlacePhoto(place, target, "list");
  });
}

function loadNearbyAccessibility(places) {
  places.forEach((place, index) => {
    const target = panelContent?.querySelector(`[data-accessibility-index="${index}"]`);
    loadPlaceAccessibility(place, target);
  });
}

async function loadPlaceAccessibility(place, target) {
  if (!target || !place) return;

  const params = new URLSearchParams({
    name: place.place_name || place.name || "",
    address: place.road_address_name || place.address_name || place.address || "",
    lat: place.y || place.lat || "",
    lng: place.x || place.lng || "",
  });

  try {
    const response = await fetch(`/api/place-accessibility?${params.toString()}`);
    const data = await response.json();

    if (!response.ok || !data.ok) return;

    place.accessibilityStatus = data.status;
    target.textContent = data.label || accessibilityTextFromStatus(data.status);
    target.classList.toggle("is-verified", Boolean(data.verified));
  } catch (error) {
    console.warn("Failed to load accessibility status:", error);
  }
}

async function loadPlacePhoto(place, target, variant = "list") {
  if (!target || !place) return;

  const params = new URLSearchParams({
    name: place.place_name || "",
    address: place.road_address_name || place.address_name || "",
    lat: place.y || "",
    lng: place.x || "",
    maxWidthPx: variant === "detail" ? "720" : "360",
  });

  try {
    const response = await fetch(`/api/place-photo?${params.toString()}`);
    const data = await response.json();

    if (!response.ok || !data.ok || !data.photoUri) {
      target.classList.add("no-photo");
      return;
    }

    const img = document.createElement("img");
    img.src = data.photoUri;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";

    target.replaceChildren(img);
    const attribution = googlePhotoAttribution(data.attributions);
    if (attribution) {
      target.insertAdjacentHTML("beforeend", attribution);
    }
    target.classList.remove("nearby-photo-placeholder", "no-photo");
    target.classList.add("has-photo");
  } catch (error) {
    console.warn("Failed to load place photo:", error);
    target.classList.add("no-photo");
  }
}

function googlePhotoAttribution(attributions = []) {
  const names = attributions
    .map((item) => item.displayName)
    .filter(Boolean)
    .slice(0, 2);

  if (!names.length) return "";

  return `<span class="photo-attribution">${escapeHTML(names.join(", "))}</span>`;
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

  if (types.includes("stair") || types.includes("danger")) {
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

function routeDangerZones(route) {
  if (Array.isArray(route?.dangerZones) && route.dangerZones.length) {
    return route.dangerZones;
  }

  return dangerZonesFromRoute(route?.path || []);
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
  const timeText = minutes > 0 ? `${minutes}\uBD84` : "-";

  const timeCard = document.querySelector(".info-card:nth-child(1) strong");
  const distanceCard = document.querySelector(".info-card:nth-child(2) strong");

  if (timeCard) timeCard.innerText = timeText;
  if (distanceCard) distanceCard.innerText = distanceText;
}

function updateDangerCount(count) {
  const dangerCard = document.querySelector(".info-card:nth-child(3) strong");

  if (dangerCard) {
    dangerCard.innerText = `${count}\uACF3`;
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
