// lib/cache.js
// 10주차 실습: Upstash Redis REST API를 이용한 외부 공유 캐시 (Cache-Aside)

const DEFAULT_TTL_SECONDS = 60;

function getRedisConfig() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
}

export function isCacheEnabled() {
  return getRedisConfig() !== null;
}

export async function getCachedUrl(shortCode) {
  const config = getRedisConfig();
  if (!config) return null;

  try {
    const key = encodeURIComponent(`url:${shortCode}`);
    const response = await fetch(`${config.url}/get/${key}`, {
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return typeof data.result === "string" ? data.result : null;
  } catch (error) {
    console.error("Failed to read from Redis cache", {
      shortCode,
      errorMessage: error?.message,
    });
    return null;
  }
}

export async function setCachedUrl(
  shortCode,
  originalUrl,
  ttlSeconds = DEFAULT_TTL_SECONDS
) {
  const config = getRedisConfig();
  if (!config) return;

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        "SET",
        `url:${shortCode}`,
        originalUrl,
        "EX",
        String(ttlSeconds),
      ]),
      cache: "no-store",
    });

    if (!response.ok) {
      console.error("Failed to write to Redis cache", {
        shortCode,
        status: response.status,
      });
    }
  } catch (error) {
    console.error("Failed to write to Redis cache", {
      shortCode,
      errorMessage: error?.message,
    });
  }
}
