import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { upsertOrder, markRegistered } from "../server/storage/orders";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  if (topic !== "orders/cancelled") return new Response();

  const orderGid: string = payload.admin_graphql_api_id;

  await upsertOrder({
    shopId: shop,
    orderId: orderGid,
    cancelledAt: payload.cancelled_at ?? new Date().toISOString(),
    financialStatus: "CANCELLED",
    eligiblePending: false,
    registered: false,
    credited: false
  });

  await markRegistered(shop, orderGid, false);

  return new Response();
};
