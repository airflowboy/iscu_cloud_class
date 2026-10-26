import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { findShortCodeByUrl, saveUrl } from "../../../lib/db";

export const runtime = "nodejs";

const MAX_URL_LENGTH = 2048;

const ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/*
 * createShortCode()
 *
 * 원본 URL을 입력받아 SHA-256 해시를 생성하고,
 * 그 값을 이용해 6자리 short code를 만듭니다.
 */
function createShortCode(originalUrl, length = 6) {
  const hex = createHash("sha256")
    .update(originalUrl)
    .digest("hex");

  let code = "";

  for (let i = 0; i < length; i++) {
    const value = parseInt(
      hex.slice(i * 2, i * 2 + 2),
      16
    );

    code += ALPHABET[value % ALPHABET.length];
  }

  return code;
}

/*
 * normalizeHost()
 *
 * 호스트 비교를 위해 포트와 끝의 점(.)을 제거하고 소문자로 맞춥니다.
 */
function normalizeHost(value) {
  if (!value) return null;

  return value
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

/*
 * getOwnHosts()
 *
 * 이 서비스가 사용하는 호스트 목록을 모읍니다.
 * (요청 Host, 프록시가 전달한 Host, Vercel이 제공하는 배포 주소)
 */
function getOwnHosts(request) {
  const candidates = [
    request.headers.get("host"),
    request.headers.get("x-forwarded-host"),
    new URL(request.url).host,
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ];

  return new Set(candidates.map(normalizeHost).filter(Boolean));
}

/*
 * POST()
 *
 * 클라이언트가 보낸 URL을 검사하고,
 * 문제가 없으면 short URL을 생성하여 반환합니다.
 */
export async function POST(request) {
  try {

    /*
     * 1. 요청 body 읽기
     *
     * 클라이언트가 보낸 JSON에서
     * originalUrl 값을 가져옵니다.
     */
    const body = await request.json().catch(() => null);

    const raw = body?.originalUrl;
    const originalUrl =
      typeof raw === "string" ? raw.trim() : "";


    /*
     * 2. URL이 입력되지 않은 경우
     *
     * 클라이언트가 필요한 값을 보내지 않은 상황입니다.
     *
     * TODO:
     * 적절한 HTTP status code로 수정하세요.
     */
    if (!originalUrl) {
      return NextResponse.json(
        {
          error: {
            code: "MISSING_URL",
            message: "Original URL is required.",
          },
        },
        { status: 400 }
      );
    }


    /*
     * 3. URL이 너무 긴 경우
     *
     * 서버가 허용하는 최대 길이보다
     * 긴 URL을 클라이언트가 보낸 상황입니다.
     *
     * TODO:
     * 적절한 HTTP status code로 수정하세요.
     */
    if (originalUrl.length > MAX_URL_LENGTH) {
      return NextResponse.json(
        {
          error: {
            code: "URL_TOO_LONG",
            message:
              `URL must be ${MAX_URL_LENGTH} characters or fewer.`,
          },
        },
        { status: 400 }
      );
    }


    /*
     * 4. URL 형식 검사
     *
     * new URL()을 이용하여
     * 올바른 URL 형식인지 검사합니다.
     */
    let parsedUrl;

    try {
      parsedUrl = new URL(originalUrl);
    } catch {

      /*
       * 올바른 URL 형식이 아닌 경우
       *
       * TODO:
       * 적절한 HTTP status code로 수정하세요.
       */
      return NextResponse.json(
        {
          error: {
            code: "INVALID_URL",
            message:
              "URL must start with http:// or https://.",
          },
        },
        { status: 400 }
      );
    }


    /*
     * 5. 프로토콜 검사
     *
     * http 또는 https만 허용합니다.
     */
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {

      /*
       * 허용하지 않는 URL을 보낸 경우
       *
       * TODO:
       * 적절한 HTTP status code로 수정하세요.
       */
      return NextResponse.json(
        {
          error: {
            code: "INVALID_URL",
            message:
              "URL must start with http:// or https://.",
          },
        },
        { status: 400 }
      );
    }


    /*
     * 6. 자기 서비스 URL 차단
     *
     * 이 URL Shortener 자신의 주소(경로·http/https 무관)를
     * 다시 단축하려는 요청은 거부합니다.
     */
    if (getOwnHosts(request).has(normalizeHost(parsedUrl.host))) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_URL",
            message: "Cannot shorten a URL of this service.",
          },
        },
        { status: 400 }
      );
    }


    const baseUrl = new URL(request.url).origin;


    /*
     * 7. 동일 URL 중복 처리
     *
     * 이미 단축한 URL이면 새로 만들지 않고
     * 기존 shortCode를 그대로 반환합니다.
     */
    const existingCode = await findShortCodeByUrl(originalUrl);

    if (existingCode) {
      return NextResponse.json(
        {
          shortCode: existingCode,
          shortUrl: `${baseUrl}/${existingCode}`,
          originalUrl,
        },
        { status: 200 }
      );
    }


    /*
     * 8. Short URL 생성
     *
     * 모든 검사를 통과했으므로
     * shortCode와 shortUrl을 생성하고 저장합니다.
     */
    const shortCode = createShortCode(originalUrl);
    await saveUrl(shortCode, originalUrl);


    /*
     * URL 생성 성공
     *
     * TODO:
     * 적절한 HTTP status code로 수정하세요.
     */
    return NextResponse.json(
      {
        shortCode,
        shortUrl: `${baseUrl}/${shortCode}`,
        originalUrl,
      },
      { status: 201 }
    );

  } catch {

    /*
     * 7. 서버 내부 오류
     *
     * 예상하지 못한 오류가 발생한 경우입니다.
     *
     * TODO:
     * 적절한 HTTP status code로 수정하세요.
     */
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to create short URL.",
        },
      },
      { status: 500 }
    );
  }
}
