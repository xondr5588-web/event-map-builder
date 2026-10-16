export const CATALOG = {
  area: {
    parking: ["주차장", "#23956e", "parking"],
    event: ["행사장", "#e88332", "stage"],
    vip: ["관계자 주차장", "#b59324", "star"],
    other: ["기타 구역", "#7c64c4", "area"],
    restricted: ["통제 구역", "#bc4359", "shield"],
    pedestrianZone: ["보행 안전구역", "#387dc5", "walk"],
  },
  line: {
    vehicle: ["차량 동선", "#e77c29", "car"],
    pedestrian: ["보행자 동선", "#3777cc", "walk"],
    oneway: ["일방통행", "#dc4c54", "arrow"],
    cone: ["라바콘", "#e88125", "cone"],
    tape: ["안전띠", "#d4a900", "tape"],
    block: ["차량 진입금지 / 차단선", "#d74848", "block"],
    route: ["기타 동선", "#8e60b8", "line"],
    measure: ["거리 측정", "#536a80", "ruler"],
    emergency: ["긴급차량 동선", "#cf4454", "medical"],
    accessible: ["교통약자 동선", "#3276aa", "walk"],
  },
  marker: {
    parkingStaff: ["주차관리원", "#cf782f", "staff"],
    safetyStaff: ["안전요원", "#365a7d", "shield"],
    carIn: ["차량 진입(IN)", "#279b72", "in"],
    carOut: ["차량 출차(OUT)", "#c9463b", "out"],
    control: ["통제지점", "#dc4c54", "block"],
    vipGate: ["관계자 입구", "#8660bc", "star"],
    gateIn: ["주차장 IN", "#177c57", "in"],
    gateOut: ["주차장 OUT", "#c9463b", "out"],
    stage: ["무대", "#7462b8", "stage"],
    booth: ["행사부스", "#d67e37", "stage"],
    medical: ["응급의료", "#328362", "medical"],
    info: ["안내소", "#3777cc", "info"],
    toilet: ["화장실", "#53788c", "people"],
    police: ["경찰부스", "#0054a6", "shield"],
    fire: ["소방 대기소", "#d34b32", "shield"],
    command: ["운영본부", "#385d78", "info"],
    assembly: ["비상 집결지", "#23845a", "people"],
    shuttle: ["셔틀 승하차장", "#4176b4", "car"],
    guideStaff: ["안내요원", "#8c6bb3", "staff"],
  },
};
export const TYPE_LABELS = { area: "구역", line: "동선", marker: "마커" };
export const kindInfo = (o) =>
  CATALOG[o.type]?.[o.kind] || [
    o.kind || TYPE_LABELS[o.type],
    "#526b83",
    "pin",
  ];
export const DEFAULT_VIEW = {
  center: { lat: 35.2017194, lng: 128.2259361 },
  zoom: 16,
  type: "hybrid",
};
