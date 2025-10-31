import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { makeAdminClient } from "../server/shopify/admin";
import { upsertOrder } from "../server/storage/orders";
import {ensureOrderGid} from "../server/shopify/ids";
import {ensureActiveShopOrNotify} from "../server/shopify/middleware/shopifyGuard";

const ORDER_QUERY = `#graphql
  query OrderSqwad($id: ID!) {
    order(id: $id) {
      id
      name
      createdAt
      customer { id email }
      currencyCode
      subtotalPriceSet { shopMoney { amount currencyCode } }
      totalPriceSet    { shopMoney { amount currencyCode } }
      displayFinancialStatus
      cancelledAt
      metafields(first: 25, namespace: "sqwad") {
        edges { node { key value } }
      }
    }
  }`;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, session, payload } = await authenticate.webhook(request);
  await ensureActiveShopOrNotify(request, shop, topic, payload); // throws 409 if inactive
  if (topic !== "ORDERS_CREATE") return new Response();

  const admin = makeAdminClient(shop, session!.accessToken);
  const id = ensureOrderGid(payload);
  const data = await admin(ORDER_QUERY, { id });
  const order = (data as any)?.data?.order;

  const m = new Map<string,string>();
  for (const e of order?.metafields?.edges ?? []) m.set(e.node.key, e.node.value);

  console.log("ORDER: ", order);

  await upsertOrder({
    shopId: shop,
    orderId: id,
    orderName: order.name,
    customerId: order.customer?.id ?? null,
    customerEmail: order.customer?.email ?? null,
    currency: order.currencyCode,
    subtotal: Number(order.subtotalPriceSet?.shopMoney?.amount ?? 0),
    total: Number(order.totalPriceSet?.shopMoney?.amount ?? 0),
    financialStatus: order.displayFinancialStatus,
    cancelledAt: order.cancelledAt,
    predictionId: m.get("y") ?? null,
    userId: m.get("userId") ?? null,
    optIn: (m.get("creditOptIn") ?? "false").toLowerCase() === "true",
    eligiblePending: false,
    credited: false,
    createdAt: order.createdAt,
  });

  return new Response();
};
