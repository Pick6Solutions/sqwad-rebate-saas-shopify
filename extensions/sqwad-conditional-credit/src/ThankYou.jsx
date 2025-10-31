import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

// Export an async default that boots the component into the doc body
export default async () => {
  render(<ThankYou />, document.body);
};

function ThankYou() {
  // We’ll try to read the checkout metafields we wrote at checkout time
  // (They’re now applied to the Order; the thank-you surface exposes them via shopify.metafields)
  const [state, setState] = useState({ optedIn: false, predictionId: null });

  useEffect(() => {
    (async () => {
      try {
        // These calls are available in the web-components/Preact runtime.
        // They resolve to objects like { value: 'true' } or undefined if missing.
        const mfOpt = await shopify.metafields.get({
          namespace: 'sqwad',
          key: 'creditOptIn',
        });
        const mfPred = await shopify.metafields.get({
          namespace: 'sqwad',
          key: 'predictionId',
        });

        setState({
          optedIn: String(mfOpt?.value ?? 'false') === 'true',
          predictionId: mfPred?.value ?? null,
        });
      } catch (e) {
        // Fallback: don’t block render if metafields aren’t readable here
        setState((s) => s);
      }
    })();
  }, []);

  const { optedIn, predictionId } = state;

  return (
    <s-banner heading="SQWAD Conditional Credit" tone={optedIn ? 'success' : 'info'}>
      <s-stack gap="base">
        {optedIn ? (
          <>
            <s-text>You opted in for conditional store credit on this order.</s-text>
            {predictionId && (
              <s-text appearance="subdued" size="small">
                Linked prediction: <s-text type="emphasis">{predictionId}</s-text>
              </s-text>
            )}
            <s-text appearance="subdued" size="small">
              If your pick hits, we’ll credit your account automatically after the event.
            </s-text>
          </>
        ) : (
          <s-text appearance="subdued">
            You didn’t opt in for conditional credit on this order.
          </s-text>
        )}
      </s-stack>
    </s-banner>
  );
}
