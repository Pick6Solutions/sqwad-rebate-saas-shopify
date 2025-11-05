import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Reward fans the moment their picks hit</h1>
        <p className={styles.text}>
          SQWAD Prediction Rebate links Shopify orders to your prediction games,
          automatically confirming eligibility and issuing instant store credit
          or gift cards when customers guess right.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Live game syncing</strong>. We pull active SQWAD games from
            Firebase so orders are tagged to the right event without manual work.
          </li>
          <li>
            <strong>Automated eligibility</strong>. Paid, opted-in orders are
            staged for rebate review as soon as Shopify confirms payment.
          </li>
          <li>
            <strong>Credit fulfillment</strong>. Approve winners and issue store
            credit or gift cards through Shopify in a single click—no CSVs.
          </li>
        </ul>
      </div>
    </div>
  );
}
