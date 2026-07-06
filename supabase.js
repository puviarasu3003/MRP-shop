// supabase.js
// Supabase client + data-access layer for MRP Mens Wear.
// Uses the global @supabase/supabase-js UMD build loaded via CDN in mrpindex.html.
// Exposes a single `MRPDB` object with typed helpers for products and orders.

(function () {
  "use strict";

  const cfg = window.SUPABASE_CONFIG || {};
  if (!cfg.url || !cfg.anonKey) {
    console.error(
      "[MRP] Supabase config missing. Check supabase_config.js / .env",
    );
  }

  // The UMD build exposes window.supabase (createClient).
  const createClient =
    (window.supabase && window.supabase.createClient) ||
    (window.supabaseJs && window.supabaseJs.createClient);

  if (!createClient) {
    console.error("[MRP] @supabase/supabase-js UMD not loaded");
    return;
  }

  const supabase = createClient(cfg.url, cfg.anonKey, cfg.options || {});

  // ---- Products ----------------------------------------------------------

  async function fetchProducts() {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("active", true)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function fetchProductById(id) {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // ---- Orders ------------------------------------------------------------

  async function createOrder(order) {
    // order: { customer_name, phone, address, city, state, pincode, items,
    //         subtotal, shipping, total, payment_method, payment_status,
    //         razorpay_order_id?, razorpay_payment_id?, status }
    const cleanOrder = { ...order };
    delete cleanOrder.items;
    const { data, error } = await supabase
      .from("orders")
      .insert(cleanOrder)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  async function createOrderItems(items) {
    if (!items || items.length === 0) return [];
    let { data, error } = await supabase
      .from("order_items")
      .insert(items)
      .select();
    if (error && /schema cache/i.test(error.message || "")) {
      // PostgREST reports a column it doesn't recognize (e.g. this table
      // was created without a product_name column). Extract the bad
      // column name from the error text and retry without it, instead of
      // silently dropping the whole order_items write.
      const m = /'([^']+)' column/.exec(error.message);
      const badCol = m && m[1];
      if (badCol) {
        const trimmedItems = items.map((it) => {
          const copy = { ...it };
          delete copy[badCol];
          return copy;
        });
        console.warn(
          `[MRP] order_items has no '${badCol}' column — retrying insert without it. ` +
            `Add it with: ALTER TABLE order_items ADD COLUMN ${badCol} text;`,
        );
        ({ data, error } = await supabase
          .from("order_items")
          .insert(trimmedItems)
          .select());
      }
    }
    if (error) throw error;
    return data || [];
  }

  async function updateOrder(id, patch) {
    const { data, error } = await supabase
      .from("orders")
      .update(patch)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function deleteOrder(id) {
    const { error } = await supabase.from("orders").delete().eq("id", id);
    if (error) throw error;
    const { error: itemsError } = await supabase
      .from("order_items")
      .delete()
      .eq("order_id", id);
    if (itemsError) throw itemsError;
  }

  async function fetchOrdersByPhone(phone) {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("phone", phone)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function fetchOrderById(id) {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function fetchOrderItems(orderId) {
    const { data, error } = await supabase
      .from("order_items")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  // ---- Stock deduction (server-side RPC) --------------------------------

  async function deductStock(productId, size, qty) {
    const normalizedQty = Number(qty) || 0;
    if (!productId || !size || normalizedQty <= 0) return null;

    let rpcResult = null;
    try {
      const { data, error } = await supabase.rpc("deduct_product_stock", {
        p_product_id: productId,
        p_size: size,
        p_qty: normalizedQty,
      });
      if (!error) return data;
      else {
        console.warn(
          "[MRP] deduct_product_stock RPC failed, using fallback:",
          error.message,
        );
      }
    } catch (e) {
      console.warn(
        "[MRP] deduct_product_stock RPC exception, using fallback:",
        e.message,
      );
    }

    const { data: product, error: fetchErr } = await supabase
      .from("products")
      .select("id, sizes, total_stock")
      .eq("id", productId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!product) throw new Error("Product not found");

    const sizes = Array.isArray(product.sizes)
      ? product.sizes.map((entry) => ({ ...entry }))
      : [];
    const target = sizes.find(
      (entry) =>
        String(entry.size).toLowerCase() === String(size).toLowerCase(),
    );

    if (target) {
      const current = Number(target.stock || 0);
      if (current < normalizedQty) {
        throw new Error("Insufficient stock for selected size");
      }
      target.stock = current - normalizedQty;
    } else {
      const currentTotal = Number(product.total_stock || 0);
      if (currentTotal < normalizedQty) {
        throw new Error("Insufficient stock for selected size");
      }
      if (!sizes.length) {
        sizes.push({ size, stock: currentTotal - normalizedQty });
      }
    }

    const nextTotal = sizes.reduce(
      (sum, entry) => sum + (Number(entry.stock) || 0),
      0,
    );
    const { error: updateErr } = await supabase
      .from("products")
      .update({ sizes, total_stock: nextTotal })
      .eq("id", productId);
    if (updateErr) throw updateErr;

    return rpcResult || { sizes, total_stock: nextTotal };
  }

  async function getProductStock(productId) {
    try {
      const { data, error } = await supabase.rpc("get_product_stock", {
        p_product_id: productId,
      });
      if (!error) return data;
      console.warn(
        "[MRP] get_product_stock RPC failed, using fallback:",
        error.message,
      );
    } catch (e) {
      console.warn(
        "[MRP] get_product_stock RPC exception, using fallback:",
        e.message,
      );
    }

    const { data: product, error: fetchErr } = await supabase
      .from("products")
      .select("id, sizes, total_stock")
      .eq("id", productId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!product) return null;
    return {
      id: product.id,
      total_stock: Number(product.total_stock || 0),
      sizes: Array.isArray(product.sizes) ? product.sizes : [],
    };
  }

  // ---- Server-side Razorpay order creation (edge function) -------------
  // Must run BEFORE opening Razorpay Checkout. Razorpay only returns a
  // signature in the handler callback if checkout was opened with a real
  // order_id created server-side (with your Key Secret) — client-only
  // checkout has nothing to sign, so verify-payment can never succeed
  // without this step.
  async function createRazorpayOrder(amountPaise, receipt) {
    const fnUrl = `${cfg.url}/functions/v1/create-razorpay-order`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let res;
    try {
      res = await fetch(fnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.anonKey}`,
          apikey: cfg.anonKey,
        },
        body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt }),
        signal: controller.signal,
      });
    } catch (e) {
      if (e.name === "AbortError") throw new Error("Order creation timed out");
      throw new Error(`Order creation failed: ${e.message}`);
    } finally {
      clearTimeout(timeout);
    }
    const data = await res.json().catch(() => ({}));
    const normalized =
      data &&
      typeof data === "object" &&
      data.order &&
      typeof data.order === "object"
        ? data.order
        : data;
    if (!res.ok || !normalized?.id) {
      throw new Error(
        data.error || data.message || `Order creation failed (${res.status})`,
      );
    }
    return normalized;
  }

  // ---- Payment verification (edge function) ----------------------------

  async function verifyPayment(payload) {
    const fnUrl = `${cfg.url}/functions/v1/verify-payment`;
    // Guard with a timeout: if the edge function isn't deployed / CORS is
    // misconfigured (fails the OPTIONS preflight), fetch would otherwise
    // hang or reject slowly. Fail fast so the caller's fallback path runs
    // quickly instead of blocking the checkout UI.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    let res;
    try {
      res = await fetch(fnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.anonKey}`,
          apikey: cfg.anonKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (e) {
      if (e.name === "AbortError") {
        throw new Error("Payment verification service is unavailable");
      }
      const msg = String(e?.message || "");
      if (/failed to fetch|network|load failed|fetch/i.test(msg)) {
        throw new Error("Payment verification service is unavailable");
      }
      throw new Error(`Verification request failed: ${e.message}`);
    } finally {
      clearTimeout(timeout);
    }
    const data = await res.json().catch(() => ({}));
    if (
      res.status === 404 ||
      /not found|function/i.test(String(data.error || ""))
    ) {
      throw new Error("Payment verification service is unavailable");
    }
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `Verification failed (${res.status})`);
    }
    return data;
  }

  // ---- Health check (optional) -----------------------------------------

  async function ping() {
    const { error } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true });
    return !error;
  }

  // ==================== AUTHENTICATION ====================

  /**
   * Sign up a new customer with email and password
   * @param {string} email - Customer's email address
   * @param {string} password - Customer's password (min 6 characters)
   * @param {object} metadata - Optional metadata (full_name, phone)
   * @returns {object} - { user, session, error }
   */
  async function signUp(email, password, metadata = {}) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
      },
    });
    return { user: data?.user, session: data?.session, error };
  }

  /**
   * Sign in with email and password
   * @param {string} email - Customer's email address
   * @param {string} password - Customer's password
   * @returns {object} - { user, session, error }
   */
  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { user: data?.user, session: data?.session, error };
  }

  /**
   * Sign out the current user
   * @returns {object} - { error }
   */
  async function signOut() {
    const { error } = await supabase.auth.signOut();
    return { error };
  }

  /**
   * Send password reset email
   * @param {string} email - Email address to send reset link to
   * @returns {object} - { error }
   */
  async function resetPassword(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo:
        window.location.origin + window.location.pathname + "?reset=true",
    });
    return { error };
  }

  /**
   * Get the current authenticated user
   * @returns {object} - { user, error }
   */
  async function getCurrentUser() {
    const { data, error } = await supabase.auth.getUser();
    return { user: data?.user, error };
  }

  /**
   * Get the current session (includes user + access token)
   * @returns {object} - { session, error }
   */
  async function getSession() {
    const { data, error } = await supabase.auth.getSession();
    return { session: data?.session, error };
  }

  /**
   * Listen for authentication state changes
   * @param {function} callback - Called with { user, session } on auth changes
   * @returns {function} - Unsubscribe function
   */
  function onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange((event, session) => {
      callback({ event, user: session?.user ?? null, session });
    });
  }

  /**
   * Update the current user's password
   * @param {string} newPassword - New password (min 6 characters)
   * @returns {object} - { user, error }
   */
  async function updatePassword(newPassword) {
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    return { user: data?.user, error };
  }

  /**
   * Update user metadata (full_name, phone)
   * @param {object} metadata - { full_name?, phone? }
   * @returns {object} - { user, error }
   */
  async function updateUserMetadata(metadata) {
    const { data, error } = await supabase.auth.updateUser({
      data: metadata,
    });
    return { user: data?.user, error };
  }

  // ==================== CUSTOMER PROFILE ====================

  /**
   * Fetch customer profile by user ID
   * @param {string} userId - Supabase user ID
   * @returns {object} - { profile, error }
   */
  async function fetchProfile(userId) {
    const { data, error } = await supabase
      .from("customer_profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    return { profile: data, error };
  }

  /**
   * Create or update customer profile
   * @param {string} userId - Supabase user ID
   * @param {object} profileData - { full_name, phone, address?, city?, state?, pincode? }
   * @returns {object} - { profile, error }
   */
  async function upsertProfile(userId, profileData) {
    const { data, error } = await supabase
      .from("customer_profiles")
      .upsert(
        {
          id: userId,
          ...profileData,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      )
      .select()
      .maybeSingle();
    return { profile: data, error };
  }

  // ==================== CUSTOMER ORDERS ====================

  /**
   * Fetch orders for the authenticated user (uses RLS)
   * @param {string} userId - Supabase user ID
   * @returns {array} - Array of orders
   */
  async function fetchCustomerOrders(userId) {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  /**
   * Fetch a single order for the authenticated user (uses RLS)
   * @param {string} orderId - Order ID
   * @returns {object} - Order or null
   */
  async function fetchCustomerOrderById(orderId) {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  /**
   * Fetch order items for a specific order
   * @param {string} orderId - Order ID
   * @returns {array} - Array of order items
   */
  async function fetchCustomerOrderItems(orderId) {
    const { data, error } = await supabase
      .from("order_items")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  // ==================== LINK EXISTING ORDERS ====================

  /**
   * Link existing orders (by phone) to a user account
   * Use this when a customer signs up/logs in to claim their existing orders
   * @param {string} userId - Supabase user ID
   * @param {string} phone - Phone number to match orders
   * @returns {object} - { count, error }
   */
  async function linkOrdersToUser(userId, phone) {
    const { data, error, count } = await supabase
      .from("orders")
      .update({ user_id: userId })
      .eq("phone", phone)
      .is("user_id", null)
      .select("*", { count: "exact" });
    return { count: count || 0, error };
  }

  const MRPDB = {
    client: supabase,
    fetchProducts,
    fetchProductById,
    createOrder,
    createOrderItems,
    updateOrder,
    deleteOrder,
    fetchOrdersByPhone,
    fetchOrderById,
    fetchOrderItems,
    deductStock,
    getProductStock,
    verifyPayment,
    createRazorpayOrder,
    ping,
    // Auth
    signUp,
    signIn,
    signOut,
    resetPassword,
    getCurrentUser,
    getSession,
    onAuthStateChange,
    updatePassword,
    updateUserMetadata,
    // Profile
    fetchProfile,
    upsertProfile,
    // Customer orders
    fetchCustomerOrders,
    fetchCustomerOrderById,
    fetchCustomerOrderItems,
    linkOrdersToUser,
  };

  window.MRPDB = MRPDB;
})();
