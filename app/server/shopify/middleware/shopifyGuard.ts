// app/server/shopify/shopifyGuard.ts
import { isActiveShop } from "../isActiveShop";
import {notifyOrphanOrderOnce} from "../../notify/notifyOrphanOrder";

export async function ensureActiveShopOrNotify(request: Request, shop: string, topic: string, payload: any) {
  if (await isActiveShop(shop)) return;
  const topicHeader = request.headers.get("X-Shopify-Topic") ?? "";
  const webhookId = request.headers.get("X-Shopify-Webhook-Id") ?? "";
  webhookId || `${shop}-${topic}-${Date.now()}`;
  const orderId = (payload?.id ?? payload?.order?.id ?? "").toString();
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

