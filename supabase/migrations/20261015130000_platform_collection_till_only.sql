-- Organizers now enter only their Buy Goods till. Harambee collects with its own Daraja
-- account (credentials live in server env, not the database) and owes each organizer
-- what their campaigns raised.
DELETE FROM public.organizer_payment_settings WHERE till_number IS NULL;

ALTER TABLE public.organizer_payment_settings
  DROP CONSTRAINT IF EXISTS organizer_payment_settings_check,
  DROP COLUMN shortcode_type,
  DROP COLUMN business_shortcode,
  DROP COLUMN account_reference,
  DROP COLUMN display_name,
  DROP COLUMN consumer_key_enc,
  DROP COLUMN consumer_secret_enc,
  DROP COLUMN passkey_enc,
  ALTER COLUMN till_number SET NOT NULL;

-- Payout ledger: a successful payment is owed to the organizer's till until paid out.
ALTER TABLE public.payment_requests
  ADD COLUMN payout_status TEXT NOT NULL DEFAULT 'pending' CHECK (payout_status IN ('pending','paid')),
  ADD COLUMN payout_reference TEXT,
  ADD COLUMN paid_out_at TIMESTAMPTZ;
CREATE INDEX payment_requests_owed_idx ON public.payment_requests (owner_id)
  WHERE status = 'success' AND payout_status = 'pending';

-- Organizers can see how much is owed to them (not the phone numbers).
CREATE OR REPLACE FUNCTION public.my_payout_summary()
RETURNS TABLE (owed NUMERIC, paid NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE payout_status = 'pending'), 0),
    COALESCE(SUM(amount) FILTER (WHERE payout_status = 'paid'), 0)
  FROM public.payment_requests
  WHERE owner_id = auth.uid() AND status = 'success';
$$;
REVOKE EXECUTE ON FUNCTION public.my_payout_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_payout_summary() TO authenticated;
