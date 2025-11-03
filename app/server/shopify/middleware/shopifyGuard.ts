// app/server/shopify/shopifyGuard.ts
import { isActiveShop } from "../isActiveShop";
import { notifyOrphanOrderOnce } from "../../notify/notifyOrphanOrder";

export async function ensureActiveShopOrNotify(
  request: Request,
  shop: string,
  topic: string,
  payload: unknown
) {
  if (await isActiveShop(shop)) return;
  const topicHeader = request.headers.get("X-Shopify-Topic") ?? "";
  const headerWebhookId = request.headers.get("X-Shopify-Webhook-Id") ?? "";
  const webhookId = headerWebhookId || `${shop}-${topic}-${Date.now()}`;
  const orderId = extractOrderId(payload);
  if (orderId) {
    await notifyOrphanOrderOnce({
      shopId: shop,
      topic: topicHeader,
      orderId,
      webhookId,
    });
  }
  throw new Response("Shop not onboarded/active", { status: 409 });
}

function extractOrderId(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  const candidate =
    record.id ??
    record.order_id ??
    (typeof record.order === "object" && record.order !== null
      ? (record.order as Record<string, unknown>).id
      : undefined);
  if (typeof candidate === "number") return String(candidate);
  if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  return "";
}
