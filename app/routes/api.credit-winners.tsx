// app/routes/api.credit-winners.tsx
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { makeAdminClient } from "../server/shopify/admin";
import {
  getCorrectPredictions,
  findEligibleOrders,
  markCredited,
  creditRecordExists,
} from "../server/storage/eligibility";
import { getOrderRecord, type OrderRecord } from "../server/storage/orders";

const API_VERSION = "2025-10";

const SC_CREDIT_MUT = `#graphql
mutation storeCreditAccountCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
  storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
    storeCreditAccountTransaction { id amount { amount currencyCode } }
    userErrors { field message }
  }
}`;

const GIFT_CARD_CREATE = `#graphql
mutation IssueSqwadGiftCard($input: GiftCardCreateInput!, $idemp: String!) {
  giftCardCreate(input: $input, idempotencyKey: $idemp) {
    giftCard { id codeMasked balance { amount currencyCode } }
    userErrors { field message }
  }
}`;

type BodyWinners = {
  // existing winners flow
  eventId: string;
  mode?: "store_credit" | "gift_card";
  basis?: "subtotal" | "total";
  cap?: number;
  minSpend?: number;
  waitHours?: number;
  expiresAt?: string;      // NEW: ISO date, optional store credit expiry
};

type ManualOrder = {
  orderId: string;
  email: string;
  subtotal: number;
  currencyCode: string; // e.g., "USD"
};

type BodyManual = {
  // manual selection from OrdersViewer
  orders: ManualOrder[];
  cap?: number;
  minSpend?: number;
  expiresAt?: string;     // optional expiry
};

type Incoming = BodyWinners | BodyManual;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session?.shop;
  const token = session?.accessToken;
  if (!shop || !token) {
    throw new Response("Missing Shopify session", { status: 401 });
  }
  const admin = makeAdminClient(shop, token, API_VERSION);

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch (error) {
    throw new Response(
      JSON.stringify({ ok: false, error: "Invalid JSON payload" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  const body = parsed as Incoming;

  // ---- BRANCH 1: Manual selections (OrdersViewer -> POST /api/shops/:shopId/grant-credit) ----
  if ("orders" in body) {
    if (!Array.isArray(body.orders) || body.orders.length === 0) {
      return Response.json({ ok: false, processed: 0, failures: [{ orderId: "", error: "No orders supplied" }] }, { status: 400 });
    }
    const cap = body.cap;
    const minSpend = body.minSpend;
    const expiresAt = body.expiresAt;
    let processed = 0;
    const failures: Array<{ orderId: string; error: string }> = [];

    for (const o of body.orders) {
      const orderId = o.orderId?.trim();
      if (!orderId) {
        failures.push({ orderId: o.orderId, error: "Missing order id" });
        continue;
      }
      const email = o.email?.trim();
      if (!email) {
        failures.push({ orderId, error: "Missing customer email" });
        continue;
      }
      const currencyCode = o.currencyCode?.trim();
      if (!currencyCode) {
        failures.push({ orderId, error: "Missing currency code" });
        continue;
      }

      const idemp = `cred_${shop}_${orderId}`;
      let amount = Number(o.subtotal || 0);
      if (minSpend && amount < minSpend) continue;
      if (cap && amount > cap) amount = cap;
      if (amount <= 0) continue;

      const existingOrder = await getOrderRecord(shop, orderId);
      if (!existingOrder) {
        failures.push({ orderId, error: "Order not found in database" });
        continue;
      }
      if (existingOrder.credited) {
        failures.push({ orderId, error: "Order already credited" });
        continue;
      }
      if (await creditRecordExists(idemp)) {
        failures.push({ orderId, error: "Order credit already recorded" });
        continue;
      }

      const record: OrderRecord = { ...existingOrder };
      if (!record.customerEmail) record.customerEmail = email;
      if (!record.currency) record.currency = currencyCode;
      if (record.subtotal == null) record.subtotal = o.subtotal;
      if (record.total == null) record.total = o.subtotal;

      try {
        const currencyToUse = record.currency;
        if (!currencyToUse) {
          throw new Error("Missing currency for store credit");
        }

        let customerId = record.customerId ?? undefined;
        if (!customerId) {
          const emailToUse = record.customerEmail;
          if (!emailToUse) {
            throw new Error("Missing customer email");
          }
          customerId = await findOrCreateCustomerByEmail(admin, emailToUse);
          if (!record.customerId) {
            record.customerId = customerId;
          }
        }

        if (!customerId) {
          throw new Error("Unable to resolve customer id");
        }

        const txn = await creditCustomer(admin, customerId, amount, currencyToUse, { expiresAt });

        await markCredited(record, {
          mode: "store_credit",
          storeCreditTxnId: txn.id,
          idempotencyKey: idemp,
          amount,
          currency: currencyToUse,
        });
        processed++;
      } catch (e: any) {
        const errMsg = String(e?.message || e);
        failures.push({ orderId, error: errMsg });
        await markCredited(record, {
          failed: true,
          creditError: errMsg,
        });
      }
    }

    return Response.json({ ok: true, processed, failures });
  }

  // ---- BRANCH 2: Existing winners flow (eventId -> predictions -> eligible orders) ----
  const {
    mode = "store_credit",
    basis = "subtotal",
    cap,
    minSpend,
    waitHours,
    expiresAt,
  } = body as BodyWinners;

    const eventId = (body as BodyWinners).eventId;
    if (!eventId) {
      return Response.json({ ok: false, credited: 0, reason: "missing eventId" }, { status: 400 });
    }
    const predictionIds = await getCorrectPredictions(eventId);
  if (!predictionIds.length) {
    return Response.json({ ok: true, credited: 0, reason: "no winners" });
  }

  const orders = await findEligibleOrders(shop, predictionIds);
  let credited = 0;

  for (const o of orders) {
    if (waitHours) {
      const createdIso = o.createdAt ?? undefined;
      if (createdIso) {
        const created = new Date(createdIso).getTime();
        if (!Number.isNaN(created) && Date.now() - created < waitHours * 3_600_000) {
          continue;
        }
      }
    }

    const idemp = `cred_${shop}_${o.orderId}`;
    const base = basis === "subtotal" ? o.subtotal : o.total;
    let amount = Number(base || 0);
    if (minSpend && amount < minSpend) continue;
    if (cap && amount > cap) amount = cap;
    if (amount <= 0) continue;
    if (o.credited) continue;
    if (await creditRecordExists(idemp)) continue;

    try {
      if (mode === "store_credit") {
        // If upstream doesn't attach customerId, fallback by email
        let customerId: string | undefined = o.customerId ?? undefined;
        if (!customerId) {
          const email = o.customerEmail;
          if (!email) throw new Error("Missing customer email & id");
          customerId = await findOrCreateCustomerByEmail(admin, email);
        }

        const currencyCode = o.currency ?? undefined;
        if (!currencyCode) throw new Error("Missing currency for store credit");

        const txn = await creditCustomer(admin, customerId!, amount, currencyCode, { expiresAt });

        await markCredited(o, {
          mode,
          storeCreditTxnId: txn.id,
          idempotencyKey: idemp,
          amount,
          currency: currencyCode,
        });
      } else {
        const email = o.customerEmail || (await lookupCustomerEmail(admin, o.customerId ?? undefined));
        if (!email) throw new Error("Missing customer email for gift card");
        const currencyCode = o.currency ?? undefined;
        if (!currencyCode) throw new Error("Missing currency for gift card");
        const resp = await admin(GIFT_CARD_CREATE, {
          idemp,
          input: {
            initialValue: amount.toFixed(2),
            currency: currencyCode,
            note: "SQWAD conditional credit",
            customerEmail: email,
          },
        });
        const gc = (resp as any)?.data?.giftCardCreate?.giftCard;
        const errs = (resp as any)?.data?.giftCardCreate?.userErrors ?? [];
        if (!gc || errs.length) throw new Error(`Gift card create failed: ${JSON.stringify(errs)}`);

        await markCredited(o, {
          mode,
          giftCardId: gc.id,
          idempotencyKey: idemp,
          amount,
          currency: currencyCode,
        });
      }

      credited++;
    } catch (e: any) {
      await markCredited(o, { failed: true, creditError: String(e?.message || e) });
    }
  }

  return Response.json({ ok: true, credited, totalEligible: orders.length });
};

// ---------- helpers ----------

async function findOrCreateCustomerByEmail(
  admin: ReturnType<typeof makeAdminClient>,
  email: string
): Promise<string> {
  const Q = `#graphql
    query ($email: String!) {
      customerByIdentifier(identifier: { emailAddress: $email }) {
        id
        email
      }
    }`;
  const q = await admin(Q, { email });
  const found = (q as any)?.data?.customerByIdentifier;
  if (found?.id) return found.id;

  const CREATE = `#graphql
    mutation ($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer { id }
        userErrors { field message }
      }
    }`;
  const r = await admin(CREATE, { input: { email } });
  const errs = (r as any)?.data?.customerCreate?.userErrors ?? [];
  if (errs.length) throw new Error(`customerCreate: ${JSON.stringify(errs)}`);
  const id = (r as any)?.data?.customerCreate?.customer?.id;
  if (!id) throw new Error("customerCreate: no id returned");
  return id;
}

async function creditCustomer(
  admin: ReturnType<typeof makeAdminClient>,
  customerId: string,
  amount: number,
  currencyCode: string,
  opts?: { expiresAt?: string }
) {
  const variables: any = {
    id: customerId,
    creditInput: {
      creditAmount: { amount: amount.toFixed(2), currencyCode },
      ...(opts?.expiresAt ? { expiresAt: opts.expiresAt } : {}),
    },
  };

  const resp = await admin(SC_CREDIT_MUT, variables);
  const data = (resp as any)?.data?.storeCreditAccountCredit;
  const errs = data?.userErrors ?? [];
  if (errs.length) throw new Error(`storeCreditAccountCredit: ${JSON.stringify(errs)}`);
  const txn = data?.storeCreditAccountTransaction;
  if (!txn?.id) throw new Error("storeCreditAccountCredit: no transaction id");
  return txn;
}

async function lookupCustomerEmail(
  admin: ReturnType<typeof makeAdminClient>,
  customerGid?: string
): Promise<string | null> {
  if (!customerGid) return null;
  const Q = `#graphql query($id:ID!){ customer(id:$id){ email } }`;
  const r = await admin(Q, { id: customerGid });
  return (r as any)?.data?.customer?.email ?? null;
}
