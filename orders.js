// orders.js — order persistence, customer order lookup
import { json, requireCustomer, randomHex } from "./auth.js";

// Call this from inside your EXISTING Razorpay webhook handler,
// right after you verify the webhook signature and confirm payment.success.
// See INTEGRATION.md for exactly where this goes in worker.js.
export async function saveOrder(env, { phone, customerName, address, items, totalRupees, razorpayPaymentId, razorpayOrderId }) {
  const id = "AA-" + randomHex(4); // e.g. AA-9f3c1a02
  await env.DB.prepare(
    `INSERT INTO orders (id, phone, customer_name, address, items_json, total_rupees, razorpay_payment_id, razorpay_order_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'paid')`
  ).bind(
    id,
    phone,
    customerName || null,
    address || null,
    JSON.stringify(items || []),
    totalRupees,
    razorpayPaymentId || null,
    razorpayOrderId || null
  ).run();
  return id;
}

// GET /api/orders/mine — requires the customer session cookie
export async function handleMyOrders(request, env) {
  const phone = await requireCustomer(request, env);
  if (!phone) return json({ error: "Not logged in" }, 401);

  const { results } = await env.DB.prepare(
    `SELECT id, items_json, total_rupees, status, created_at, updated_at
     FROM orders WHERE phone = ? ORDER BY created_at DESC`
  ).bind(phone).all();

  const orders = results.map((o) => ({
    id: o.id,
    items: JSON.parse(o.items_json),
    total: o.total_rupees,
    status: o.status,
    placedAt: o.created_at,
    updatedAt: o.updated_at,
  }));

  return json({ orders });
}
