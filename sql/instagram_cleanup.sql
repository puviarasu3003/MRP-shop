-- ============================================================
-- MRP Mens Wear - Instagram Share System Database Cleanup
-- Run these queries in your Supabase SQL Editor to safely remove
-- all Instagram-related database tables and columns.
-- ============================================================

-- 1. Drop the Instagram automation mapping, logs, and redirect links tables
DROP TABLE IF EXISTS public.instagram_mappings CASCADE;
DROP TABLE IF EXISTS public.instagram_logs CASCADE;
DROP TABLE IF EXISTS public.instagram_post_links CASCADE;

-- 2. Remove Instagram-specific columns from the products table
ALTER TABLE public.products DROP COLUMN IF EXISTS instagram_caption CASCADE;
ALTER TABLE public.products DROP COLUMN IF EXISTS instagram_status CASCADE;
ALTER TABLE public.products DROP COLUMN IF EXISTS shared_at CASCADE;
ALTER TABLE public.products DROP COLUMN IF EXISTS product_url CASCADE;

-- 3. Force reload PostgREST schema cache so Supabase immediately registers the schema updates
NOTIFY pgrst, 'reload schema';
