import { findUrlByShortCode } from "../../lib/db";
import { recordClick } from "../../lib/stats";
import { getCachedUrl, isCacheEnabled, setCachedUrl } from "../../lib/cache";

const CACHE_TTL_SECONDS = 60;

export async function GET(request, { params }) {
  const { shortCode } = await params;

  const t0 = performance.now();

  let originalUrl = null;
  let cacheResult = "bypass";

  // 10주차: Redis Cache-Aside 조회
  if (isCacheEnabled()) {
    originalUrl = await getCachedUrl(shortCode);
    if (originalUrl) {
      cacheResult = "hit";
    } else {
      cacheResult = "miss";
      originalUrl = await findUrlByShortCode(shortCode);
      if (originalUrl) {
        await setCachedUrl(shortCode, originalUrl, CACHE_TTL_SECONDS);
      }
    }
  } else {
    originalUrl = await findUrlByShortCode(shortCode);
  }

  const t1 = performance.now();

  if (!originalUrl) {
    console.warn("Short URL not found", {
      shortCode,
      cacheResult,
      lookupMs: (t1 - t0).toFixed(1),
    });

    return new Response("Not Found", { status: 404 });
  }

  // 캐시 Hit 여부와 무관하게 클릭 기록(UPDATE)은 계속 수행
  try {
    await recordClick(shortCode);
  } catch (error) {
    console.error("Failed to record click", { shortCode });
  }

  const t2 = performance.now();

  // 9주차: Function 내부 처리 구간별 소요 시간 측정 로그
  console.log({
    event: "redirect_completed",
    shortCode,
    cacheResult,
    lookupMs: (t1 - t0).toFixed(1),
    updateMs: (t2 - t1).toFixed(1),
    totalMs: (t2 - t0).toFixed(1),
  });

  return new Response(null, {
    status: 307,
    headers: {
      Location: originalUrl,
      "Cache-Control": "no-store",
      "X-Cache": cacheResult.toUpperCase(),
    },
  });
}
