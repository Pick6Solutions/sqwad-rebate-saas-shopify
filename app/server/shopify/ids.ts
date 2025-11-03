export function ensureOrderGid(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new Error("Webhook payload missing order id (no admin_graphql_api_id or numeric id)");
  }
  const record = payload as Record<string, unknown>;
  const gid = extractString(record.admin_graphql_api_id) ?? extractString(record.admin_graphql_id);
  if (gid && gid.startsWith("gid://")) return gid;

  const idCandidate =
    extractId(record.id) ??
    extractId(record.order_id) ??
    extractId(
      typeof record.order === "object" && record.order !== null
        ? (record.order as Record<string, unknown>).id
        : undefined
    );
  if (idCandidate != null) return `gid://shopify/Order/${idCandidate}`;

  throw new Error("Webhook payload missing order id (no admin_graphql_api_id or numeric id)");
}

export function orderDocId(idOrGid: string | number): string {
  const s = String(idOrGid);
  return s.startsWith("gid://") ? s.split("/").pop()! : s;
}

function extractString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function extractId(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") {
    const trimmed = String(value).trim();
    return trimmed ? trimmed : null;
  }
  return null;
}
