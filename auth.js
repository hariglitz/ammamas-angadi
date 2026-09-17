// auth.js — customer phone+OTP login for Ammama's Angadi
// Import into worker.js and route the two endpoints below into your existing fetch handler.

const OTP_TTL_MINUTES = 5;
const SESSION_TTL_DAYS = 30;
const MAX_OTP_ATTEMPTS = 5;

function randomHex(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateOTP() {
  // 6-digit numeric code
  return String(Math.floor(100000 + Math.random() * 900000));
}

function normalizePhone(raw) {
  // Keep last 10 digits — strips +91 / spaces / dashes if the user includes them
  const digits = (raw || "").replace(/\D/g, "");
  return digits.slice(-10);
}

function cookieHeader(name, value, maxAgeSeconds) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? match[1] : null;
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// --- Plug in your SMS provider here. Only ONE of these needs real credentials. ---
async function sendOTP(phone, code, env) {
  const provider = env.SMS_PROVIDER; // "msg91" | "fast2sms" | "twilio"

  if (provider === "msg91") {
    // https://docs.msg91.com/reference/send-otp
    const res = await fetch("https://control.msg91.com/api/v5/otp", {
      method: "POST",
      headers: { "Content-Type": "application/json", authkey: env.MSG91_AUTH_KEY },
      body: JSON.stringify({
        template_id: env.MSG91_TEMPLATE_ID,
        mobile: `91${phone}`,
        otp: code,
      }),
    });
    if (!res.ok) throw new Error(`MSG91 send failed: ${await res.text()}`);
    return;
  }

  if (provider === "fast2sms") {
    // https://docs.fast2sms.com/#send-otp-message
    const res = await fetch(
      `https://www.fast2sms.com/dev/bulkV2?authorization=${env.FAST2SMS_API_KEY}&route=otp&variables_values=${code}&flash=0&numbers=${phone}`
    );
    if (!res.ok) throw new Error(`Fast2SMS send failed: ${await res.text()}`);
    return;
  }

  if (provider === "twilio") {
    const creds = btoa(`${env.TWILIO_SID}:${env.TWILIO_AUTH_TOKEN}`);
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${creds}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: `+91${phone}`,
          From: env.TWILIO_FROM_NUMBER,
          Body: `Your Ammama's Angadi verification code is ${code}. Valid for ${OTP_TTL_MINUTES} minutes.`,
        }),
      }
    );
    if (!res.ok) throw new Error(`Twilio send failed: ${await res.text()}`);
    return;
  }

  // No provider configured — dev fallback so you can test the flow locally.
  // NEVER leave this branch reachable in production: it silently "succeeds" without texting anyone.
  console.log(`[DEV] OTP for ${phone}: ${code}`);
}

// POST /api/auth/request-otp   body: { phone }
export async function handleRequestOtp(request, env) {
  const { phone: rawPhone } = await request.json();
  const phone = normalizePhone(rawPhone);
  if (phone.length !== 10) return json({ error: "Enter a valid 10-digit phone number" }, 400);

  const code = generateOTP();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();

  // Invalidate any earlier unused codes for this number, then insert the new one
  await env.DB.prepare(`DELETE FROM otp_codes WHERE phone = ?`).bind(phone).run();
  await env.DB.prepare(
    `INSERT INTO otp_codes (phone, code, expires_at) VALUES (?, ?, ?)`
  ).bind(phone, code, expiresAt).run();

  try {
    await sendOTP(phone, code, env);
  } catch (err) {
    return json({ error: "Could not send OTP right now. Please try again." }, 502);
  }

  return json({ ok: true, message: `OTP sent to ${phone}` });
}

// POST /api/auth/verify-otp   body: { phone, code }
export async function handleVerifyOtp(request, env) {
  const { phone: rawPhone, code } = await request.json();
  const phone = normalizePhone(rawPhone);

  const row = await env.DB.prepare(
    `SELECT * FROM otp_codes WHERE phone = ? ORDER BY created_at DESC LIMIT 1`
  ).bind(phone).first();

  if (!row) return json({ error: "No OTP requested for this number" }, 400);
  if (row.attempts >= MAX_OTP_ATTEMPTS)
    return json({ error: "Too many attempts. Request a new OTP." }, 429);
  if (new Date(row.expires_at) < new Date())
    return json({ error: "OTP expired. Request a new one." }, 400);

  if (row.code !== String(code)) {
    await env.DB.prepare(`UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = ?`)
      .bind(phone).run();
    return json({ error: "Incorrect OTP" }, 400);
  }

  // Success — clean up the OTP, ensure a customer row exists, issue a session
  await env.DB.prepare(`DELETE FROM otp_codes WHERE phone = ?`).bind(phone).run();
  await env.DB.prepare(
    `INSERT INTO customers (phone) VALUES (?) ON CONFLICT(phone) DO NOTHING`
  ).bind(phone).run();

  const token = randomHex(32);
  const sessionExpiry = new Date(Date.now() + SESSION_TTL_DAYS * 86400 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO sessions (token, phone, expires_at) VALUES (?, ?, ?)`
  ).bind(token, phone, sessionExpiry).run();

  return json(
    { ok: true },
    200,
    { "Set-Cookie": cookieHeader("aa_session", token, SESSION_TTL_DAYS * 86400) }
  );
}

// Middleware — call at the top of any customer-only route
export async function requireCustomer(request, env) {
  const token = getCookie(request, "aa_session");
  if (!token) return null;

  const row = await env.DB.prepare(
    `SELECT phone, expires_at FROM sessions WHERE token = ?`
  ).bind(token).first();

  if (!row || new Date(row.expires_at) < new Date()) return null;
  return row.phone;
}

export { normalizePhone, json, getCookie, cookieHeader, randomHex };
