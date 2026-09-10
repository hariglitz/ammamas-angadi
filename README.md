# Ammama's Angadi — Razorpay + Cloudflare Worker

This version keeps the Ammama's Angadi storefront and adds secure Razorpay Checkout.

## Before you deploy

You need a verified Razorpay account and its **Test Mode** API keys first. Test Mode lets you safely test the complete flow before accepting customer payments.

Never add `RAZORPAY_KEY_SECRET` to `public/app.js`, `index.html`, a GitHub repository, or a chat message. It belongs only in Cloudflare Secrets.

## Deploy to Cloudflare

1. Create a new Cloudflare Worker deployment from this project, using `wrangler.jsonc` and the `src` and `public` folders. The Worker serves the static website from `public` and handles the payment API in `src/worker.js`.
2. In **Workers & Pages → ammamas-angadi → Settings → Variables and secrets**, add these three production secrets:

   | Name | Value |
   | --- | --- |
   | `RAZORPAY_KEY_ID` | Razorpay Key ID (use Test Mode first) |
   | `RAZORPAY_KEY_SECRET` | Razorpay Key Secret |
   | `RAZORPAY_WEBHOOK_SECRET` | A new, unique secret you choose for the Razorpay webhook |

   Select **Secret** (encrypted) for every value, then deploy the change.
3. In Razorpay Test Mode, create a webhook with this endpoint:

   `https://ammamasangadi.in/api/razorpay-webhook`

   Set its secret to the exact same value you used for `RAZORPAY_WEBHOOK_SECRET`. Subscribe to `payment.captured` and `order.paid`.
4. Visit the website, add a product, fill in delivery details, and make a Razorpay test payment. Confirm the payment first, then repeat the same steps with Live Mode keys when you are ready to accept real payments.

## Files

- `public/` — the customer-facing website
- `src/worker.js` — secure order creation, payment verification, and webhook signature verification
- `wrangler.jsonc` — Cloudflare Worker and static-assets configuration

## Important behavior

- Product prices are validated in `src/worker.js`; browser totals are not trusted.
- Payment verification happens server-side with Razorpay's signature.
- After a verified payment, the site opens WhatsApp with the paid order and delivery information so Ammama can fulfil it.
- The webhook validates that it is genuinely from Razorpay and writes an event to the Cloudflare Worker log. Connect a database or order-management service later if you want an automatic order history.
