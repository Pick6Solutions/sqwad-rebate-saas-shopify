import type { ActionFunctionArgs } from "react-router";
import { authenticate, sessionStorage } from "../shopify.server";
import { upsertOrder, markRegistered } from "../server/storage/orders";
import { ensureActiveShopOrNotify } from "../server/shopify/middleware/shopifyGuard";
import { makeAdminClient } from "../server/shopify/admin";
import { ensureOrderGid } from "../server/shopify/ids";
import { findActiveGame } from "../server/storage/games";

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

type OrderQueryResponse = {
  data?: {
    order?: {
      id?: string;
      name?: string | null;
      createdAt?: string | null;
      customer?: { id?: string | null; email?: string | null } | null;
      currencyCode?: string | null;
      subtotalPriceSet?: { shopMoney?: { amount?: string | null } | null } | null;
      totalPriceSet?: { shopMoney?: { amount?: string | null } | null } | null;
      displayFinancialStatus?: string | null;
      cancelledAt?: string | null;
      metafields?: {
        edges?: Array<{ node?: { key?: string | null; value?: string | null } | null }> | null;
      } | null;
      customAttributes?: Array<{ key?: string | null; value?: string | null } | null> | null;
    } | null;
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request); // ✅ validated HMAC
  console.info(`[webhooks.orders.paid] Incoming webhook topic ${topic} for ${shop}`);
  await ensureActiveShopOrNotify(request, shop, topic, payload); // throws 409 if inactive
  if (topic !== "ORDERS_PAID") return new Response();

  console.info(`[webhooks.orders.paid] Received webhook for ${shop}`);
  const orderGid = ensureOrderGid(payload); // ✅ single source of truth (gid)
  const sessionId = `offline_${shop}`;
  const session = await sessionStorage.loadSession(sessionId);
  if (!session?.accessToken) {
    throw new Response("Missing Shopify offline session", { status: 401 });
  }
  const admin = makeAdminClient(shop, session.accessToken);

  const data = await admin<OrderQueryResponse>(ORDER_QUERY, { id: orderGid });
  const order = data.data?.order;
  if (!order) {
    console.warn(`[webhooks.orders.paid] Order payload missing order ${orderGid} for ${shop}`);
    return new Response(); // defensively ignore if not found
  }

  // (Optional) extra guard
  if (order.displayFinancialStatus !== "PAID") return new Response();
  const metafields = new Map<string, string>();
  for (const edge of order?.metafields?.edges ?? []) {
    const node = edge?.node;
    if (!node?.key) continue;
    metafields.set(node.key, node.value ?? "");
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

  if (!optIn) {
    console.info(`[orders] Skipping order ${orderGid} for ${shop} because opt-in is false.`);
    return new Response();
  }

  const activeGame = await findActiveGame(shop);
  if (!activeGame) {
    console.warn(`[orders] No active game found for ${shop}; order ${orderGid} not stored.`);
    return new Response();
  }

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

  await upsertOrder({
    shopId: shop,
    orderId: orderGid,
    gameId: activeGame.id,
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
    eligiblePending: true,
    credited: false,
    createdAt: order.createdAt,
    excluded: false
  });

  await markRegistered(shop, orderGid, true, { gameId: activeGame.id });

  console.info(
    `[webhooks.orders.paid] Stored order ${orderGid} for ${shop} (game ${activeGame.id}, optIn ${optIn})`
  );

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
