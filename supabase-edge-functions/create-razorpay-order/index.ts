// Supabase Edge Function: create-razorpay-order
//
// Creates a Razorpay Order server-side (using your Key Secret, which is
// never exposed to the browser). This is required for signature
// verification to work — without a server-created order_id, Razorpay
// checkout has nothing to sign.
//
// SETUP:
// 1. In Supabase Dashboard -> Edge Functions -> Secrets, add:
//      RAZORPAY_KEY_ID     = rzp_test_xxxxxxxxxxxx   (same as RAZORPAY_KEY_ID in mrpindex.html)
//      RAZORPAY_KEY_SECRET = your Key Secret from Razorpay Dashboard -> API Keys
//    (Never put the Key Secret in your website's frontend files.)
// 2. Deploy this as a function named exactly: create-razorpay-order
//    (or update supabase.js's fnUrl if you name it differently)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  // Browser always sends this before the real POST — must return 200
  // with CORS headers or every request gets blocked before it starts.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const keyId = Deno.env.get("RAZORPAY_KEY_ID");
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    if (!keyId || !keySecret) {
      throw new Error(
        "RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set in function secrets",
      );
    }

    const { amount, currency = "INR", receipt } = await req.json();
    if (!amount || typeof amount !== "number" || amount <= 0) {
      throw new Error("Invalid amount (must be a positive number, in paise)");
    }

    const basicAuth = btoa(`${keyId}:${keySecret}`);
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${basicAuth}`,
      },
      body: JSON.stringify({
        amount: Math.round(amount),
        currency,
        receipt: receipt || `order_${Date.now()}`,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(
        data?.error?.description || "Razorpay order creation failed",
      );
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
