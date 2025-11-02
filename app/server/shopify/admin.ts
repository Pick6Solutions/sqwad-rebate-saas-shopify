export type AdminClient = <T=any>(query: string, variables?: Record<string, any>) => Promise<T>;

export function makeAdminClient(shop: string, accessToken: string, apiVersion = "2025-10"): AdminClient {
  const url = `https://${shop}/admin/api/${apiVersion}/graphql.json`;
  return async <T=any>(query: string, variables?: Record<string, any>) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Shopify GraphQL ${response.status}: ${text}`);
    }
    const json = await response.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    const userErrors = json?.data
      ? Object.values(json.data).flatMap((v: any) => v?.userErrors ?? [])
      : [];
    if (Array.isArray(userErrors) && userErrors.length) {
      throw new Error(userErrors.map((e: any) => e.message).join("; "));
    }
    return json as T;
  };
}
