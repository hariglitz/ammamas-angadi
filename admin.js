// admin.js — single-admin password login + full order visibility/management
import { json, getCookie, cookieHeader, randomHex } from "./auth.js";

const ADMIN_SESSION_TTL_HOURS = 12;
const VALID_STATUSES = ["paid", "packed", "shipped", "delivered", "cancelled"];

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// POST /api/admin/login   body: { password }
// env.ADMIN_PASSWORD_HASH is the sha256 hex of your chosen admin password (see INTEGRATION.md
// for a one-line command to generate it). Never store the plain password as a secret.
export async function handleAdminLogin(request, env) {
  const { password } = await request.json();
  const hash = await sha256Hex(password || "");

  if (hash !== env.ADMIN_PASSWORD_HASH) {
    return json({ error: "Incorrect password" }, 401);
  }

  const token = randomHex(32);
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_HOURS * 3600 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)`
  ).bind(token, expiresAt).run();

  return json(
    { ok: true },
    200,
    { "Set-Cookie": cookieHeader("aa_admin_session", token, ADMIN_SESSION_TTL_HOURS * 3600) }
  );
}

// Middleware — call at the top of every /api/admin/* route (except login)
export async function requireAdmin(request, env) {
  const token = getCookie(request, "aa_admin_session");
  if (!token) return false;

  const row = await env.DB.prepare(
    `SELECT expires_at FROM admin_sessions WHERE token = ?`
  ).bind(token).first();

  return !!row && new Date(row.expires_at) > new Date();
}

// GET /api/admin/orders?status=paid   (status filter optional; "pending" = paid+packed, i.e. needs action)
export async function handleAdminListOrders(request, env) {
  if (!(await requireAdmin(request, env))) return json({ error: "Not logged in" }, 401);

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status");

  let query = `SELECT * FROM orders`;
  const binds = [];
  if (statusFilter === "pending") {
    query += ` WHERE status IN ('paid', 'packed')`;
  } else if (statusFilter && VALID_STATUSES.includes(statusFilter)) {
    query += ` WHERE status = ?`;
    binds.push(statusFilter);
  }
  query += ` ORDER BY created_at DESC`;

  const stmt = binds.length ? env.DB.prepare(query).bind(...binds) : env.DB.prepare(query);
  const { results } = await stmt.all();

  const orders = results.map((o) => ({
    id: o.id,
    phone: o.phone,
    customerName: o.customer_name,
    address: o.address,
    items: JSON.parse(o.items_json),
    total: o.total_rupees,
    status: o.status,
    razorpayPaymentId: o.razorpay_payment_id,
    placedAt: o.created_at,
    updatedAt: o.updated_at,
  }));

  return json({ orders });
}

// POST /api/admin/orders/:id/status   body: { status }
export async function handleAdminUpdateStatus(request, env, orderId) {
  if (!(await requireAdmin(request, env))) return json({ error: "Not logged in" }, 401);

  const { status } = await request.json();
  if (!VALID_STATUSES.includes(status)) return json({ error: "Invalid status" }, 400);

  await env.DB.prepare(
    `UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(status, orderId).run();

  return json({ ok: true });
}
