import { clone } from "./model.js";
import { clamp, world, unworld, validCoord } from "./geometry.js";
export const MAP_CLIENT_ID =
  import.meta.env?.VITE_NAVER_MAP_CLIENT_ID || "b4anccamja";
export const PLACE_URL = import.meta.env?.VITE_PLACE_SEARCH_URL || "";
export class MapAdapter {
  constructor(element, view, onChange, onStatus) {
    this.el = element;
    this.view = clone(view);
    this.onChange = onChange;
    this.onStatus = onStatus;
    this.online = false;
    this.listeners = [];
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(element);
  }
  get size() {
    return { width: this.el.clientWidth, height: this.el.clientHeight };
  }
  fail(message) {
    this.online = false;
    for (const listener of this.listeners)
      window.naver?.maps?.Event.removeListener(listener);
    this.listeners = [];
    this.map?.destroy?.();
    this.map = null;
    this.el.replaceChildren();
    this.onStatus("error", message);
    this.onChange();
  }
  async start() {
    if (new URLSearchParams(location.search).get("map") === "offline") {
      this.onStatus("offline", "오프라인 도면 · 배경지도 없음");
      return;
    }
    if (!navigator.onLine) {
      this.onStatus("offline", "오프라인 · 연결 후 지도 다시 시도");
      return;
    }
    try {
      await this.loadSDK();
      if (this.destroyed) return;
      const n = window.naver.maps;
      this.map = new n.Map(this.el, {
        center: new n.LatLng(this.view.center.lat, this.view.center.lng),
        zoom: this.view.zoom,
        mapTypeId: this.typeId(this.view.type),
        draggable: false,
        pinchZoom: false,
        scrollWheel: false,
        disableDoubleClickZoom: true,
        disableKineticPan: true,
        keyboardShortcuts: false,
        zoomControl: false,
        mapTypeControl: false,
        scaleControl: true,
        logoControl: true,
        mapDataControl: true,
      });
      if (this.authError) throw this.authError;
      this.online = true;
      this.onStatus("online", "네이버 지도");
      for (const event of ["bounds_changed", "idle", "zoom_changed"])
        this.listeners.push(
          n.Event.addListener(this.map, event, () => {
            this.syncView();
            this.onChange();
          }),
        );
      this.onChange();
    } catch (e) {
      if (!this.destroyed) this.fail(e.message);
    }
  }
  async loadSDK() {
    this.authError = null;
    window.navermap_authFailure = () => {
      this.authError = new Error(
        "네이버 지도 인증 실패 · 허용 도메인과 API 키를 확인하세요.",
      );
      this.rejectSDK?.(this.authError);
      if (!this.destroyed) this.fail(this.authError.message);
    };
    const load = (file, ready) =>
      new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.rejectSDK = null;
          error ? reject(error) : resolve();
        };
        const timer = setTimeout(
          () =>
            finish(
              new Error(
                "지도를 불러오지 못했습니다. 네트워크와 API 설정을 확인하세요.",
              ),
            ),
          12000,
        );
        this.rejectSDK = finish;
        document.querySelector(`script[data-naver-sdk="${file}"]`)?.remove();
        const script = document.createElement("script");
        script.dataset.naverSdk = file;
        script.src = `https://oapi.map.naver.com/openapi/v3/${file}${file === "maps.js" ? "?ncpKeyId=" + encodeURIComponent(MAP_CLIENT_ID) : ""}`;
        script.onload = () =>
          finish(
            this.authError ||
              (ready()
                ? null
                : new Error("지도 모듈을 초기화하지 못했습니다.")),
          );
        script.onerror = () =>
          finish(
            new Error(
              "지도 연결 실패 · 오프라인 도면에서 작업을 계속할 수 있습니다.",
            ),
          );
        document.head.append(script);
      });
    // Load sequentially: dynamically injected submodules can otherwise rely on document.write.
    if (!window.naver?.maps?.Map)
      await load("maps.js", () => !!window.naver?.maps?.Map);
    if (this.authError) throw this.authError;
    if (!window.naver?.maps?.Service)
      await load("maps-geocoder.js", () => !!window.naver?.maps?.Service);
  }
  typeId(type) {
    const n = window.naver.maps;
    return (
      {
        normal: n.MapTypeId.NORMAL,
        satellite: n.MapTypeId.SATELLITE,
        hybrid: n.MapTypeId.HYBRID,
        terrain: n.MapTypeId.TERRAIN,
      }[type] || n.MapTypeId.HYBRID
    );
  }
  syncView() {
    if (this.map) {
      const c = this.map.getCenter();
      this.view.center = { lat: c.lat(), lng: c.lng() };
      this.view.zoom = this.map.getZoom();
    }
  }
  project(p) {
    if (this.online && this.map?.getProjection()) {
      const projection = this.map.getProjection();
      const q = projection.fromCoordToOffset(
        new window.naver.maps.LatLng(p.lat, p.lng),
      );
      const origin = projection.fromCoordToOffset(this.map.getCenter());
      // SDK offsets belong to its movable overlay pane; our SVG is in the fixed viewport.
      return {
        x: q.x - origin.x + this.size.width / 2,
        y: q.y - origin.y + this.size.height / 2,
      };
    }
    const a = world(p, this.view.zoom),
      b = world(this.view.center, this.view.zoom),
      s = this.size;
    return { x: a.x - b.x + s.width / 2, y: a.y - b.y + s.height / 2 };
  }
  unproject(p) {
    if (this.online && this.map?.getProjection()) {
      const projection = this.map.getProjection();
      const origin = projection.fromCoordToOffset(this.map.getCenter());
      const q = projection.fromOffsetToCoord(
        new window.naver.maps.Point(
          p.x - this.size.width / 2 + origin.x,
          p.y - this.size.height / 2 + origin.y,
        ),
      );
      return { lat: q.lat(), lng: q.lng() };
    }
    const b = world(this.view.center, this.view.zoom),
      s = this.size;
    return unworld(
      { x: p.x + b.x - s.width / 2, y: p.y + b.y - s.height / 2 },
      this.view.zoom,
    );
  }
  setView(view) {
    this.view = clone(view);
    if (this.online) {
      const n = window.naver.maps;
      const typeId = this.typeId(view.type);
      if (this.map.getMapTypeId() !== typeId) this.map.setMapTypeId(typeId);
      if (this.map.getZoom() !== view.zoom) this.map.setZoom(view.zoom, false);
      this.map.setCenter(new n.LatLng(view.center.lat, view.center.lng));
    }
    this.onChange();
  }
  moveTo(center, zoom = this.view.zoom) {
    if (!validCoord(center)) return;
    this.setView({
      ...this.view,
      center,
      zoom: clamp(Math.round(zoom), 6, 21),
    });
  }
  panPixels(dx, dy) {
    const s = this.size;
    this.moveTo(this.unproject({ x: s.width / 2 - dx, y: s.height / 2 - dy }));
  }
  zoom(delta, anchor) {
    const p = anchor || { x: this.size.width / 2, y: this.size.height / 2 },
      before = this.unproject(p);
    this.moveTo(this.view.center, this.view.zoom + delta);
    const after = this.project(before);
    this.panPixels(p.x - after.x, p.y - after.y);
  }
  fit(points, padding = 80) {
    if (!points.length) return;
    let minLat = 90,
      maxLat = -90,
      minLng = 180,
      maxLng = -180;
    for (const p of points) {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lng);
      maxLng = Math.max(maxLng, p.lng);
    }
    const c = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 },
      s = this.size;
    let z = 19;
    for (; z > 6; z--) {
      const a = world({ lat: minLat, lng: minLng }, z),
        b = world({ lat: maxLat, lng: maxLng }, z);
      if (
        Math.abs(a.x - b.x) <= Math.max(100, s.width - padding * 2) &&
        Math.abs(a.y - b.y) <= Math.max(100, s.height - padding * 2)
      )
        break;
    }
    this.moveTo(c, z);
  }
  resize() {
    if (this.online) {
      const s = this.size;
      this.map.setSize(new window.naver.maps.Size(s.width, s.height));
    }
    this.onChange();
  }
  async search(query) {
    const coordinate = query.match(
      /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/,
    );
    if (coordinate) {
      const p = { lat: +coordinate[1], lng: +coordinate[2] };
      if (!validCoord(p)) throw new Error("좌표 범위를 확인하세요.");
      return [{ title: "입력한 좌표", address: query, position: p }];
    }
    if (!this.online || !window.naver?.maps?.Service)
      throw new Error("주소 검색에는 인터넷과 네이버 지도 연결이 필요합니다.");
    const address = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("주소 검색 응답이 지연되고 있습니다.")),
        10000,
      );
      window.naver.maps.Service.geocode({ query }, (status, r) => {
        clearTimeout(timer);
        if (status !== window.naver.maps.Service.Status.OK) {
          reject(
            new Error("주소 검색 실패 · Geocoding API 설정을 확인하세요."),
          );
          return;
        }
        resolve(
          (r.v2?.addresses || [])
            .map((a) => ({
              title: a.roadAddress || a.jibunAddress,
              address: a.jibunAddress,
              position: { lat: Number(a.y), lng: Number(a.x) },
            }))
            .filter((x) => validCoord(x.position)),
        );
      });
    });
    if (!PLACE_URL) return address;
    const places = fetch(
      `${PLACE_URL}${PLACE_URL.includes("?") ? "&" : "?"}query=${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(10000), credentials: "omit" },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error("장소 검색 서버에 연결할 수 없습니다.");
        return r.json();
      })
      .then((data) =>
        (data.items || [])
          .map((a) => ({
            title: String(a.title).replace(/<[^>]*>/g, ""),
            address: a.roadAddress || a.address,
            position: a.position || {
              lat: Number(a.mapy) / 1e7,
              lng: Number(a.mapx) / 1e7,
            },
          }))
          .filter((x) => validCoord(x.position)),
      );
    const results = await Promise.allSettled([places, address]),
      items = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    if (!items.length && results.every((r) => r.status === "rejected"))
      throw results[0].reason;
    return items.slice(0, 12);
  }
  destroy() {
    this.destroyed = true;
    this.rejectSDK?.(new Error("지도 연결을 다시 시작합니다."));
    this.online = false;
    this.observer.disconnect();
    for (const l of this.listeners) window.naver.maps.Event.removeListener(l);
    this.listeners = [];
    this.map?.destroy?.();
  }
}
