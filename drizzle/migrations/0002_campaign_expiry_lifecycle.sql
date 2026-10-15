ALTER TABLE public.campaigns ADD COLUMN completed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.campaigns.completed_at IS 'Time the campaign was manually or automatically completed.';

DROP POLICY IF EXISTS "campaigns_select_active" ON public.campaigns;
CREATE POLICY "campaigns_select_public" ON public.campaigns
FOR SELECT TO anon, authenticated
USING (status IN ('active', 'completed'));

CREATE OR REPLACE FUNCTION public.record_donation(
  _campaign_id UUID,
  _amount NUMERIC,
  _donor_name TEXT DEFAULT NULL,
  _message TEXT DEFAULT NULL,
  _is_anonymous BOOLEAN DEFAULT false,
  _mpesa_transaction_id TEXT DEFAULT NULL
)
RETURNS public.donations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _donor UUID := auth.uid();
  _row public.donations;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Donation amount must be greater than zero';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.campaigns
    WHERE id = _campaign_id
      AND status = 'active'
      AND (deadline IS NULL OR deadline >= (now() AT TIME ZONE 'Africa/Nairobi')::date)
  ) THEN
    RAISE EXCEPTION 'Campaign is not accepting donations';
  END IF;

  INSERT INTO public.donations (campaign_id, donor_id, donor_name, amount, message, is_anonymous, mpesa_transaction_id)
  VALUES (
    _campaign_id,
    CASE WHEN _is_anonymous THEN NULL ELSE _donor END,
    CASE WHEN _is_anonymous THEN NULL ELSE NULLIF(btrim(COALESCE(_donor_name, '')), '') END,
    _amount,
    NULLIF(btrim(COALESCE(_message, '')), ''),
    _is_anonymous,
    _mpesa_transaction_id
  )
  RETURNING * INTO _row;

  UPDATE public.campaigns
  SET current_amount = current_amount + _amount
  WHERE id = _campaign_id;

  RETURN _row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_donation(uuid, numeric, text, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_donation(uuid, numeric, text, text, boolean, text) TO service_role;