-- ============================================================
-- hira_ptw_migration.sql
-- HIRA (Hazard Identification & Risk Assessment) + Permit to Work
-- OHS Act 85 of 1993 core module
-- Trimmed to what AuditQMS Pro Suite actually needs right now.
-- ============================================================

-- 1. HIRA Assessments
CREATE TABLE IF NOT EXISTS public.hira_assessments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_description TEXT NOT NULL,
  location TEXT NOT NULL,
  department TEXT,

  -- Inherent risk
  inherent_severity SMALLINT NOT NULL CHECK (inherent_severity BETWEEN 1 AND 5),
  inherent_likelihood SMALLINT NOT NULL CHECK (inherent_likelihood BETWEEN 1 AND 5),
  inherent_score SMALLINT GENERATED ALWAYS AS (inherent_severity * inherent_likelihood) STORED,

  -- Residual risk (after controls)
  residual_severity SMALLINT CHECK (residual_severity BETWEEN 1 AND 5),
  residual_likelihood SMALLINT CHECK (residual_likelihood BETWEEN 1 AND 5),
  residual_score SMALLINT GENERATED ALWAYS AS (residual_severity * residual_likelihood) STORED,

  applied_controls TEXT[] DEFAULT '{}',  -- e.g. {'ENGINEERING','PPE'}
  permit_required BOOLEAN DEFAULT FALSE,

  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'UNDER_REVIEW')),

  created_by UUID REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Append-only event log, same pattern as capa_finding_events
CREATE TABLE IF NOT EXISTS public.hira_assessment_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hira_id UUID NOT NULL REFERENCES public.hira_assessments(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('CREATED', 'UPDATED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'REVIEW_REQUESTED')),
  actor_id UUID REFERENCES auth.users(id),
  notes TEXT,
  snapshot JSONB, -- full state at time of event, for audit trail
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Permits to Work
CREATE TABLE IF NOT EXISTS public.permits_to_work (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hira_id UUID REFERENCES public.hira_assessments(id),

  permit_type TEXT NOT NULL
    CHECK (permit_type IN ('HOT_WORK', 'CONFINED_SPACE', 'ELECTRICAL', 'HEIGHTS', 'EXCAVATION', 'GENERAL')),
  location TEXT NOT NULL,
  equipment_id TEXT,
  description TEXT,

  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ NOT NULL,

  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'EXTENDED', 'CLOSED', 'REVOKED')),

  -- Environmental / gas test snapshot (nullable — only relevant for some permit types)
  gas_test_o2 NUMERIC(4,1),
  gas_test_lel NUMERIC(4,1),
  gas_test_co NUMERIC(5,1),
  gas_test_time TIMESTAMPTZ,
  fire_watch_assigned BOOLEAN DEFAULT FALSE,

  created_by UUID REFERENCES auth.users(id),
  supervisor_signoff_by UUID REFERENCES auth.users(id),
  supervisor_signoff_at TIMESTAMPTZ,
  safety_officer_signoff_by UUID REFERENCES auth.users(id),
  safety_officer_signoff_at TIMESTAMPTZ,

  digital_signature_hash TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.permit_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  permit_id UUID NOT NULL REFERENCES public.permits_to_work(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('CREATED', 'SUBMITTED', 'SUPERVISOR_SIGNED', 'SAFETY_OFFICER_SIGNED',
                           'ACTIVATED', 'EXTENDED', 'CLOSED', 'REVOKED')),
  actor_id UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_hira_status ON public.hira_assessments(status);
CREATE INDEX IF NOT EXISTS idx_hira_events_hira_id ON public.hira_assessment_events(hira_id);
CREATE INDEX IF NOT EXISTS idx_permits_status ON public.permits_to_work(status);
CREATE INDEX IF NOT EXISTS idx_permits_valid_to ON public.permits_to_work(valid_to);
CREATE INDEX IF NOT EXISTS idx_permit_events_permit_id ON public.permit_events(permit_id);

-- 4. RLS
ALTER TABLE public.hira_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hira_assessment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permits_to_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_events ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all HIRA/permit records (single-tenant app today).
-- Tighten to tenant_id scoping later if/when multi-tenant is introduced.
CREATE POLICY "Authenticated read hira_assessments" ON public.hira_assessments
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated insert hira_assessments" ON public.hira_assessments
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Creator or approver update hira_assessments" ON public.hira_assessments
  FOR UPDATE USING (auth.uid() = created_by OR auth.uid() = approved_by);

CREATE POLICY "Authenticated read hira_assessment_events" ON public.hira_assessment_events
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated insert hira_assessment_events" ON public.hira_assessment_events
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read permits_to_work" ON public.permits_to_work
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated insert permits_to_work" ON public.permits_to_work
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Creator or signoff update permits_to_work" ON public.permits_to_work
  FOR UPDATE USING (
    auth.uid() = created_by
    OR auth.uid() = supervisor_signoff_by
    OR auth.uid() = safety_officer_signoff_by
  );

CREATE POLICY "Authenticated read permit_events" ON public.permit_events
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated insert permit_events" ON public.permit_events
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 5. RPC: log_hira_event — mirrors your log_finding_event pattern
CREATE OR REPLACE FUNCTION public.log_hira_event(
  p_hira_id UUID,
  p_event_type TEXT,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_id UUID;
  v_snapshot JSONB;
BEGIN
  SELECT to_jsonb(h) INTO v_snapshot FROM public.hira_assessments h WHERE h.id = p_hira_id;

  INSERT INTO public.hira_assessment_events (hira_id, event_type, actor_id, notes, snapshot)
  VALUES (p_hira_id, p_event_type, auth.uid(), p_notes, v_snapshot)
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

-- 6. RPC: sign_permit — dual sign-off (Supervisor + Safety Officer)
CREATE OR REPLACE FUNCTION public.sign_permit(
  p_permit_id UUID,
  p_role TEXT  -- 'SUPERVISOR' or 'SAFETY_OFFICER'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_role = 'SUPERVISOR' THEN
    UPDATE public.permits_to_work
    SET supervisor_signoff_by = auth.uid(),
        supervisor_signoff_at = NOW(),
        updated_at = NOW()
    WHERE id = p_permit_id;

    INSERT INTO public.permit_events (permit_id, event_type, actor_id)
    VALUES (p_permit_id, 'SUPERVISOR_SIGNED', auth.uid());

  ELSIF p_role = 'SAFETY_OFFICER' THEN
    UPDATE public.permits_to_work
    SET safety_officer_signoff_by = auth.uid(),
        safety_officer_signoff_at = NOW(),
        status = 'ACTIVE',
        updated_at = NOW()
    WHERE id = p_permit_id;

    INSERT INTO public.permit_events (permit_id, event_type, actor_id)
    VALUES (p_permit_id, 'SAFETY_OFFICER_SIGNED', auth.uid());

    INSERT INTO public.permit_events (permit_id, event_type, actor_id)
    VALUES (p_permit_id, 'ACTIVATED', auth.uid());
  ELSE
    RAISE EXCEPTION 'Invalid role: %. Must be SUPERVISOR or SAFETY_OFFICER', p_role;
  END IF;
END;
$$;
