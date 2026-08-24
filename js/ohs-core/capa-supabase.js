// capa-supabase.js
// Persistence layer for the CAPA module. Mirrors ohs-supabase.js:
// this file is the ONLY place that talks to Supabase for CAPA data.
// UI code never calls supabaseClient directly.

export const CapaSupabase = (function () {
  // supabaseClient is a classic-script global (set up elsewhere in the
  // app). Because this file is a module, it can't see it directly —
  // it comes in through the same window.ohsRegistry-style bridge you
  // used for HIRA/PTW.
  function client() {
    if (!window.supabaseClient) {
      throw new Error('CapaSupabase: supabaseClient not yet bridged onto window');
    }
    return window.supabaseClient;
  }

  async function listCapas(filters = {}) {
    let query = client().from('capas').select('*').order('created_at', { ascending: false });
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.createdBy) query = query.eq('created_by', filters.createdBy);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  async function getCapa(capaId) {
    const { data, error } = await client().from('capas').select('*').eq('id', capaId).single();
    if (error) throw error;
    return data;
  }

  async function getEvents(capaId) {
    const { data, error } = await client()
      .from('capa_events')
      .select('*')
      .eq('capa_id', capaId)
      .order('timestamp', { ascending: true });
    if (error) throw error;
    return data;
  }

  async function getEvidence(capaId) {
    const { data, error } = await client().from('capa_evidence').select('*').eq('capa_id', capaId);
    if (error) throw error;
    return data;
  }

  async function getReviews(capaId) {
    const { data, error } = await client()
      .from('capa_reviews')
      .select('*')
      .eq('capa_id', capaId)
      .order('reviewed_at', { ascending: true });
    if (error) throw error;
    return data;
  }

  async function createCapa({ title, description, rootCause, correctiveAction, createdBy }) {
    const { data, error } = await client()
      .from('capas')
      .insert({
        title,
        description,
        root_cause: rootCause,
        corrective_action: correctiveAction,
        created_by: createdBy,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function uploadEvidence({ capaId, fileName, fileReference, fileHash, evidenceType, description, uploadedBy }) {
    const { data, error } = await client()
      .from('capa_evidence')
      .insert({
        capa_id: capaId,
        file_name: fileName,
        file_reference: fileReference,
        file_hash: fileHash,
        evidence_type: evidenceType,
        description,
        uploaded_by: uploadedBy,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // All status-changing actions route through the log_capa_event RPC.
  // This function never touches capas.status directly.
  async function _logEvent(params) {
    const { error } = await client().rpc('log_capa_event', params);
    if (error) throw error;
  }

  async function submitCapa(capaId) {
    return _logEvent({ p_capa_id: capaId, p_event_type: 'submitted' });
  }

  async function reviewCapa({ capaId, decision, comments }) {
    // decision: 'approved' | 'rejected'
    const eventType = decision === 'approved' ? 'approved' : 'rejected';
    return _logEvent({
      p_capa_id: capaId,
      p_event_type: eventType,
      p_reason: comments,
      p_review_type: 'initial',
      p_decision: decision,
    });
  }

  async function submitAppeal({ capaId, reason }) {
    const { error } = await client().rpc('submit_capa_appeal', {
      p_capa_id: capaId,
      p_reason: reason,
    });
    if (error) throw error;
  }

  async function resolveAppeal({ capaId, appealId, decision, comments }) {
    const { error } = await client().rpc('resolve_capa_appeal', {
      p_capa_id: capaId,
      p_appeal_id: appealId,
      p_decision: decision,
      p_comments: comments,
    });
    if (error) throw error;
  }

  async function startEffectivenessReview(capaId) {
    return _logEvent({ p_capa_id: capaId, p_event_type: 'effectiveness_review_started' });
  }

  async function verifyEffectiveness({ capaId, comments }) {
    return _logEvent({
      p_capa_id: capaId,
      p_event_type: 'effectiveness_verified',
      p_reason: comments,
      p_review_type: 'effectiveness',
      p_decision: 'approved',
    });
  }

  async function failEffectiveness({ capaId, comments }) {
    return _logEvent({
      p_capa_id: capaId,
      p_event_type: 'effectiveness_failed',
      p_reason: comments,
      p_review_type: 'effectiveness',
      p_decision: 'rejected',
    });
  }

  return {
    listCapas,
    getCapa,
    getEvents,
    getEvidence,
    getReviews,
    createCapa,
    uploadEvidence,
    submitCapa,
    reviewCapa,
    submitAppeal,
    resolveAppeal,
    startEffectivenessReview,
    verifyEffectiveness,
    failEffectiveness,
  };
})();
