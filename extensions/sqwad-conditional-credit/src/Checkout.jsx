// extensions/checkout/src/Checkout.jsx
import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useMemo, useEffect, useCallback, useState} from 'preact/hooks';
import {
  // Metafields
  useMetafield,
  useApplyMetafieldsChange,
  // Attributes
  useAttributeValues,
  useApplyAttributeChange,
  // Totals / payments
  useSubtotalAmount,
  useTotalAmount,
  useTotalShippingAmount,
  useTotalTaxAmount,
  useSelectedPaymentOptions,
  useShop,
  useExtensionApi,
} from '@shopify/ui-extensions/checkout/preact';

const API_BASE_URL = "https://sqwad-prediction-rebate-f95e19863c03.herokuapp.com";

// const API_BASE_URL = (() => {
//   try {
//     const globalEnv = /** @type {Record<string, unknown>} */ (globalThis || {});
//     if (typeof globalEnv.SQWAD_APP_URL === 'string' && globalEnv.SQWAD_APP_URL) {
//       return globalEnv.SQWAD_APP_URL;
//     }
//   } catch {
//     // no-op
//   }
//   const env = typeof process !== 'undefined' && process?.env ? process.env : undefined;
//   if (env) {
//     const resolved =
//       env.SQWAD_ACTIVE_GAME_API_BASE ||
//       env.SQWAD_APP_BASE_URL ||
//       env.SHOPIFY_APP_URL ||
//       env.APP_URL;
//     if (resolved) return resolved;
//   }
//   try {
//     const scriptUrl = globalThis?.shopify?.extension?.scriptUrl;
//     if (typeof scriptUrl === 'string') {
//       return new URL(scriptUrl).origin;
//     }
//   } catch {
//     // no-op
//   }
//   return DEFAULT_APP_URL;
// })();

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

  const shop = useShop();
  const shopDomain = shop?.myshopifyDomain || shop?.domain || '';
  const subtotalAmount = useSubtotalAmount();
  const totalAmount = useTotalAmount();
  const totalShippingAmount = useTotalShippingAmount();
  const totalTaxAmount = useTotalTaxAmount();
  const selectedPaymentOptions = useSelectedPaymentOptions();
  const extensionApi = useExtensionApi();
  const isCheckoutEditor = Boolean(extensionApi?.extension?.editor);
  const [gameStatus, setGameStatus] = useState(
    isCheckoutEditor ? 'active' : 'checking',
  ); // 'checking' | 'active' | 'inactive' | 'unknown'

  // Writers (singular per docs)
  const applyMetafieldChange = useApplyMetafieldsChange();
  const applyAttributeChange = useApplyAttributeChange();

  useEffect(() => {
    if (isCheckoutEditor) {
      setGameStatus('active');
      return;
    }
    if (!shopDomain || !API_BASE_URL) {
      setGameStatus('unknown');
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setGameStatus('checking');
    (async () => {
      try {
        const endpoint = new URL('/api/active-game', API_BASE_URL);
        endpoint.searchParams.set('shop', shopDomain);
        const response = await fetch(endpoint.toString(), {
          signal: controller.signal,
          headers: {'Accept': 'application/json'},
        });
        if (!response.ok) {
          throw new Error(`Active game lookup failed: ${response.status}`);
        }
        const payload = await response.json();
        if (cancelled) return;
        setGameStatus(payload?.active ? 'active' : 'inactive');
      } catch (err) {
        if (!cancelled) {
          console.warn('[sqwad] Failed to resolve active game status', err);
          setGameStatus('unknown');
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [shopDomain, isCheckoutEditor]);

  // Prefer metafield, fall back to attribute
  const checked = useMemo(() => {
    if (creditMf?.value != null) return String(creditMf.value).toLowerCase() === 'true';
    if (attrOptIn != null) return String(attrOptIn).toLowerCase() === 'true';
    return true;
  }, [creditMf?.value, attrOptIn]);

  const isCreditCardPayment = useMemo(() => {
    if (!Array.isArray(selectedPaymentOptions) || selectedPaymentOptions.length === 0) {
      return false;
    }
    const normalizedOptions = selectedPaymentOptions.filter(Boolean);
    if (normalizedOptions.length === 0) {
      return false;
    }
    return normalizedOptions.every((option) => option.type === 'creditCard');
  }, [selectedPaymentOptions]);

  const effectiveGameStatus = isCheckoutEditor ? 'active' : gameStatus;
  const gameActiveKnown = effectiveGameStatus === 'active';
  const gameInactiveKnown = effectiveGameStatus === 'inactive';
  const creditCardEligible = isCheckoutEditor ? true : isCreditCardPayment;

  const rebateAmount = useMemo(() => {
    if (!subtotalAmount) return null;
    const subtotalValue = Number(subtotalAmount.amount ?? 0);
    if (!Number.isFinite(subtotalValue)) return null;

    const fallbackCurrency =
      subtotalAmount.currencyCode ??
      totalAmount?.currencyCode ??
      totalShippingAmount?.currencyCode ??
      totalTaxAmount?.currencyCode ??
      'USD';

    const normalizeMoney = (money, expectedCurrency) => {
      if (!money) return 0;
      if (money.currencyCode && expectedCurrency && money.currencyCode !== expectedCurrency) {
        return 0;
      }
      const amount = Number(money.amount ?? 0);
      return Number.isFinite(amount) ? amount : 0;
    };

    const totalValue = normalizeMoney(totalAmount, fallbackCurrency);
    const shippingValue = normalizeMoney(totalShippingAmount, fallbackCurrency);
    const taxValue = normalizeMoney(totalTaxAmount, fallbackCurrency);

    const adjustedTotal = Math.max(totalValue - shippingValue - taxValue, 0);
    const eligibleAmount = Math.min(subtotalValue, adjustedTotal);

    return {
      amount: eligibleAmount,
      currencyCode: fallbackCurrency,
    };
  }, [
    subtotalAmount?.amount,
    subtotalAmount?.currencyCode,
    totalAmount?.amount,
    totalAmount?.currencyCode,
    totalShippingAmount?.amount,
    totalShippingAmount?.currencyCode,
    totalTaxAmount?.amount,
    totalTaxAmount?.currencyCode,
  ]);

  const rebateDisplay = useMemo(() => {
    if (!rebateAmount) return null;
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: rebateAmount.currencyCode,
      }).format(rebateAmount.amount);
    } catch {
      return `${rebateAmount.currencyCode ?? ''} ${rebateAmount.amount.toFixed(2)}`.trim();
    }
  }, [rebateAmount]);

  const canOptIn = gameActiveKnown && creditCardEligible;
  const persist = useCallback(async (next) => {
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
  }, [applyMetafieldChange, applyAttributeChange, attrPredictionId, attrUserId]);

  useEffect(() => {
    if (!checked) return;
    if (!gameActiveKnown && !gameInactiveKnown) return;
    if (gameInactiveKnown) {
      void persist(false);
      return;
    }
    if (!creditCardEligible) {
      void persist(false);
    }
  }, [gameActiveKnown, gameInactiveKnown, creditCardEligible, checked, persist]);

  useEffect(() => {
    if (!gameActiveKnown) return;
    if (creditMf?.value == null && attrOptIn == null) {
      void persist(creditCardEligible); // set default based on eligibility
    }
  }, [creditMf?.value, attrOptIn, creditCardEligible, persist, gameActiveKnown]);

  const displayedChecked = canOptIn ? checked : false;
  const handleCheckboxChange = useCallback(
    (e) => {
      if (!canOptIn) return;
      void persist(!!e?.target?.checked);
    },
    [canOptIn, persist],
  );

  if (!gameActiveKnown) {
    return null;
  }

  return (
    <s-banner heading="SQWAD Conditional Credit">
      <s-stack gap="base">
        <s-text>Get store credit if the hits.</s-text>
        {rebateDisplay && (
          <s-text appearance="subdued" size="small">
            Total available to rebate in cart: {rebateDisplay}
          </s-text>
        )}
        {!creditCardEligible && (
          <s-text appearance="subdued" size="small">
            Select Credit Card at payment to participate in the rebate promotion.
          </s-text>
        )}
        <s-checkbox checked={displayedChecked} disabled={!canOptIn} onChange={handleCheckboxChange}>
          I want conditional credit for this order
        </s-checkbox>
      </s-stack>
    </s-banner>
  );
}
