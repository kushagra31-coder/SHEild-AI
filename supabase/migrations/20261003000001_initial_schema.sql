-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 1. profiles
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL CHECK (char_length(trim(display_name)) >= 1),
    phone_number TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- 2. guardian_invites
CREATE TABLE public.guardian_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    priority INTEGER NOT NULL CHECK (priority >= 1),
    token_hash TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. guardian_links
CREATE TABLE public.guardian_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    guardian_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    priority INTEGER NOT NULL CHECK (priority >= 1),
    status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'accepted', 'revoked')),
    relationship_label TEXT,
    consented_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_guardian_links_owner_guardian UNIQUE (owner_id, guardian_id),
    CHECK (owner_id <> guardian_id)
);
CREATE UNIQUE INDEX uq_active_guardian_priority ON public.guardian_links (owner_id, priority) WHERE status = 'accepted' AND revoked_at IS NULL;
CREATE TRIGGER update_guardian_links_updated_at BEFORE UPDATE ON public.guardian_links FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- 4. incidents
CREATE TABLE public.incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    client_event_id UUID NOT NULL,
    trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'shake', 'missed_check_in', 'voice_keyword', 'other')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft_local', 'pending_upload', 'active', 'acknowledged', 'resolved', 'expired')),
    share_location BOOLEAN NOT NULL DEFAULT true,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_incidents_owner_client_event UNIQUE (owner_id, client_event_id)
);
CREATE INDEX idx_incidents_owner_active ON public.incidents(owner_id, created_at DESC) WHERE status IN ('active', 'acknowledged');
CREATE TRIGGER update_incidents_updated_at BEFORE UPDATE ON public.incidents FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- 5. incident_locations
CREATE TABLE public.incident_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
    latitude DOUBLE PRECISION NOT NULL CHECK (latitude >= -90.0 AND latitude <= 90.0),
    longitude DOUBLE PRECISION NOT NULL CHECK (longitude >= -180.0 AND longitude <= 180.0),
    accuracy_m REAL CHECK (accuracy_m IS NULL OR accuracy_m >= 0.0),
    captured_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_incident_locations_latest ON public.incident_locations(incident_id, captured_at DESC);
CREATE INDEX idx_incident_locations_retention ON public.incident_locations(expires_at);

-- 6. alert_deliveries
CREATE TABLE public.alert_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
    guardian_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    channel TEXT NOT NULL DEFAULT 'push_fcm' CHECK (channel IN ('push_fcm', 'sms_mock', 'email')),
    stage INTEGER NOT NULL DEFAULT 1 CHECK (stage >= 1),
    state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'provider_accepted', 'provider_failed', 'acknowledged')),
    provider_ref TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_alert_deliveries_job UNIQUE (incident_id, guardian_id, channel, stage)
);
CREATE INDEX idx_alert_deliveries_worker ON public.alert_deliveries(state, next_attempt_at) WHERE state = 'queued';
CREATE TRIGGER update_alert_deliveries_updated_at BEFORE UPDATE ON public.alert_deliveries FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- 7. incident_acknowledgements
CREATE TABLE public.incident_acknowledgements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
    guardian_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    note VARCHAR(280),
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_acknowledgements_incident_guardian UNIQUE (incident_id, guardian_id)
);

-- 8. journeys
CREATE TABLE public.journeys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    destination_label TEXT NOT NULL,
    destination_lat DOUBLE PRECISION,
    destination_lon DOUBLE PRECISION,
    eta_at TIMESTAMPTZ NOT NULL,
    grace_seconds INTEGER NOT NULL DEFAULT 900 CHECK (grace_seconds >= 0),
    status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'missed_check_in', 'cancelled')),
    guardian_ids UUID[],
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER update_journeys_updated_at BEFORE UPDATE ON public.journeys FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journeys ENABLE ROW LEVEL SECURITY;

-- Basic RLS Policies (MVP)
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Guardians can view linked profiles" ON public.profiles FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.guardian_links 
        WHERE guardian_links.owner_id = profiles.id 
        AND guardian_links.guardian_id = auth.uid() 
        AND guardian_links.status = 'accepted' 
        AND guardian_links.revoked_at IS NULL
    )
    OR
    EXISTS (
        SELECT 1 FROM public.guardian_links 
        WHERE guardian_links.guardian_id = profiles.id 
        AND guardian_links.owner_id = auth.uid() 
        AND guardian_links.status = 'accepted' 
        AND guardian_links.revoked_at IS NULL
    )
);

CREATE POLICY "Users can manage their own invites" ON public.guardian_invites FOR ALL USING (auth.uid() = owner_id);

CREATE POLICY "Owners can manage links" ON public.guardian_links FOR ALL USING (auth.uid() = owner_id);
CREATE POLICY "Guardians can view and accept their links" ON public.guardian_links FOR SELECT USING (auth.uid() = guardian_id);
CREATE POLICY "Guardians can update their link status" ON public.guardian_links FOR UPDATE USING (auth.uid() = guardian_id) WITH CHECK (status IN ('accepted', 'revoked'));

CREATE POLICY "Users can manage their own incidents" ON public.incidents FOR ALL USING (auth.uid() = owner_id);
CREATE POLICY "Guardians can view owner active incidents" ON public.incidents FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.guardian_links 
        WHERE guardian_links.owner_id = incidents.owner_id 
        AND guardian_links.guardian_id = auth.uid() 
        AND guardian_links.status = 'accepted' 
        AND guardian_links.revoked_at IS NULL
    )
    AND status IN ('active', 'acknowledged')
);

CREATE POLICY "Users can manage their own incident locations" ON public.incident_locations FOR ALL USING (
    EXISTS (SELECT 1 FROM public.incidents WHERE incidents.id = incident_locations.incident_id AND incidents.owner_id = auth.uid())
);
CREATE POLICY "Guardians can view locations of active shared incidents" ON public.incident_locations FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.incidents
        JOIN public.guardian_links ON guardian_links.owner_id = incidents.owner_id
        WHERE incidents.id = incident_locations.incident_id
        AND guardian_links.guardian_id = auth.uid()
        AND guardian_links.status = 'accepted'
        AND guardian_links.revoked_at IS NULL
        AND incidents.status IN ('active', 'acknowledged')
        AND incidents.share_location = true
    )
    AND expires_at > now()
);

CREATE POLICY "Owners can view alert deliveries" ON public.alert_deliveries FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.incidents WHERE incidents.id = alert_deliveries.incident_id AND incidents.owner_id = auth.uid())
);

CREATE POLICY "Owners can view acknowledgements" ON public.incident_acknowledgements FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.incidents WHERE incidents.id = incident_acknowledgements.incident_id AND incidents.owner_id = auth.uid())
);
CREATE POLICY "Guardians can insert and view their own acknowledgements" ON public.incident_acknowledgements FOR ALL USING (auth.uid() = guardian_id);

CREATE POLICY "Users can manage their own journeys" ON public.journeys FOR ALL USING (auth.uid() = owner_id);
