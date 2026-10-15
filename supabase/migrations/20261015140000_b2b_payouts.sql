-- Automated payouts: batch each organizer's confirmed, unpaid donations into one
-- B2B Buy Goods transfer from Harambee's shortcode to their till.

CREATE TABLE public.payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.profiles(id),
  till_number TEXT NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  -- unknown = request may have been accepted but we never heard back; needs a human check.
  status TEXT NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated','success','failed','unknown')),
  originator_conversation_id TEXT UNIQUE,
  conversation_id TEXT,
  receipt TEXT,
  result_code INTEGER,
  result_desc TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- At most one in-flight payout per organizer, enforced by the database.
CREATE UNIQUE INDEX payouts_one_in_flight_idx ON public.payouts (owner_id) WHERE status IN ('initiated','unknown');
REVOKE ALL ON public.payouts FROM anon, authenticated;
GRANT ALL ON public.payouts TO service_role;
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.payment_requests
  DROP CONSTRAINT payment_requests_payout_status_check,
  ADD CONSTRAINT payment_requests_payout_status_check CHECK (payout_status IN ('pending','processing','paid')),
  ADD COLUMN payout_id UUID REFERENCES public.payouts(id);

-- Reserve an organizer's owed payments for one payout. Returns NULL if nothing to pay.
CREATE OR REPLACE FUNCTION public.claim_payout(_owner UUID, _min NUMERIC)
RETURNS public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _till TEXT;
  _ids UUID[];
  _sum NUMERIC;
  _p public.payouts;
BEGIN
  SELECT till_number INTO _till FROM public.organizer_payment_settings WHERE owner_id = _owner;
  IF _till IS NULL THEN RETURN NULL; END IF;

  IF EXISTS (SELECT 1 FROM public.payouts WHERE owner_id = _owner AND status IN ('initiated','unknown')) THEN
    RETURN NULL;
  END IF;

  SELECT array_agg(id), sum(amount) INTO _ids, _sum FROM (
    SELECT id, amount FROM public.payment_requests
    WHERE owner_id = _owner AND status = 'success' AND payout_status = 'pending'
    FOR UPDATE SKIP LOCKED
  ) s;
  IF _sum IS NULL OR _sum < _min THEN RETURN NULL; END IF;

  INSERT INTO public.payouts (owner_id, till_number, amount) VALUES (_owner, _till, _sum) RETURNING * INTO _p;
  UPDATE public.payment_requests SET payout_status = 'processing', payout_id = _p.id WHERE id = ANY(_ids);
  RETURN _p;
END;
$$;

-- Put a payout's payments back in the owed pool.
CREATE OR REPLACE FUNCTION public._release_payout_rows(_payout UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.payment_requests SET payout_status = 'pending', payout_id = NULL WHERE payout_id = _payout;
$$;

-- Settle a payout from Safaricom's result. Safe to call repeatedly.
CREATE OR REPLACE FUNCTION public.complete_payout(
  _originator TEXT,
  _result_code INTEGER,
  _result_desc TEXT DEFAULT NULL,
  _receipt TEXT DEFAULT NULL
)
RETURNS public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _p public.payouts;
BEGIN
  SELECT * INTO _p FROM public.payouts WHERE originator_conversation_id = _originator FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF _p.status IN ('success','failed') THEN RETURN _p; END IF;

  IF _result_code = 0 THEN
    UPDATE public.payouts SET status = 'success', result_code = 0, result_desc = _result_desc,
      receipt = NULLIF(btrim(COALESCE(_receipt, '')), ''), updated_at = now()
    WHERE id = _p.id RETURNING * INTO _p;
    UPDATE public.payment_requests SET payout_status = 'paid', paid_out_at = now(), payout_reference = _p.receipt
    WHERE payout_id = _p.id;
  ELSE
    UPDATE public.payouts SET status = 'failed', result_code = _result_code, result_desc = _result_desc, updated_at = now()
    WHERE id = _p.id RETURNING * INTO _p;
    PERFORM public._release_payout_rows(_p.id);
  END IF;
  RETURN _p;
END;
$$;

-- Safaricom definitively refused the request, so no money moved.
CREATE OR REPLACE FUNCTION public.release_unsent_payout(_payout UUID, _reason TEXT DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.payouts SET status = 'failed', result_desc = _reason, updated_at = now()
  WHERE id = _payout AND status = 'initiated' AND originator_conversation_id IS NULL;
  IF FOUND THEN PERFORM public._release_payout_rows(_payout); END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_payout(UUID, NUMERIC), public._release_payout_rows(UUID),
  public.complete_payout(TEXT, INTEGER, TEXT, TEXT), public.release_unsent_payout(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_payout(UUID, NUMERIC), public._release_payout_rows(UUID),
  public.complete_payout(TEXT, INTEGER, TEXT, TEXT), public.release_unsent_payout(UUID, TEXT)
  TO service_role;

-- Dashboard summary now separates in-flight payouts.
DROP FUNCTION public.my_payout_summary();
CREATE FUNCTION public.my_payout_summary()
RETURNS TABLE (owed NUMERIC, processing NUMERIC, paid NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE payout_status = 'pending'), 0),
    COALESCE(SUM(amount) FILTER (WHERE payout_status = 'processing'), 0),
    COALESCE(SUM(amount) FILTER (WHERE payout_status = 'paid'), 0)
  FROM public.payment_requests
  WHERE owner_id = auth.uid() AND status = 'success';
$$;
REVOKE EXECUTE ON FUNCTION public.my_payout_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_payout_summary() TO authenticated;
