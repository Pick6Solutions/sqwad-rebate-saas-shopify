import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { upsertOrder, markRegistered } from "../server/storage/orders";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  if (topic !== "refunds/create") return new Response();

  // refunds payloads include numeric order_id and sometimes the GID:
  const orderId = payload.admin_graphql_api_id ?? `gid://shopify/Order/${payload.order_id}`;
  const orderIdNum = String(payload.order_id);
  const orderGid = payload.admin_graphql_api_id ?? `gid://shopify/Order/${orderIdNum}`;

  // If you want partial refunds to “decrement benefits”, update your logic here:
  // const isFullRefund = !payload?.refund_line_items?.length;

  await upsertOrder({
    shopId: shop,
    orderId,
    financialStatus: "REFUNDED",
    eligiblePending: false,
    registered: false,
    credited: false
  });

  await markRegistered(shop, orderGid, false);

  return new Response();
};
