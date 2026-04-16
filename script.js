const container = document.getElementById('map');

const options = {
  center: new kakao.maps.LatLng(37.56184, 127.03811),
  level: 3
};

const map = new kakao.maps.Map(container, options);