const products = {
  'tapioca-chips': { name: 'Tapioca Chips', price: 100 },
  'palak-ribbon-pakoda': { name: 'Palak Ribbon Pakoda', price: 100 },
  thattai: { name: 'Thattai', price: 100 },
  'carrot-chips': { name: 'Carrot Chips', price: 100 },
  'beetroot-finger-chips': { name: 'Beetroot Finger Chips', price: 100 },
  'sweet-banana-chips': { name: 'Sweet Banana Chips', price: 100 },
  'andhra-murukku': { name: 'Andhra Murukku', price: 100 },
  'idli-podi': { name: 'Idli Podi', price: 140 },
  'milagai-podi': { name: 'Milagai Podi', price: 150 },
  'curry-leaf-podi': { name: 'Curry Leaf Podi', price: 160 },
  'garlic-podi': { name: 'Garlic Podi', price: 150 },
  'health-mix': { name: 'Health Mix', price: 200 },
  'ragi-health-mix': { name: 'Ragi Health Mix', price: 320 },
  'sambar-podi': { name: 'Sambar Podi', price: 180 },
  'rasam-podi': { name: 'Rasam Podi', price: 170 },
  'chettinad-masala': { name: 'Chettinad Masala', price: 200 },
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

async function hmacHex(secret, payload) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function sameSignature(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

async function createOrder(request, env) {
  const { items, customer } = await request.json();
  if (!Array.isArray(items) || !items.length || !customer?.name || !customer?.phone || !customer?.email || !customer?.address) {
    return json({ error: 'Please add items and all delivery details.' }, 400);
  }
  let total = 0;
  const receiptItems = [];
  for (const item of items) {
    const product = products[item?.id];
    const quantity = Number(item?.quantity);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 25) return json({ error: 'Your basket contains an invalid item.' }, 400);
    total += product.price * quantity;
    receiptItems.push(`${product.name} x${quantity}`);
  }
  const receipt = `ammama_${crypto.randomUUID().replaceAll('-', '').slice(0, 30)}`;
  const razorpay = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: total * 100, currency: 'INR', receipt, notes: { customer_name: customer.name.slice(0, 80), customer_phone: customer.phone.slice(0, 20), items: receiptItems.join(', ').slice(0, 240) } }),
  });
  const order = await razorpay.json();
  if (!razorpay.ok) {
    console.error('Razorpay order error', order);
    return json({ error: 'Unable to start secure payment. Please try again.' }, 502);
  }
  return json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: env.RAZORPAY_KEY_ID });
}

async function verifyPayment(request, env) {
  const { razorpay_payment_id: paymentId, razorpay_order_id: orderId, razorpay_signature: signature } = await request.json();
  if (!paymentId || !orderId || !signature) return json({ error: 'Missing payment confirmation.' }, 400);
  const expected = await hmacHex(env.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`);
  if (!sameSignature(expected, signature)) return json({ error: 'Payment verification failed.' }, 400);
  return json({ verified: true });
}

async function verifyWebhook(request, env) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature');
  const expected = await hmacHex(env.RAZORPAY_WEBHOOK_SECRET, rawBody);
  if (!sameSignature(expected, signature)) return new Response('Invalid signature', { status: 400 });
  console.log('Verified Razorpay webhook:', rawBody);
  return new Response('ok');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/create-order') return createOrder(request, env);
    if (request.method === 'POST' && url.pathname === '/api/verify-payment') return verifyPayment(request, env);
    if (request.method === 'POST' && url.pathname === '/api/razorpay-webhook') return verifyWebhook(request, env);
    return env.ASSETS.fetch(request);
  },
};
