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


function clearSearchMarkers() {
  markers.forEach((marker) => marker.setMap(null));
  markers = [];
}
