// app/server/notify/mailgun.ts
import { request } from 'undici';

const API_HOST =
  (process.env.MAILGUN_REGION || 'US').toUpperCase() === 'EU'
    ? 'https://api.eu.mailgun.net'
    : 'https://api.mailgun.net';

function toCsv(value: string | string[] | undefined | null): string {
  if (!value) return "";
  return Array.isArray(value) ? value.filter(Boolean).join(",") : value;
}

export async function sendMailgunEmail({
  to,
  subject,
  text,
  html,
}: {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
}) {
  const domain = process.env.MAILGUN_DOMAIN!;
  const apiKey = process.env.MAILGUN_API_KEY!;
  const from = process.env.MAILGUN_FROM!;

  if (!domain || !apiKey || !from) {
    throw new Error('Mailgun env vars missing (MAILGUN_DOMAIN/API_KEY/FROM)');
  }

  const params = new URLSearchParams();
  params.set("from", from);
  params.set("to", toCsv(to));
  params.set("subject", String(subject));
  params.set("text", String(text));
  if (html) params.set("html", String(html));
  const formString = params.toString();

  const res = await request(`${API_HOST}/v3/${domain}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      "Content-Length": Buffer.byteLength(formString).toString()
    },
    body: formString,
  });

  if (res.statusCode >= 300) {
    const msg = await res.body.text();
    throw new Error(`Mailgun error ${res.statusCode}: ${msg}`);
  }
}
