// admin_supabase.js
// Supabase data-access layer for MRP Mens Wear Admin Panel
// Connects to same Supabase project as customer website

(function () {
  "use strict";

  const cfg = window.SUPABASE_CONFIG || {};
  if (!cfg.url || !cfg.anonKey) {
    console.error(
      "[MRP Admin] Supabase config missing. Check supabase_config.js",
    );
    return;
  }

  const createClient =
    (window.supabase && window.supabase.createClient) ||
    (window.supabaseJs && window.supabaseJs.createClient);

  if (!createClient) {
    console.error("[MRP Admin] @supabase/supabase-js not loaded");
    return;
  }

  // Isolated auth session: never share storage with the customer site's
  // Supabase client, even though both load on the same origin. Without
  // this, logging into the admin panel would also "log in" the customer
  // storefront (and vice versa) via the shared default storage key.
  const adminOptions = {
    ...(cfg.options || {}),
    auth: {
      ...((cfg.options && cfg.options.auth) || {}),
      storageKey: "sb-mrp-admin-auth",
    },
  };

  const supabase = createClient(cfg.url, cfg.anonKey, adminOptions);

  // ── Auth ─────────────────────────────────────────────────────

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  async function getSession() {
    const { data } = await supabase.auth.getSession();
    return data.session;
  }

  function onAuthStateChange(cb) {
    return supabase.auth.onAuthStateChange(cb);
  }

  function isAdminFromUser(user) {
    if (!user) return false;
    const role = user.app_metadata && user.app_metadata.role;
    return role === "admin";
  }

  async function checkIsAdmin() {
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session && sessionData.session.user;
    if (isAdminFromUser(user)) return true;

    try {
      const { data, error } = await supabase.rpc("is_admin");
      if (!error && data === true) return true;
    } catch (_e) {
      /* RPC may not be deployed */
    }

    return false;
  }

  // ── Date Range Helpers ────────────────────────────────────────

  function todayRange() {
    const s = new Date();
    s.setHours(0, 0, 0, 0);
    const e = new Date();
    e.setHours(23, 59, 59, 999);
    return { from: s.toISOString(), to: e.toISOString() };
  }

  function yesterdayRange() {
    const s = new Date();
    s.setDate(s.getDate() - 1);
    s.setHours(0, 0, 0, 0);
    const e = new Date(s);
    e.setHours(23, 59, 59, 999);
    return { from: s.toISOString(), to: e.toISOString() };
  }

  function weekRange() {
    const s = new Date();
    s.setDate(s.getDate() - s.getDay());
    s.setHours(0, 0, 0, 0);
    const e = new Date();
    e.setHours(23, 59, 59, 999);
    return { from: s.toISOString(), to: e.toISOString() };
  }

  function monthRange() {
    const s = new Date();
    s.setDate(1);
    s.setHours(0, 0, 0, 0);
    const e = new Date();
    e.setHours(23, 59, 59, 999);
    return { from: s.toISOString(), to: e.toISOString() };
  }

  function getRangeForFilter(filter) {
    switch (filter) {
      case "today":
        return todayRange();
      case "yesterday":
        return yesterdayRange();
      case "week":
        return weekRange();
      case "month":
        return monthRange();
      default:
        return null;
    }
  }

  // ── Orders ────────────────────────────────────────────────────

  async function fetchOrdersInRange(range) {
    let q = supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });
    if (range) {
      q = q.gte("created_at", range.from).lte("created_at", range.to);
    }
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function fetchOrderStats(filter) {
    const range = getRangeForFilter(filter);
    const orders = await fetchOrdersInRange(range);
    const count = orders.length;
    const earnings = orders.reduce(
      (sum, o) => sum + (parseFloat(o.total) || 0),
      0,
    );
    return { count, earnings };
  }

  async function fetchRecentOrders(limit = 10) {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  async function fetchFilteredOrders(filter) {
    const range = getRangeForFilter(filter);
    return fetchOrdersInRange(range);
  }

  async function fetchAllOrders(page = 0, pageSize = 20) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error, count } = await supabase
      .from("orders")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw error;
    return { orders: data || [], total: count || 0 };
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

  async function updateOrderStatus(id, status) {
    const { data, error } = await supabase
      .from("orders")
      .update({ status })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function resetAllOrders() {
    // Delete all order items first (foreign key constraint)
    const { error: itemsError } = await supabase
      .from("order_items")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (itemsError) throw itemsError;
    // Delete all orders
    const { error } = await supabase
      .from("orders")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) throw error;
  }

  // ── Products ──────────────────────────────────────────────────

  async function fetchAllProducts() {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function fetchLowStockProducts(threshold = 10) {
    // Uses total_stock (denormalized sum of all sizes) since schema has no top-level stock column
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .gt("total_stock", 0)
      .lt("total_stock", threshold)
      .order("total_stock", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function fetchOutOfStockProducts() {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("total_stock", 0)
      .order("name", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function fetchTopSellingProducts(limit = 5) {
    const { data, error } = await supabase
      .from("order_items")
      .select("product_id, quantity");
    if (error) throw error;
    if (!data || data.length === 0) return [];

    const map = {};
    for (const row of data) {
      if (!row.product_id) continue;
      if (!map[row.product_id]) map[row.product_id] = 0;
      map[row.product_id] += row.quantity || 1;
    }

    const sorted = Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    if (sorted.length === 0) return [];

    const ids = sorted.map(([id]) => id);
    const { data: products, error: pe } = await supabase
      .from("products")
      .select("*")
      .in("id", ids);
    if (pe) throw pe;

    return sorted
      .map(([id, totalSold]) => {
        const product = (products || []).find(
          (p) => String(p.id) === String(id),
        );
        return product ? { ...product, totalSold } : null;
      })
      .filter(Boolean);
  }

  async function createProduct(product) {
    const { data, error } = await supabase
      .from("products")
      .insert(product)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function updateProduct(id, patch) {
    const { data, error } = await supabase
      .from("products")
      .update(patch)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function deleteProduct(id) {
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) throw error;
  }

  // ── Storage — Product Images ──────────────────────────────────

  async function uploadProductImage(file, fileName) {
    const { data, error } = await supabase.storage
      .from("product-images")
      .upload(fileName, file, {
        cacheControl: "3600",
        upsert: true,
      });
    if (error) throw error;
    const { data: urlData } = supabase.storage
      .from("product-images")
      .getPublicUrl(fileName);
    return urlData.publicUrl;
  }

  async function deleteProductImage(fileName) {
    const { error } = await supabase.storage
      .from("product-images")
      .remove([fileName]);
    if (error) throw error;
  }

  // ── Realtime ──────────────────────────────────────────────────

  function subscribeToOrders(cb) {
    return supabase
      .channel("admin-orders")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        cb,
      )
      .subscribe();
  }

  function subscribeToProducts(cb) {
    return supabase
      .channel("admin-products")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products" },
        cb,
      )
      .subscribe();
  }

  // ── Customers ───────────────────────────────────────────────

  async function fetchAllCustomers() {
    const { data, error } = await supabase
      .from("customer_profiles")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function fetchCustomerSummaries() {
    const [profiles, orders] = await Promise.all([
      fetchAllCustomers(),
      fetchOrdersInRange(null),
    ]);

    const statsByUser = {};
    const statsByPhone = {};
    for (const order of orders) {
      const total = parseFloat(order.total) || 0;
      if (order.user_id) {
        if (!statsByUser[order.user_id]) {
          statsByUser[order.user_id] = { orderCount: 0, totalSpent: 0 };
        }
        statsByUser[order.user_id].orderCount += 1;
        statsByUser[order.user_id].totalSpent += total;
      }
      if (order.phone) {
        const phone = String(order.phone).trim();
        if (!statsByPhone[phone]) {
          statsByPhone[phone] = { orderCount: 0, totalSpent: 0 };
        }
        statsByPhone[phone].orderCount += 1;
        statsByPhone[phone].totalSpent += total;
      }
    }

    return profiles.map((profile) => {
      const byUser = statsByUser[profile.id] || { orderCount: 0, totalSpent: 0 };
      const byPhone = profile.phone
        ? statsByPhone[String(profile.phone).trim()]
        : null;
      const orderCount = Math.max(byUser.orderCount, byPhone?.orderCount || 0);
      const totalSpent = Math.max(byUser.totalSpent, byPhone?.totalSpent || 0);
      return { ...profile, orderCount, totalSpent };
    });
  }

  // ── Stock Ledger ──────────────────────────────────────────────

  async function fetchStockLedger(productId) {
    const { data, error } = await supabase
      .from("stock_ledger")
      .select("*")
      .eq("product_id", productId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    return data || [];
  }

  // ── Expose globally ───────────────────────────────────────────

  function isPermissionError(error) {
    const msg = String((error && error.message) || "");
    return (
      error?.code === "42501" ||
      /permission|policy|row-level security|not authorized/i.test(msg)
    );
  }

  window.AdminDB = {
    client: supabase,
    // Auth
    signIn,
    signOut,
    getSession,
    onAuthStateChange,
    isAdminFromUser,
    checkIsAdmin,
    isPermissionError,
    // Orders
    fetchOrderStats,
    fetchRecentOrders,
    fetchFilteredOrders,
    fetchAllOrders,
    fetchOrderById,
    fetchOrderItems,
    updateOrderStatus,
    resetAllOrders,
    // Products
    fetchAllProducts,
    fetchLowStockProducts,
    fetchOutOfStockProducts,
    fetchTopSellingProducts,
    createProduct,
    updateProduct,
    deleteProduct,
    // Storage
    uploadProductImage,
    deleteProductImage,
    // Customers
    fetchAllCustomers,
    fetchCustomerSummaries,
    // Stock
    fetchStockLedger,
    // Realtime
    subscribeToOrders,
    subscribeToProducts,
    // Utils
    getRangeForFilter,
  };
})();
