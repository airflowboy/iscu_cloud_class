import { getOriginalUrl } from "../../lib/cache";
import { recordClick } from "../../lib/stats";

export async function GET(request, { params }) {
  const { shortCode } = await params;

  const t0 = performance.now();
  const { originalUrl, cacheStatus } = await getOriginalUrl(shortCode);
  const t1 = performance.now();

  if (!originalUrl) {
    console.warn("Short URL not found", { shortCode });

    return new Response("Not Found", { status: 404 });
  }

  try {
    await recordClick(shortCode);
  } catch (error) {
    console.error("Failed to record click", { shortCode });
  }

  const t2 = performance.now();

  console.log({
    shortCode,
    cacheStatus,
    lookupMs: (t1 - t0).toFixed(1),
    updateMs: (t2 - t1).toFixed(1),
    totalMs: (t2 - t0).toFixed(1),
  });

  return new Response(null, {
    status: 307,
    headers: {
      Location: originalUrl,
      "Cache-Control": "no-store",
      "X-Cache": cacheStatus,
    },
  });
}
