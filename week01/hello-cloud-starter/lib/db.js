import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

// 같은 shortCode가 이미 있으면(동일 URL 재요청 등) 오류 없이 넘어갑니다.
export async function saveUrl(shortCode, originalUrl) {
  await sql`
    INSERT INTO urls (short_code, original_url)
    VALUES (${shortCode}, ${originalUrl})
    ON CONFLICT (short_code) DO NOTHING
  `;
}

// 이미 단축된 원본 URL이면 기존 shortCode를, 없으면 null을 반환합니다.
export async function findShortCodeByUrl(originalUrl) {
  const rows = await sql`
    SELECT short_code
    FROM urls
    WHERE original_url = ${originalUrl}
    ORDER BY created_at ASC
    LIMIT 1
  `;

  return rows[0]?.short_code ?? null;
}

export async function findUrlByShortCode(shortCode) {
  const rows = await sql`
    SELECT original_url
    FROM urls
    WHERE short_code = ${shortCode}
    LIMIT 1
  `;

  return rows[0]?.original_url ?? null;
}

