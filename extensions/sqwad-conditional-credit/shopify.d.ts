import '@shopify/ui-extensions';

// @ts-expect-error Shopify injects a runtime-provided global that isn't visible to TypeScript.
declare module './src/Checkout.jsx' {
  const shopify: import('@shopify/ui-extensions/purchase.checkout.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}
