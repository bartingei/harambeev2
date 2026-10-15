-- M-PESA STK PUSH PAYMENTS
-- Donations go straight to each organizer's own Till/Paybill. Harambee only records
-- payments Safaricom confirms, so the "raised" counter reflects real money.

-- Organizer payout details + Daraja credentials. Secrets are AES-GCM encrypted by the
-- server before insert. No anon/authenticated policies: only service_role can touch it.
CREATE TABLE public.organizer_payment_settings (
  owner_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  shortcode_type TEXT NOT NULL CHECK (shortcode_type IN ('till','paybill')),
  -- Paybill number, or for Buy Goods the store/head-office number the passkey belongs to
  business_shortcode TEXT NOT NULL CHECK (business_shortcode ~ '^[0-9]{5,8}$'),
  -- Buy Goods only: the till that receives the money (PartyB)
  till_number TEXT CHECK (till_number IS NULL OR till_number ~ '^[0-9]{5,8}$'),
  account_reference TEXT NOT NULL DEFAULT 'Harambee' CHECK (char_length(account_reference) BETWEEN 1 AND 12),
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 80),
  consumer_key_enc TEXT NOT NULL,
  consumer_secret_enc TEXT NOT NULL,
  passkey_enc TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (shortcode_type = 'paybill' OR till_number IS NOT NULL)
);
REVOKE ALL ON public.organizer_payment_settings FROM anon, authenticated;
GRANT ALL ON public.organizer_payment_settings TO service_role;
ALTER TABLE public.organizer_payment_settings ENABLE ROW LEVEL SECURITY;

-- One row per STK push. Server-only.
CREATE TABLE public.payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount >= 1),
  donor_name TEXT,
  message TEXT,
  is_anonymous BOOLEAN NOT NULL DEFAULT false,
  merchant_request_id TEXT,
  checkout_request_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed')),
  result_code INTEGER,
  result_desc TEXT,
  mpesa_receipt TEXT,
  donation_id UUID REFERENCES public.donations(id) ON DELETE SET NULL,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payment_requests_phone_idx ON public.payment_requests (phone, created_at DESC);
REVOKE ALL ON public.payment_requests FROM anon, authenticated;
GRANT ALL ON public.payment_requests TO service_role;
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

-- A receipt can only ever be counted once.
CREATE UNIQUE INDEX donations_mpesa_receipt_uidx
  ON public.donations (mpesa_transaction_id)
  WHERE mpesa_transaction_id IS NOT NULL;

-- Settle a pending request exactly once (callback and status-query fallback can race).
-- The status query doesn't return a receipt, so a request it settles has none until the
-- callback arrives; a late callback backfills it.
CREATE OR REPLACE FUNCTION public.complete_payment_request(
  _checkout_request_id TEXT,
  _result_code INTEGER,
  _result_desc TEXT DEFAULT NULL,
  _mpesa_receipt TEXT DEFAULT NULL,
  _amount NUMERIC DEFAULT NULL
)
RETURNS public.payment_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _req public.payment_requests;
  _donation public.donations;
  _paid NUMERIC;
BEGIN
  SELECT * INTO _req FROM public.payment_requests
  WHERE checkout_request_id = _checkout_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  _mpesa_receipt := NULLIF(btrim(COALESCE(_mpesa_receipt, '')), '');

  IF _req.status = 'success' AND _req.mpesa_receipt IS NULL AND _result_code = 0 AND _mpesa_receipt IS NOT NULL THEN
    UPDATE public.donations SET mpesa_transaction_id = _mpesa_receipt WHERE id = _req.donation_id;
    UPDATE public.payment_requests SET mpesa_receipt = _mpesa_receipt, updated_at = now()
    WHERE id = _req.id
    RETURNING * INTO _req;
    RETURN _req;
  END IF;

  IF _req.status <> 'pending' THEN
    RETURN _req;
  END IF;

  IF _result_code = 0 THEN
    -- Trust the amount Safaricom reports over the one we requested.
    _paid := COALESCE(_amount, _req.amount);

    INSERT INTO public.donations (campaign_id, donor_id, donor_name, amount, message, is_anonymous, mpesa_transaction_id)
    VALUES (
      _req.campaign_id,
      NULL,
      CASE WHEN _req.is_anonymous THEN NULL ELSE NULLIF(btrim(COALESCE(_req.donor_name, '')), '') END,
      _paid,
      NULLIF(btrim(COALESCE(_req.message, '')), ''),
      _req.is_anonymous,
      _mpesa_receipt
    )
    ON CONFLICT (mpesa_transaction_id) WHERE mpesa_transaction_id IS NOT NULL DO NOTHING
    RETURNING * INTO _donation;

    -- Count it even if the campaign closed meanwhile: the money already moved.
    IF _donation.id IS NOT NULL THEN
      UPDATE public.campaigns SET current_amount = current_amount + _paid WHERE id = _req.campaign_id;
    END IF;

    UPDATE public.payment_requests
    SET status = 'success', result_code = 0, result_desc = _result_desc,
        mpesa_receipt = _mpesa_receipt, amount = _paid, donation_id = _donation.id, updated_at = now()
    WHERE id = _req.id
    RETURNING * INTO _req;
  ELSE
    UPDATE public.payment_requests
    SET status = 'failed', result_code = _result_code, result_desc = _result_desc, updated_at = now()
    WHERE id = _req.id
    RETURNING * INTO _req;
  END IF;

  RETURN _req;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.complete_payment_request(TEXT, INTEGER, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_payment_request(TEXT, INTEGER, TEXT, TEXT, NUMERIC) TO service_role;

-- record_donation was callable with the public key, which let anyone inflate a campaign's
-- total. Donations now only enter through complete_payment_request.
REVOKE EXECUTE ON FUNCTION public.record_donation(UUID, NUMERIC, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
