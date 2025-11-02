// extensions/checkout/src/Checkout.jsx
import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useMemo, useEffect} from 'preact/hooks';
import {
  // Metafields
  useMetafield,
  useApplyMetafieldsChange,
  // Attributes
  useAttributeValues,
  useApplyAttributeChange,
} from '@shopify/ui-extensions/checkout/preact';

export default function extension() {
  render(<Extension />, document.body);
}

function Extension() {
  // Read current values
  const creditMf = useMetafield({namespace: 'sqwad', key: 'creditOptIn'});
  const [attrOptIn, attrPredictionId, attrUserId] = useAttributeValues([
    'sqwad_credit_opt_in',
    'sqwad_predictionId',
    'sqwad_userId',
  ]);

  // Writers (singular per docs)
  const applyMetafieldChange = useApplyMetafieldsChange();
  const applyAttributeChange = useApplyAttributeChange();

  // Prefer metafield, fall back to attribute
  const checked = useMemo(() => {
    if (creditMf?.value != null) return String(creditMf.value).toLowerCase() === 'true';
    if (attrOptIn != null) return String(attrOptIn).toLowerCase() === 'true';
    return true;
  }, [creditMf?.value, attrOptIn]);

  useEffect(() => {
    if (creditMf?.value == null && attrOptIn == null) {
      void persist(true); // sets both attribute + metafield ASAP
    }
  }, [creditMf?.value, attrOptIn]);

  async function persist(next) {
    const value = String(!!next);

    // 1) Order metafield (persisted to the order after checkout completes)
    await applyMetafieldChange({
      type: 'updateMetafield',
      namespace: 'sqwad',
      key: 'creditOptIn',
      valueType: 'string',
      value,
    });

    // 2) Cart/checkout attribute (becomes note_attributes on the order)
    await applyAttributeChange({
      type: 'updateAttribute',
      key: 'sqwad_credit_opt_in',
      value,
    });

    // 3) (Optional) mirror IDs from attributes into sqwad metafields
    if (attrPredictionId) {
      await applyMetafieldChange({
        type: 'updateMetafield',
        namespace: 'sqwad',
        key: 'predictionId',
        valueType: 'string',
        value: String(attrPredictionId),
      });
    }
    if (attrUserId) {
      await applyMetafieldChange({
        type: 'updateMetafield',
        namespace: 'sqwad',
        key: 'userId',
        valueType: 'string',
        value: String(attrUserId),
      });
    }
  }

  return (
    <s-banner heading="SQWAD Conditional Credit">
      <s-stack gap="base">
        <s-text>Get store credit (or a gift card) if your pick hits.</s-text>
        <s-checkbox checked={checked} onChange={(e) => persist(!!e?.target?.checked)}>
          I want conditional credit for this order
        </s-checkbox>
      </s-stack>
    </s-banner>
  );
}
