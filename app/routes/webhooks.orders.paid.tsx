import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { upsertOrder, markRegistered } from "../server/storage/orders";
import { ensureActiveShopOrNotify } from "../server/shopify/middleware/shopifyGuard";
import { makeAdminClient } from "../server/shopify/admin";
import { ensureOrderGid } from "../server/shopify/ids";

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
      customAttributes { key value }
    }
  }`;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, session, payload } = await authenticate.webhook(request); // ✅ include session
  await ensureActiveShopOrNotify(request, shop, topic, payload); // throws 409 if inactive
  if (topic !== "ORDERS_PAID") return new Response();

  const orderGid = ensureOrderGid(payload); // ✅ single source of truth (gid)
  if (!session?.accessToken) {
    throw new Response("Missing Shopify access token", { status: 401 });
  }
  const admin = makeAdminClient(shop, session.accessToken);

  const data = await admin(ORDER_QUERY, { id: orderGid });
  const order = (data as any)?.data?.order;
  if (!order) return new Response(); // defensively ignore if not found

  // (Optional) extra guard
  if (order.displayFinancialStatus !== "PAID") return new Response();
  const metafields = new Map<string, string>();
  for (const edge of order?.metafields?.edges ?? []) {
    metafields.set(edge.node.key, edge.node.value);
  }

  const noteAttributes = new Map<string, string>();
  for (const attr of order?.customAttributes ?? []) {
    if (attr?.key) noteAttributes.set(attr.key, attr.value ?? "");
  }

  // for (const attr of order?.noteAttributes ?? []) {
  //   if (attr?.name) noteAttributes.set(attr.name, attr.value ?? "");
  // }
  for (const attr of Array.isArray(payload?.note_attributes) ? payload.note_attributes : []) {
    const key = attr?.name ?? attr?.key;
    if (key && !noteAttributes.has(key)) {
      noteAttributes.set(key, attr?.value ?? "");
    }
  }

  const optIn = coalesceBoolean([
    metafields.get("creditOptIn"),
    noteAttributes.get("sqwad_credit_opt_in"),
  ]) ?? false;

  const predictionId =
    coalesceString([
      metafields.get("predictionId"),
      noteAttributes.get("sqwad_predictionId"),
    ]) ?? null;

  const userId =
    coalesceString([
      metafields.get("userId"),
      noteAttributes.get("sqwad_userId"),
    ]) ?? null;

  const eligiblePending = optIn; // queue any opted-in order, prediction is optional

  await upsertOrder({
    shopId: shop,
    orderId: orderGid,
    orderName: order.name,
    customerId: order.customer?.id ?? null,
    customerEmail: order.customer?.email ?? null,
    currency: order.currencyCode,
    subtotal: Number(order.subtotalPriceSet?.shopMoney?.amount ?? 0),
    total: Number(order.totalPriceSet?.shopMoney?.amount ?? 0),
    financialStatus: order.displayFinancialStatus,
    cancelledAt: order.cancelledAt,
    predictionId,
    userId,
    optIn,
    eligiblePending,
    credited: false,
    createdAt: order.createdAt,
  });

  await markRegistered(shop, orderGid, true);

  return new Response();
};

function coalesceString(candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const value = String(candidate).trim();
    if (value) return value;
  }
  return null;
}

function coalesceBoolean(candidates: Array<unknown>): boolean | null {
  for (const candidate of candidates) {
    const parsed = parseBoolean(candidate);
    if (parsed != null) return parsed;
  }
  return null;
}

function parseBoolean(candidate: unknown): boolean | null {
  if (candidate == null) return null;
  const normalized = String(candidate).trim().toLowerCase();
  if (!normalized) return null;
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  return null;
}
