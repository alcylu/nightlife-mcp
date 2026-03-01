-- VIP table chart image storage bucket + policies.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT
  'vip-table-charts',
  'vip-table-charts',
  true,
  10485760, -- 10MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
WHERE NOT EXISTS (
  SELECT 1
  FROM storage.buckets
  WHERE id = 'vip-table-charts'
);

DROP POLICY IF EXISTS "service role all vip table charts" ON storage.objects;
CREATE POLICY "service role all vip table charts"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'vip-table-charts')
  WITH CHECK (bucket_id = 'vip-table-charts');

DROP POLICY IF EXISTS "public read vip table charts" ON storage.objects;
CREATE POLICY "public read vip table charts"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'vip-table-charts');
