import assets from "virtual:field-assets";
import { api } from "./api.js";
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) return await api(request, env);
      if (!["GET", "HEAD"].includes(request.method))
        return new Response("Method not allowed", { status: 405 });
      const key = url.pathname === "/" ? "/index.html" : url.pathname,
        asset = assets[key];
      if (!asset) return new Response("Not found", { status: 404 });
      const bytes = Uint8Array.from(atob(asset.data), (c) => c.charCodeAt(0));
      return new Response(request.method === "HEAD" ? null : bytes, {
        headers: {
          "Content-Type": asset.type,
          "Cache-Control":
            key === "/index.html" ||
            key === "/sw.js" ||
            key === "/access-check.json"
              ? "no-store"
              : "private, max-age=3600",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "strict-origin-when-cross-origin",
        },
      });
    } catch {
      return new Response(
        JSON.stringify({
          error: "서버에 연결하지 못했습니다. 기기 저장본은 유지됩니다.",
        }),
        {
          status: 503,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        },
      );
    }
  },
};
