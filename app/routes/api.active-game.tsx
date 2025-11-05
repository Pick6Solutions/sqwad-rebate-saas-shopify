import type { LoaderFunctionArgs } from "react-router";
import { findActiveGame } from "../server/storage/games";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const CACHE_HEADERS = {
  ...CORS_HEADERS,
  "Cache-Control": "public, max-age=30",
};

const ERROR_HEADERS = {
  ...CORS_HEADERS,
  "Cache-Control": "no-store",
};

function json(data: unknown, init?: ResponseInit, error = false) {
  const headers = new Headers(init?.headers ?? {});
  headers.set("Content-Type", "application/json");
  const source = error ? ERROR_HEADERS : CACHE_HEADERS;
  for (const [key, value] of Object.entries(source)) {
    headers.set(key, value);
  }
  return new Response(JSON.stringify(data), {...init, headers});
}

const ISO = (value?: { toDate?: () => Date } | null) => {
  if (!value || typeof value.toDate !== "function") return null;
  try {
    return value.toDate().toISOString();
  } catch {
    return null;
  }
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "GET") {
    return json({active: false, error: "method_not_allowed"}, { status: 405, headers: { Allow: "GET, OPTIONS" } }, true);
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return json({active: false, error: "missing_shop"}, { status: 400 }, true);
  }

  const activeGame = await findActiveGame(shop);
  if (!activeGame) {
    return json({active: false});
  }

  return json({
    active: true,
    id: activeGame.id,
    name: activeGame.data.name ?? null,
    startAt: ISO(activeGame.data.startAt ?? null),
    endAt: ISO(activeGame.data.endAt ?? null),
  });
};
