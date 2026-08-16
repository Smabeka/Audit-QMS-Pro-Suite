/**
 * ohs-supabase.js
 * ---------------------------------------------------------------
 * Persistence layer for the OHS Core module (HIRA + Permit to Work).
 * Wraps Supabase queries/RPCs so ohs-ui.js never touches the client
 * directly. Import your existing `supabase` client instance and pass
 * it in — this module does not create its own client.
 *
 * Expects the schema created by hira_ptw_migration.sql:
 *   hira_assessments, hira_assessment_events,
 *   permits_to_work, permit_events
 *   RPCs: log_hira_event(p_hira_id, p_event_type, p_notes),
 *         sign_permit(p_permit_id, p_role)
 * ---------------------------------------------------------------
 */

// ---- HIRA Assessments ------------------------------------------------

/**
 * Create a new HIRA assessment and log the CREATED event.
 * @param {SupabaseClient} supabase
 * @param {object} hiraData - output shape from renderHiraModal's onSubmit
 * @returns {Promise<{data: object|null, error: Error|null}>}
 */
export async function createHiraAssessment(supabase, hiraData) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const payload = {
    activity_description: hiraData.activity_description,
    location: hiraData.location,
    inherent_severity: hiraData.inherent_severity,
    inherent_likelihood: hiraData.inherent_likelihood,
    residual_severity: hiraData.residual_severity,
    residual_likelihood: hiraData.residual_likelihood,
    applied_controls: hiraData.applied_controls,
    permit_required: hiraData.permit_required,
    status: hiraData.status,
    created_by: user ? user.id : null,
  };

  const { data, error } = await supabase
    .from('hira_assessments')
    .insert([payload])
    .select()
    .single();

  if (error) {
    return { data: null, error };
  }

  const { error: eventError } = await supabase.rpc('log_hira_event', {
    p_hira_id: data.id,
    p_event_type: 'CREATED',
    p_notes: null,
  });

  if (eventError) {
    // Record was created but the audit event failed to log — surface
    // this distinctly so the UI can warn without pretending nothing saved.
    return { data, error: eventError, eventLoggingFailed: true };
  }

  return { data, error: null };
}

/**
 * Fetch HIRA assessments, most recent first.
 * @param {SupabaseClient} supabase
 * @param {object} [filters]
 * @param {string} [filters.status]
 * @param {number} [filters.limit] - default 50
 */
export async function listHiraAssessments(supabase, filters = {}) {
  let query = supabase
    .from('hira_assessments')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(filters.limit || 50);

  if (filters.status) {
    query = query.eq('status', filters.status);
  }

  return query;
}

/**
 * Fetch a single HIRA assessment with its full event history.
 * @param {SupabaseClient} supabase
 * @param {string} hiraId
 */
export async function getHiraWithHistory(supabase, hiraId) {
  const [assessmentResult, eventsResult] = await Promise.all([
    supabase.from('hira_assessments').select('*').eq('id', hiraId).single(),
    supabase
      .from('hira_assessment_events')
      .select('*')
      .eq('hira_id', hiraId)
      .order('created_at', { ascending: true }),
  ]);

  if (assessmentResult.error) {
    return { data: null, error: assessmentResult.error };
  }

  return {
    data: {
      ...assessmentResult.data,
      events: eventsResult.data || [],
    },
    error: eventsResult.error || null,
  };
}

/**
 * Approve a HIRA assessment. Caller (ohs-ui.js) is responsible for
 * checking canApproveHira(userRole) before calling this.
 * @param {SupabaseClient} supabase
 * @param {string} hiraId
 * @param {string} [notes]
 */
export async function approveHiraAssessment(supabase, hiraId, notes) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('hira_assessments')
    .update({
      status: 'APPROVED',
      approved_by: user ? user.id : null,
      approved_at: new Date().toISOString(),
    })
    .eq('id', hiraId)
    .select()
    .single();

  if (error) {
    return { data: null, error };
  }

  await supabase.rpc('log_hira_event', {
    p_hira_id: hiraId,
    p_event_type: 'APPROVED',
    p_notes: notes || null,
  });

  return { data, error: null };
}

/**
 * Reject a HIRA assessment, sending it back for revision.
 * @param {SupabaseClient} supabase
 * @param {string} hiraId
 * @param {string} reasonNotes - required, this is why it was rejected
 */
export async function rejectHiraAssessment(supabase, hiraId, reasonNotes) {
  if (!reasonNotes || !reasonNotes.trim()) {
    return { data: null, error: new Error('A reason is required to reject a HIRA assessment.') };
  }

  const { data, error } = await supabase
    .from('hira_assessments')
    .update({ status: 'REJECTED' })
    .eq('id', hiraId)
    .select()
    .single();

  if (error) {
    return { data: null, error };
  }

  await supabase.rpc('log_hira_event', {
    p_hira_id: hiraId,
    p_event_type: 'REJECTED',
    p_notes: reasonNotes,
  });

  return { data, error: null };
}

// ---- Permits to Work ---------------------------------------------------

/**
 * Create a new permit. Note: renderPermitModal only calls onSubmit once
 * validatePermitForActivation() has already passed client-side, so this
 * inserts directly with status ACTIVE. Both sign-off timestamps are
 * expected to already be reflected in permitData from the modal state,
 * but we re-derive them server-side via sign_permit for the audit trail.
 *
 * @param {SupabaseClient} supabase
 * @param {object} permitData - output shape from renderPermitModal's onSubmit
 * @param {string|null} [hiraId] - linked HIRA assessment id, if any
 */
export async function createPermit(supabase, permitData, hiraId = null) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const payload = {
    hira_id: hiraId,
    permit_type: permitData.permit_type,
    location: permitData.location,
    equipment_id: permitData.equipment_id,
    valid_from: permitData.valid_from,
    valid_to: permitData.valid_to,
    fire_watch_assigned: permitData.fire_watch_assigned,
    gas_test_o2: permitData.gas_test_o2,
    gas_test_lel: permitData.gas_test_lel,
    gas_test_co: permitData.gas_test_co,
    gas_test_time: permitData.gas_test_time,
    status: 'DRAFT', // always start as DRAFT; sign_permit() RPC transitions it
    created_by: user ? user.id : null,
  };

  const { data, error } = await supabase
    .from('permits_to_work')
    .insert([payload])
    .select()
    .single();

  if (error) {
    return { data: null, error };
  }

  await supabase.from('permit_events').insert([
    { permit_id: data.id, event_type: 'CREATED', actor_id: user ? user.id : null },
  ]);

  return { data, error: null };
}

/**
 * Apply the Supervisor or Safety Officer sign-off via the sign_permit RPC.
 * Caller must check canGiveSupervisorSignoff/canGiveSafetyOfficerSignoff
 * before calling — RLS does not enforce role, only auth + table ownership.
 *
 * @param {SupabaseClient} supabase
 * @param {string} permitId
 * @param {'SUPERVISOR'|'SAFETY_OFFICER'} role
 */
export async function signPermit(supabase, permitId, role) {
  if (role !== 'SUPERVISOR' && role !== 'SAFETY_OFFICER') {
    return { error: new Error(`Invalid role: ${role}`) };
  }

  const { error } = await supabase.rpc('sign_permit', {
    p_permit_id: permitId,
    p_role: role,
  });

  return { error };
}

/**
 * Revoke an active permit. Caller should check canRevokePermit(userRole)
 * before calling.
 * @param {SupabaseClient} supabase
 * @param {string} permitId
 * @param {string} reasonNotes
 */
export async function revokePermit(supabase, permitId, reasonNotes) {
  if (!reasonNotes || !reasonNotes.trim()) {
    return { data: null, error: new Error('A reason is required to revoke a permit.') };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('permits_to_work')
    .update({ status: 'REVOKED', updated_at: new Date().toISOString() })
    .eq('id', permitId)
    .select()
    .single();

  if (error) {
    return { data: null, error };
  }

  await supabase.from('permit_events').insert([
    { permit_id: permitId, event_type: 'REVOKED', actor_id: user ? user.id : null, notes: reasonNotes },
  ]);

  return { data, error: null };
}

/**
 * Close out a permit at end of job.
 * @param {SupabaseClient} supabase
 * @param {string} permitId
 */
export async function closePermit(supabase, permitId) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('permits_to_work')
    .update({ status: 'CLOSED', updated_at: new Date().toISOString() })
    .eq('id', permitId)
    .select()
    .single();

  if (error) {
    return { data: null, error };
  }

  await supabase.from('permit_events').insert([
    { permit_id: permitId, event_type: 'CLOSED', actor_id: user ? user.id : null },
  ]);

  return { data, error: null };
}

/**
 * Fetch active/pending permits, most recently created first.
 * @param {SupabaseClient} supabase
 * @param {object} [filters]
 * @param {string[]} [filters.statuses] - default ['DRAFT','PENDING_APPROVAL','ACTIVE','EXTENDED']
 * @param {number} [filters.limit] - default 50
 */
export async function listPermits(supabase, filters = {}) {
  const statuses = filters.statuses || ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'EXTENDED'];

  return supabase
    .from('permits_to_work')
    .select('*')
    .in('status', statuses)
    .order('created_at', { ascending: false })
    .limit(filters.limit || 50);
}

/**
 * Fetch a single permit with its full event history.
 * @param {SupabaseClient} supabase
 * @param {string} permitId
 */
export async function getPermitWithHistory(supabase, permitId) {
  const [permitResult, eventsResult] = await Promise.all([
    supabase.from('permits_to_work').select('*').eq('id', permitId).single(),
    supabase
      .from('permit_events')
      .select('*')
      .eq('permit_id', permitId)
      .order('created_at', { ascending: true }),
  ]);

  if (permitResult.error) {
    return { data: null, error: permitResult.error };
  }

  return {
    data: {
      ...permitResult.data,
      events: eventsResult.data || [],
    },
    error: eventsResult.error || null,
  };
}

// ---- Realtime Subscriptions (matching your existing pattern) -----------

/**
 * Subscribe to live changes on permits_to_work, for dashboard widgets
 * like RealTimeGateMonitor or ActivePermitBoard.
 * @param {SupabaseClient} supabase
 * @param {(payload: object) => void} onChange
 * @returns {{unsubscribe: () => void}}
 */
export function subscribeToPermitChanges(supabase, onChange) {
  const channel = supabase
    .channel('permits_to_work_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'permits_to_work' }, onChange)
    .subscribe();

  return { unsubscribe: () => supabase.removeChannel(channel) };
}

/**
 * Subscribe to live changes on hira_assessments.
 * @param {SupabaseClient} supabase
 * @param {(payload: object) => void} onChange
 */
export function subscribeToHiraChanges(supabase, onChange) {
  const channel = supabase
    .channel('hira_assessments_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'hira_assessments' }, onChange)
    .subscribe();

  return { unsubscribe: () => supabase.removeChannel(channel) };
}
