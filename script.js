<<<<<<< HEAD
const container = document.getElementById("map");
const options = {
  center: new kakao.maps.LatLng(37.56184, 127.03811),
  level: 3,
};

const map = new kakao.maps.Map(container, options);
const placesService = new kakao.maps.services.Places();

let markers = [];
let selectedPlace = null;

const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const resultList = document.getElementById("resultList");
const placeSheet = document.getElementById("placeSheet");
const placeName = document.getElementById("placeName");
const placeAddress = document.getElementById("placeAddress");
const startRouteBtn = document.getElementById("startRouteBtn");
const reportBtn = document.getElementById("reportBtn");
const routeListBtn = document.getElementById("routeListBtn");
const chipButtons = document.querySelectorAll(".chip");

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

startRouteBtn.addEventListener("click", () => {
  if (!selectedPlace) {
    alert("먼저 장소를 선택해주세요.");
    return;
  }

  location.href =
    `route.html?name=${encodeURIComponent(selectedPlace.place_name)}` +
    `&address=${encodeURIComponent(selectedPlace.road_address_name || selectedPlace.address_name || "")}` +
    `&x=${selectedPlace.x}&y=${selectedPlace.y}`;
});

reportBtn.addEventListener("click", () => {
  if (!selectedPlace) {
    alert("먼저 장소를 선택해주세요.");
    return;
  }

  location.href =
    `report.html?name=${encodeURIComponent(selectedPlace.place_name)}` +
    `&address=${encodeURIComponent(selectedPlace.road_address_name || selectedPlace.address_name || "")}` +
    `&x=${selectedPlace.x}&y=${selectedPlace.y}`;
});

routeListBtn.addEventListener("click", () => {
  if (!selectedPlace) {
    alert("먼저 장소를 선택해주세요.");
    return;
  }

  alert(`${selectedPlace.place_name}까지의 경로 목록을 여기에 연결하면 됩니다.`);
});

function searchPlaces(keyword) {
  placesService.keywordSearch(keyword, (data, status) => {
    if (status !== kakao.maps.services.Status.OK) {
      alert("검색 결과가 없습니다.");
      hideResultList();
      return;
    }

    clearMarkers();
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
      map.setCenter(new kakao.maps.LatLng(place.y, place.x));
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
  selectedPlace = place;

  placeName.textContent = place.place_name;
  placeAddress.textContent =
    place.road_address_name || place.address_name || "주소 정보 없음";

  placeSheet.classList.remove("hidden");
}

function clearMarkers() {
  markers.forEach((marker) => marker.setMap(null));
  markers = [];
=======
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
let selectingMode = "end"; // 기본은 목적지 선택
let currentPolyline = null;
let dangerCircles = [];
let startMarker = null;
let endMarker = null;

const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const resultList = document.getElementById("resultList");
const placeSheet = document.getElementById("placeSheet");
const placeName = document.getElementById("placeName");
const placeAddress = document.getElementById("placeAddress");
const startRouteBtn = document.getElementById("startRouteBtn");
const reportBtn = document.getElementById("reportBtn");
const routeListBtn = document.getElementById("routeListBtn");
const chipButtons = document.querySelectorAll(".chip");
const sheetLabel = document.getElementById("sheetLabel");

// 출발지/목적지 모드 버튼
const startModeBtn = document.getElementById("startModeBtn");
const endModeBtn = document.getElementById("endModeBtn");

if (startModeBtn) {
  startModeBtn.addEventListener("click", () => setMode("start"));
}

if (endModeBtn) {
  endModeBtn.addEventListener("click", () => setMode("end"));
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

startRouteBtn.addEventListener("click", async () => {
  if (!startPlace || !endPlace) {
    alert("출발지와 목적지를 모두 선택해주세요.");
    return;
  }

  try {
    const res = await fetch("/api/walking-route", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        origin: { x: startPlace.x, y: startPlace.y },
        destination: { x: endPlace.x, y: endPlace.y },
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(data.message || "경로를 불러오지 못했습니다.");
    }

    drawRoute(data);
    drawDangerZones(data.dangerZones || []);
    updateRouteInfo(data.summary || {});
    updateDangerCount(data.dangerCount || 0);

    placeName.textContent = `${startPlace.place_name} → ${endPlace.place_name}`;
    placeAddress.textContent =
      endPlace.road_address_name || endPlace.address_name || "주소 정보 없음";

    placeSheet.classList.remove("hidden");
  } catch (error) {
    console.error(error);
    alert("경로 안내를 불러오지 못했습니다.");
  }
});

reportBtn.addEventListener("click", () => {
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
});

routeListBtn.addEventListener("click", () => {
  if (!startPlace || !endPlace) {
    alert("출발지와 목적지를 모두 선택해주세요.");
    return;
  }

  alert(
    `출발지: ${startPlace.place_name}\n목적지: ${endPlace.place_name}\n경로 목록 기능은 여기에 이어서 붙이면 됩니다.`
  );
});

function setMode(mode) {
  selectingMode = mode;

  if (startModeBtn) {
    startModeBtn.classList.toggle("active", mode === "start");
  }

  if (endModeBtn) {
    endModeBtn.classList.toggle("active", mode === "end");
  }
}

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
        map.setCenter(position);
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
      map.setCenter(new kakao.maps.LatLng(place.y, place.x));
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
  if (selectingMode === "start") {
    startPlace = place;
    updateStartMarker(place);

    if (sheetLabel) {
      sheetLabel.textContent = "선택된 출발지";
    }

    alert(`출발지 설정: ${place.place_name}`);
  } else {
    endPlace = place;
    updateEndMarker(place);

    if (sheetLabel) {
      sheetLabel.textContent = "선택된 목적지";
    }

    alert(`목적지 설정: ${place.place_name}`);
  }

  updatePlaceSheet();
}

function updatePlaceSheet() {
  const shownPlace = endPlace || startPlace;

  if (!shownPlace) return;

  placeName.textContent = shownPlace.place_name;
  placeAddress.textContent =
    shownPlace.road_address_name || shownPlace.address_name || "주소 정보 없음";

  placeSheet.classList.remove("hidden");
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

function updateRouteInfo(summary) {
  const distance = Number(summary.distance || 0);
  const duration = Number(summary.duration || 0);

  const distanceText =
    distance < 1000 ? `${distance}m` : `${(distance / 1000).toFixed(1)}km`;

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
>>>>>>> 794e803 (init)
}