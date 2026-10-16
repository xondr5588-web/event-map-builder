export const PRIVATE_MODE = import.meta.env?.MODE === "private";

// The hosting gateway owns authorization. This uncached request also prevents
// a previously cached app shell from loading maps after its session expires.
export async function verifyPrivateAccess({
  enabled = PRIVATE_MODE,
  fetcher = globalThis.fetch,
  baseURL = globalThis.document?.baseURI,
} = {}) {
  if (!enabled) return;
  const url = new URL("./access-check.json", baseURL);
  url.searchParams.set("check", `${Date.now()}-${Math.random()}`);
  const response = await fetcher(url, {
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
  });
  if (
    !response.ok ||
    response.redirected ||
    !response.headers.get("content-type")?.includes("application/json")
  )
    throw new Error("소유자 로그인이 필요합니다.");
  const result = await response.json();
  if (result.access !== "owner-private")
    throw new Error("비공개 작업 공간에 연결하지 못했습니다.");
}
