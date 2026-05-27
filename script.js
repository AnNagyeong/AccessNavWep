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
let dangerCircles = [];
let startMarker = null;
let endMarker = null;
let currentLocationMarker = null;
let currentWatchId = null;
let kioskMakers = [] ;

const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const resultList = document.getElementById("resultList");

const placeSheet = document.getElementById("placeSheet");
const placeName = document.getElementById("placeName");
const placeAddress = document.getElementById("placeAddress");
const sheetHandle = document.getElementById("sheetHandle");

const startRouteBtn = document.getElementById("startRouteBtn");
const reportBtn = document.getElementById("reportBtn");
const routeListBtn = document.getElementById("routeListBtn");

const chipButtons = document.querySelectorAll(".chip");

const favoriteBtn = document.getElementById("favoriteBtn");
const filterBtn = document.getElementById("filterBtn");
const currentLocationBtn = document.getElementById("currentLocationBtn");
const filterPanel = document.getElementById("filterPanel");
const closeFilterBtn = document.getElementById("closeFilterBtn");

const loginNavBtn = document.getElementById("loginNavBtn");
const cameraNavBtn = document.getElementById("cameraNavBtn");
const bookmarkNavBtn = document.getElementById("bookmarkNavBtn");

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
    searchPlaces(keyword);
  });
});

if (currentLocationBtn) {
  currentLocationBtn.addEventListener("click", moveToCurrentLocation);
}

if (favoriteBtn) {
  favoriteBtn.addEventListener("click", openFavoritesPage);
}

function openFavoritesPage() {
  location.href = "favorites.html";
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


startRouteBtn.addEventListener("click", async () => {
  if (!startPlace || !endPlace) {
    alert("출발지와 목적지를 모두 선택해주세요.");
    return;
  }

  try {
    const res = await fetch(
      `/api/walking-route?ox=${startPlace.x}&oy=${startPlace.y}&dx=${endPlace.x}&dy=${endPlace.y}`
    );

    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(data.error || data.message || `서버 오류 (${res.status})`);
    }

    drawRoute(data);
    drawDangerZones(data.dangerZones || []);
    updateRouteInfo(data.summary || {});
    updateDangerCount(data.dangerCount || 0);
    updatePlaceSheet();
    openPlaceSheet();
  } catch (error) {
    console.error("경로 요청 실패:", error);
    alert(error.message);
  }
});

reportBtn.addEventListener("click", openReportPage);

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

routeListBtn.addEventListener("click", () => {
  if (!startPlace || !endPlace) {
    alert("출발지와 목적지를 모두 선택해주세요.");
    return;
  }

  alert(`출발지: ${startPlace.place_name}\n목적지: ${endPlace.place_name}`);
});

function searchPlaces(keyword) {
  placesService.keywordSearch(keyword, (data, status) => {
    if (status !== kakao.maps.services.Status.OK) {
      alert("검색 결과가 없습니다.");
      hideResultList();
      return;
    }

    clearSearchMarkers();
    renderResultList(data);

    const bounds = new kakao.maps.LatLngBounds();

    data.forEach((place) => {
      const position = new kakao.maps.LatLng(place.y, place.x);

      const marker = new kakao.maps.Marker({
        map,
        position,
      });

      markers.push(marker);
      bounds.extend(position);

      kakao.maps.event.addListener(marker, "click", () => {
        selectPlace(place);
        smoothMoveTo(position);
        hideResultList();
      });
    });

    map.setBounds(bounds);
  });
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
    alert(`목적지 설정: ${place.place_name}`);
  } else {
    endPlace = place;
    updateEndMarker(place);
    alert(`목적지 변경: ${place.place_name}`);
  }

  updatePlaceSheet();
  openPlaceSheet();
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
      openPlaceSheet();
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
    placeName.textContent = `${startPlace.place_name} → ${endPlace.place_name}`;
    placeAddress.textContent =
      `출발: ${startPlace.road_address_name || startPlace.address_name || "주소 정보 없음"} / 도착: ${
        endPlace.road_address_name || endPlace.address_name || "주소 정보 없음"
      }`;
  } else if (startPlace) {
    placeName.textContent = `출발지: ${startPlace.place_name}`;
    placeAddress.textContent =
      startPlace.road_address_name || startPlace.address_name || "주소 정보 없음";
  } else {
    placeName.textContent = `목적지: ${endPlace.place_name}`;
    placeAddress.textContent =
      endPlace.road_address_name || endPlace.address_name || "주소 정보 없음";
  }
}

function openPlaceSheet() {
  placeSheet.classList.remove("hidden");
  placeSheet.classList.remove("collapsed");
  placeSheet.classList.add("expanded");
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
  const path = (data.path || []).map(
    (p) => new kakao.maps.LatLng(p.lat, p.lng)
  );

  if (!path.length) {
    alert("경로 좌표가 없습니다.");
    return;
  }

  if (currentPolyline) {
    currentPolyline.setMap(null);
  }

  currentPolyline = new kakao.maps.Polyline({
    path,
    strokeWeight: 5,
    strokeColor: "#48d10f",
    strokeOpacity: 0.9,
    strokeStyle: "solid",
  });

  currentPolyline.setMap(map);

  const bounds = new kakao.maps.LatLngBounds();
  path.forEach((point) => bounds.extend(point));
  map.setBounds(bounds);
}

function drawDangerZones(zones) {
  dangerCircles.forEach((circle) => circle.setMap(null));
  dangerCircles = [];

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
  markers.forEach((marker) => marker.setMap(null));
  markers = [];
}
