-- PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  email TEXT UNIQUE,
  phone TEXT,
  profile_photo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', split_part(COALESCE(NEW.email, ''), '@', 1)),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- CAMPAIGNS
CREATE TABLE public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  organizer_name TEXT NOT NULL DEFAULT 'Anonymous Organizer',
  title TEXT NOT NULL,
  story TEXT,
  goal_amount NUMERIC NOT NULL CHECK (goal_amount > 0),
  current_amount NUMERIC NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('medical','education','community','other')),
  cover_photo TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  deadline DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX campaigns_status_created_idx ON public.campaigns (status, created_at DESC);
GRANT SELECT ON public.campaigns TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO authenticated;
GRANT ALL ON public.campaigns TO service_role;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaigns_select_active" ON public.campaigns FOR SELECT TO anon, authenticated USING (status = 'active');
CREATE POLICY "campaigns_select_own" ON public.campaigns FOR SELECT TO authenticated USING (auth.uid() = creator_id);
CREATE POLICY "campaigns_insert_own" ON public.campaigns FOR INSERT TO authenticated WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "campaigns_update_own" ON public.campaigns FOR UPDATE TO authenticated USING (auth.uid() = creator_id) WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "campaigns_delete_own" ON public.campaigns FOR DELETE TO authenticated USING (auth.uid() = creator_id);

-- DONATIONS
CREATE TABLE public.donations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  donor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  donor_name TEXT,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  message TEXT,
  is_anonymous BOOLEAN NOT NULL DEFAULT false,
  mpesa_transaction_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX donations_campaign_idx ON public.donations (campaign_id, created_at DESC);
GRANT SELECT ON public.donations TO anon;
GRANT SELECT ON public.donations TO authenticated;
GRANT ALL ON public.donations TO service_role;
ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "donations_select_all" ON public.donations FOR SELECT TO anon, authenticated USING (true);

-- CAMPAIGN UPDATES
CREATE TABLE public.campaign_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  creator_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX campaign_updates_campaign_idx ON public.campaign_updates (campaign_id, created_at DESC);
GRANT SELECT ON public.campaign_updates TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_updates TO authenticated;
GRANT ALL ON public.campaign_updates TO service_role;
ALTER TABLE public.campaign_updates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaign_updates_select_all" ON public.campaign_updates FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "campaign_updates_insert_owner" ON public.campaign_updates FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = creator_id AND EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = campaign_id AND c.creator_id = auth.uid()));
CREATE POLICY "campaign_updates_delete_owner" ON public.campaign_updates FOR DELETE TO authenticated USING (auth.uid() = creator_id);

-- DONATION RECORDING (insert + total increment in one transaction)
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
  IF NOT EXISTS (SELECT 1 FROM public.campaigns WHERE id = _campaign_id AND status = 'active') THEN
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

GRANT EXECUTE ON FUNCTION public.record_donation(UUID, NUMERIC, TEXT, TEXT, BOOLEAN, TEXT) TO anon, authenticated, service_role;

-- STORAGE POLICIES for campaign photos
CREATE POLICY "campaign_photos_read" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'campaign-photos');
CREATE POLICY "campaign_photos_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'campaign-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- SEED: the four starter causes
INSERT INTO public.campaigns (id, organizer_name, title, story, goal_amount, current_amount, category, cover_photo, status, deadline, created_at) VALUES
('11111111-1111-4111-8111-111111111101', 'Mama Grace Wanjiru', 'Build a classroom for Mama Grace''s school',
 'For 12 years I have taught 64 children under a mango tree in Kajiado. When the rains come, lessons stop. We need KES 450,000 to put up two iron-sheet classrooms so our children can learn every day — sun or rain. Every shilling will be accounted for, and we will share photos as the walls go up.',
 450000, 287400, 'education', 'seed/campaign-school.jpg', 'active', (now() + interval '18 days')::date, now() - interval '12 days'),
('11111111-1111-4111-8111-111111111102', 'Faith Mutindi', 'Cucu Mwikali needs hip surgery',
 'My grandmother fell three weeks ago and cannot walk. Kenyatta Hospital needs KES 180,000 for the operation and recovery. She raised 9 of us — now it''s our turn to carry her. Asanteni sana for any little you can give.',
 180000, 142300, 'medical', 'seed/campaign-medical.jpg', 'active', (now() + interval '7 days')::date, now() - interval '9 days'),
('11111111-1111-4111-8111-111111111103', 'Green Kibera Collective', 'Plant 1,000 trees in Kibera',
 'We are 14 youth from Kibera turning empty plots into green spaces. Funds cover seedlings, tools, and water tanks for the dry season. Join us in making our home cooler and greener.',
 220000, 58900, 'community', 'seed/campaign-community.jpg', 'active', (now() + interval '31 days')::date, now() - interval '6 days'),
('11111111-1111-4111-8111-111111111104', 'Akinyi Adhiambo', 'Help Mama Akinyi rebuild her stall',
 'My mama mboga stall in Gikomba burned down last month. I need KES 75,000 to restock vegetables and rebuild the kibanda. I have fed my three children with this stall for 8 years.',
 75000, 71200, 'other', 'seed/campaign-business.jpg', 'active', (now() + interval '3 days')::date, now() - interval '4 days');

INSERT INTO public.donations (campaign_id, donor_name, amount, is_anonymous, mpesa_transaction_id, created_at) VALUES
('11111111-1111-4111-8111-111111111101', 'Brian K.', 5000, false, 'DEMO-SEED-001', now() - interval '2 hours'),
('11111111-1111-4111-8111-111111111101', NULL, 1000, true, 'DEMO-SEED-002', now() - interval '4 hours'),
('11111111-1111-4111-8111-111111111101', 'Wanjiku M.', 2500, false, 'DEMO-SEED-003', now() - interval '6 hours'),
('11111111-1111-4111-8111-111111111101', 'Otieno J.', 500, false, 'DEMO-SEED-004', now() - interval '1 day'),
('11111111-1111-4111-8111-111111111101', 'Cynthia A.', 10000, false, 'DEMO-SEED-005', now() - interval '2 days'),
('11111111-1111-4111-8111-111111111102', 'Mercy W.', 3000, false, 'DEMO-SEED-006', now() - interval '1 hour'),
('11111111-1111-4111-8111-111111111102', 'Kevin O.', 500, false, 'DEMO-SEED-007', now() - interval '3 hours'),
('11111111-1111-4111-8111-111111111102', NULL, 20000, true, 'DEMO-SEED-008', now() - interval '5 hours'),
('11111111-1111-4111-8111-111111111102', 'Joy N.', 1500, false, 'DEMO-SEED-009', now() - interval '1 day'),
('11111111-1111-4111-8111-111111111103', 'Lydia M.', 1000, false, 'DEMO-SEED-010', now() - interval '5 hours'),
('11111111-1111-4111-8111-111111111103', NULL, 500, true, 'DEMO-SEED-011', now() - interval '1 day'),
('11111111-1111-4111-8111-111111111104', 'Peter G.', 2000, false, 'DEMO-SEED-012', now() - interval '30 minutes'),
('11111111-1111-4111-8111-111111111104', NULL, 1000, true, 'DEMO-SEED-013', now() - interval '2 hours'),
('11111111-1111-4111-8111-111111111104', 'Sharon W.', 500, false, 'DEMO-SEED-014', now() - interval '4 hours');