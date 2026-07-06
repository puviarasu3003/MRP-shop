// Supabase Edge Function: verify-payment
//
// Verifies a Razorpay payment's HMAC-SHA256 signature server-side using
// your Key Secret. This confirms the payment truly came from Razorpay and
// wasn't forged/tampered with by a malicious client.
//
// Requires the order to have been created via create-razorpay-order first
// (so razorpay_order_id / razorpay_signature are actually present in the
// checkout handler's response) — a client-only checkout has nothing to
// verify.
//
// SETUP:
// 1. Uses the SAME secrets as create-razorpay-order:
//      RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
//    (Set once in Supabase Dashboard -> Edge Functions -> Secrets; both
//    functions can read them.)
// 2. Deploy this as a function named exactly: verify-payment
// 3. In this function's Settings tab, turn OFF "Verify JWT with legacy
//    secret" — the anon key is used for CORS/API access, not auth, and
//    the Razorpay signature check below is what actually secures this.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Constant-time string comparison to avoid leaking signature bytes via
// response-timing differences (a `!==` comparison exits early on the
// first mismatched character, which is measurable over many requests).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    if (!keySecret) {
      throw new Error("RAZORPAY_KEY_SECRET not set in function secrets");
    }

    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } =
      await req.json();

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      throw new Error(
        "Missing payment_id/order_id/signature — was the order created " +
          "server-side via create-razorpay-order before checkout opened?",
      );
    }

    const expected = await hmacSha256Hex(
      keySecret,
      `${razorpay_order_id}|${razorpay_payment_id}`,
    );

    if (!timingSafeEqual(expected, razorpay_signature)) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Signature mismatch — payment could not be verified",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        verified: true,
        payment_id: razorpay_payment_id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
