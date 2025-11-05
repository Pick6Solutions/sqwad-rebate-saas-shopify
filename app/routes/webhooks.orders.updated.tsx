import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { upsertOrder } from "../server/storage/orders";
import { ensureOrderGid } from "../server/shopify/ids";
import { ensureActiveShopOrNotify } from "../server/shopify/middleware/shopifyGuard";
import { makeAdminClient } from "../server/shopify/admin";

const MINI = `#graphql
  query ($id: ID!) {
    order(id: $id) {
      id
      cancelledAt
      displayFinancialStatus
    }
  }
`;

type MiniOrderResponse = {
  data?: {
    order?: {
      id?: string | null;
      cancelledAt?: string | null;
      displayFinancialStatus?: string | null;
    } | null;
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log('HEFKJEJ')
  const { topic, shop, session, payload } = await authenticate.webhook(request);
  await ensureActiveShopOrNotify(request, shop, topic, payload); // throws 409 if inactive
  if (topic !== "ORDERS_UPDATED") return new Response();
  const id = ensureOrderGid(payload);
  if (!session?.accessToken) throw new Response("Missing Shopify access token", { status: 401 });
  const client = makeAdminClient(shop, session.accessToken);
  const data = await client<MiniOrderResponse>(MINI, { id });
  const o = data.data?.order;

  await upsertOrder({
    shopId: shop,
    orderId: id,
    cancelledAt: o?.cancelledAt ?? null,
    financialStatus: o?.displayFinancialStatus ?? null,
    eligiblePending: false
  });

  return new Response();
};
