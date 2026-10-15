-- 1. record_donation must only be callable by the server (service role), never by anon or signed-in users directly
REVOKE EXECUTE ON FUNCTION public.record_donation(uuid, numeric, text, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_donation(uuid, numeric, text, text, boolean, text) TO service_role;

-- 2. Stop public reads of the raw donations table (it contains mpesa_transaction_id and anonymous donors' names)
DROP POLICY IF EXISTS donations_select_all ON public.donations;
REVOKE SELECT ON public.donations FROM anon, authenticated;

-- 3. Safe public view: hides payment transaction IDs entirely and masks donor names for anonymous donations
CREATE OR REPLACE VIEW public.donation_feed
AS
SELECT
  id,
  campaign_id,
  CASE WHEN is_anonymous THEN NULL ELSE donor_name END AS donor_name,
  amount,
  message,
  is_anonymous,
  created_at
FROM public.donations;

GRANT SELECT ON public.donation_feed TO anon, authenticated;
GRANT SELECT ON public.donation_feed TO service_role;