export function ensureOrderGid(payload: any): string {
  const gid = payload?.admin_graphql_api_id || payload?.admin_graphql_id;
  if (typeof gid === "string" && gid.startsWith("gid://")) return gid;

  // Some topics only include numeric ids
  const num = payload?.id ?? payload?.order_id ?? payload?.order?.id;
  if (num != null) return `gid://shopify/Order/${String(num)}`;

  throw new Error("Webhook payload missing order id (no admin_graphql_api_id or numeric id)");
}

export function orderDocId(idOrGid: string | number): string {
  const s = String(idOrGid);
  return s.startsWith("gid://") ? s.split("/").pop()! : s;
}
