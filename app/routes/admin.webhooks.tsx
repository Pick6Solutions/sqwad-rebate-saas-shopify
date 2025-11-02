// app/routes/admin.webhooks.tsx  (React Router app)
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request); // ← has shop + accessToken
  if (!session?.accessToken) {
    throw new Response("Missing Shopify access token", { status: 401 });
  }
  const url = `https://${session.shop}/admin/api/2025-10/webhooks.json`;
  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": session.accessToken,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Response(
      JSON.stringify({ ok: false, status: res.status, body: text }),
      {
        status: res.status,
        headers: { "content-type": "application/json" },
      },
    );
  }
  const text = await res.text();
  return new Response(text, { headers: { "content-type": "application/json" } });
};
