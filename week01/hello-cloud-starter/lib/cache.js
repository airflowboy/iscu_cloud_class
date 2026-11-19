// lib/cache.js
// Cache-Aside: Redis를 먼저 확인하고, Cache Miss일 때만 Postgres를 조회합니다.

import { Redis } from "@upstash/redis";
import { findUrlByShortCode } from "./db";

// Vercel Marketplace로 연결하면 KV_REST_API_*,
// Upstash 콘솔에서 직접 복사하면 UPSTASH_REDIS_REST_* 이름으로 제공됩니다.
const redisUrl =
  process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const redisToken =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

const redis =
  redisUrl && redisToken
    ? new Redis({
        url: redisUrl,
        token: redisToken,
      })
    : null;

// 캐시에 저장한 값의 유효기간(초)입니다.
const CACHE_TTL_SECONDS = 60;

function cacheKey(shortCode) {
  return `url:${shortCode}`;
}

export async function getOriginalUrl(shortCode) {
  const key = cacheKey(shortCode);

  // 1. Redis에서 먼저 조회합니다.
  let cachedUrl = null;
  if (redis) {
    try {
      cachedUrl = await redis.get(key);
    } catch (error) {
      // 캐시는 보조 수단이므로 Redis 오류가 Redirect 실패로 이어지지 않게 합니다.
      console.error("Failed to read cache", {
        shortCode,
        message: error.message,
      });
    }
  }

  // TODO 1. Cache Hit 처리
  if (cachedUrl) {
    return { originalUrl: cachedUrl, cacheStatus: "HIT" };
  }

  // 2. Cache Miss: Postgres에서 조회합니다.
  const originalUrl = await findUrlByShortCode(shortCode);

  // 3. 존재하는 URL만 Redis에 저장합니다.
  if (originalUrl && redis) {
    try {
      // TODO 2. TTL을 포함한 Redis 저장
      await redis.set(key, originalUrl, { ex: CACHE_TTL_SECONDS });
    } catch (error) {
      console.error("Failed to write cache", {
        shortCode,
        message: error.message,
      });
    }
  }

  return { originalUrl, cacheStatus: "MISS" };
}
