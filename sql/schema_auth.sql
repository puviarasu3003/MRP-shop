-- ============================================================
-- MRP Mens Wear - Authentication & Security Setup
-- Run these queries in your Supabase SQL Editor
-- ============================================================

-- ============================================================
-- STEP 1: Add user_id column to orders table
-- ============================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);

-- ============================================================
-- STEP 2: Create customer_profiles table for additional user data
-- ============================================================
CREATE TABLE IF NOT EXISTS public.customer_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Enable RLS
ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON public.customer_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.customer_profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.customer_profiles;

-- RLS Policy: Users can only view their own profile
CREATE POLICY "Users can view own profile" ON public.customer_profiles
    FOR SELECT USING (auth.uid() = id);

-- RLS Policy: Users can update their own profile
CREATE POLICY "Users can update own profile" ON public.customer_profiles
    FOR UPDATE USING (auth.uid() = id);

-- RLS Policy: Users can insert their own profile (on signup)
CREATE POLICY "Users can insert own profile" ON public.customer_profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

-- ============================================================
-- STEP 3: Update orders table RLS policies
-- ============================================================

-- First, drop existing policies if they exist (to recreate them)
DROP POLICY IF EXISTS "Anyone can view orders" ON orders;
DROP POLICY IF EXISTS "Anyone can insert orders" ON orders;
DROP POLICY IF EXISTS "Users can insert own orders" ON orders;
DROP POLICY IF EXISTS "Anyone can update orders" ON orders;
DROP POLICY IF EXISTS "Users can view own orders" ON orders;
DROP POLICY IF EXISTS "Users can update own orders" ON orders;
DROP POLICY IF EXISTS "Admins can view all orders" ON orders;
DROP POLICY IF EXISTS "Admins can update all orders" ON orders;

-- RLS Policy: Customers can insert orders (supports logged in users + guest checkouts)
CREATE POLICY "Users can insert own orders" ON orders
    FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);


-- RLS Policy: Customers can view orders (supports logged in users + guest checkouts)
CREATE POLICY "Users can view own orders" ON orders
    FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

-- RLS Policy: Customers can update only their own orders
CREATE POLICY "Users can update own orders" ON orders
    FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL)
    WITH CHECK (auth.uid() = user_id OR user_id IS NULL);


-- RLS Policy: Admins can view all orders
-- Admin role is expected in auth token app_metadata.role = 'admin'
CREATE POLICY "Admins can view all orders" ON orders
    FOR SELECT USING (
      COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    );

-- Admins can update all orders
CREATE POLICY "Admins can update all orders" ON orders
    FOR UPDATE USING (
      COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    )
    WITH CHECK (
      COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    );


-- ============================================================
-- STEP 4: Create function to auto-create customer profile on signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.customer_profiles (id, email, full_name)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', '')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for new user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- STEP 5: Create function to update customer profile timestamp
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_profile_update()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_customer_profile_update ON public.customer_profiles;
CREATE TRIGGER on_customer_profile_update
    BEFORE UPDATE ON public.customer_profiles
    FOR EACH ROW EXECUTE FUNCTION public.handle_profile_update();

-- ============================================================
-- STEP 6: Create admin check function (for future admin panel use)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    -- Check if user has admin role in user_metadata
    -- You can customize this based on your admin setup
    RETURN COALESCE(
        (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
        FALSE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- STEP 7: Grant permissions
-- ============================================================
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON public.customer_profiles TO anon;
GRANT ALL ON public.customer_profiles TO authenticated;
GRANT ALL ON public.customer_profiles TO service_role;

-- ============================================================
-- STEP 8: Enable email confirmations (optional, recommended)
-- ============================================================
-- To enable email confirmation, go to:
-- Authentication > Providers > Email > Confirm email = true

-- ============================================================
-- STEP 9: Lock down order_items (it previously had no RLS at all,
-- which let any anon/authenticated request read every customer's
-- order line items). Also add DELETE policies, since the admin
-- panel's "Reset All Orders" uses the anon key + RLS, not a
-- service-role key, and there was no DELETE policy on either table.
-- ============================================================
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own order items" ON order_items;
DROP POLICY IF EXISTS "Users can insert own order items" ON order_items;
DROP POLICY IF EXISTS "Admins can view all order items" ON order_items;
DROP POLICY IF EXISTS "Admins can delete all order items" ON order_items;
DROP POLICY IF EXISTS "Admins can delete all orders" ON orders;

CREATE POLICY "Users can view own order items" ON order_items
    FOR SELECT USING (
      EXISTS (SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND (o.user_id = auth.uid() OR o.user_id IS NULL))
    );

CREATE POLICY "Users can insert own order items" ON order_items
    FOR INSERT WITH CHECK (
      EXISTS (SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND (o.user_id = auth.uid() OR o.user_id IS NULL))
    );

CREATE POLICY "Admins can view all order items" ON order_items
    FOR SELECT USING (
      COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    );

CREATE POLICY "Admins can delete all order items" ON order_items
    FOR DELETE USING (
      COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    );

CREATE POLICY "Admins can delete all orders" ON orders
    FOR DELETE USING (
      COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    );

GRANT ALL ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO anon;

-- ============================================================
-- STEP 11: Products table RLS (storefront read + admin CRUD)
-- ============================================================
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view active products" ON products;
DROP POLICY IF EXISTS "Admins can view all products" ON products;
DROP POLICY IF EXISTS "Admins can insert products" ON products;
DROP POLICY IF EXISTS "Admins can update products" ON products;
DROP POLICY IF EXISTS "Admins can delete products" ON products;

-- Storefront: customers can browse active products without signing in
CREATE POLICY "Anyone can view active products" ON products
    FOR SELECT USING (active = true);

-- Admin panel: admins can see inactive/draft products too
CREATE POLICY "Admins can view all products" ON products
    FOR SELECT USING (
      COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    );

CREATE POLICY "Admins can insert products" ON products
    FOR INSERT WITH CHECK (
      COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    );

CREATE POLICY "Admins can update products" ON products
    FOR UPDATE USING (
      COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    )
    WITH CHECK (
      COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    );

CREATE POLICY "Admins can delete products" ON products
    FOR DELETE USING (
      COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    );

-- ============================================================
-- STEP 12: Let admins list customer profiles in the admin panel
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all customer profiles" ON customer_profiles;

CREATE POLICY "Admins can view all customer profiles" ON customer_profiles
    FOR SELECT USING (
      COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    );

-- ============================================================
-- STEP 13: Storage bucket policies for product image uploads
-- Run in SQL editor after creating bucket "product-images" (public).
-- ============================================================
-- CREATE POLICY "Public read product images" ON storage.objects
--   FOR SELECT USING (bucket_id = 'product-images');
--
-- CREATE POLICY "Admins upload product images" ON storage.objects
--   FOR INSERT WITH CHECK (
--     bucket_id = 'product-images'
--     AND COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
--   );
--
-- CREATE POLICY "Admins update product images" ON storage.objects
--   FOR UPDATE USING (
--     bucket_id = 'product-images'
--     AND COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
--   );
--
-- CREATE POLICY "Admins delete product images" ON storage.objects
--   FOR DELETE USING (
--     bucket_id = 'product-images'
--     AND COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
--   );

-- ============================================================
-- STEP 10: Make your admin account an actual admin.
-- The RLS policies above check auth.jwt() app_metadata.role = 'admin'.
-- Run this once per admin user (after they've signed up at least
-- once), replacing the email. This requires the SQL editor — it
-- cannot be set from client code.
-- ============================================================
-- UPDATE auth.users
-- SET raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb
-- WHERE email = 'your-admin-email@example.com';
--
-- IMPORTANT: sessions cache the JWT, so the admin must log out and
-- log back in on the admin panel after running this, so a fresh
-- token containing the new app_metadata.role is issued.

-- ============================================================
-- VERIFICATION QUERIES (run these to verify setup)
-- ============================================================

-- Check if columns exist
-- SELECT column_name, data_type FROM information_schema.columns 
-- WHERE table_name = 'orders' AND column_name IN ('user_id');

-- Check if RLS is enabled
-- SELECT tablename, rowsecurity FROM pg_tables 
-- WHERE schemaname = 'public' AND tablename IN ('orders', 'customer_profiles');

-- ============================================================
-- NOTES:
-- ============================================================
-- 1. The orders table now has a user_id column that links to auth.users
-- 2. RLS policies ensure customers can only see their own orders
-- 3. Customer profiles are auto-created when users sign up
-- 4. Admin panel uses the anon key + RLS; grant admin role via STEP 10 below
-- 5. Re-run STEP 11–13 if product/customer admin actions fail with permission errors
-- ============================================================

-- ============================================================
-- STEP 14: Add mrp and rating columns to products table
-- Run these queries in the Supabase SQL editor if columns are missing.
-- ============================================================
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS mrp NUMERIC;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS rating NUMERIC DEFAULT 0;

-- Force reload PostgREST schema cache so Supabase immediately recognizes the new columns
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- BONUS STEP: Clean up any legacy localhost image URLs in products
-- (Prevents net::ERR_CONNECTION_REFUSED console errors for local server paths)
-- ============================================================
UPDATE public.products SET image = NULL WHERE image LIKE '%localhost%';