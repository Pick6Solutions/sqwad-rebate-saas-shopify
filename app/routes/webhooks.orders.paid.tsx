import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { upsertOrder, markRegistered } from "../server/storage/orders";
import {ensureActiveShopOrNotify} from "../server/shopify/middleware/shopifyGuard";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  await ensureActiveShopOrNotify(request, shop, topic, payload); // throws 409 if inactive
  if (topic !== "ORDERS_PAID") return new Response();

  // Shopify sends admin_graphql_api_id in webhook payloads
  const orderGid: string = payload.admin_graphql_api_id;

  await upsertOrder({
    shopId: shop,
    orderId: orderGid,
    financialStatus: "PAID",
    cancelledAt: null,
    eligiblePending: false,
    registered: true,   // your “registration” flag
    credited: true      // set if you “issue credit” at payment time
  });

  await markRegistered(shop, orderGid, true);

  return new Response();
};
