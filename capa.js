// capa.js
// State machine + role-gating logic for CAPA, mirroring hira.js's role
// in the OHS Core module: pure logic, no DOM, no direct Supabase calls.
// This is the single place that knows "what can happen next" — the UI
// asks this module, not the other way around. It must stay in sync
// with capa_status_transitions in the database; the DB is still the
// enforcement point, this is just so the UI doesn't show buttons for
// actions that would be rejected server-side.

export const CapaEngine = (function () {
  const TRANSITIONS = {
    draft: [{ to: 'under_review', action: 'submit', roles: ['employee', 'department_manager', 'admin'] }],
    under_review: [
      { to: 'approved', action: 'approve', roles: ['quality_manager', 'admin'] },
      { to: 'rejected', action: 'reject', roles: ['quality_manager', 'admin'] },
    ],
    rejected: [
      { to: 'independent_review', action: 'appeal', roles: ['employee', 'department_manager', 'admin'] },
    ],
    independent_review: [
      { to: 'approved', action: 'uphold_appeal', roles: ['approver', 'admin'] },
      { to: 'rejected', action: 'deny_appeal', roles: ['approver', 'admin'] },
    ],
    approved: [
      { to: 'effectiveness_review', action: 'start_effectiveness_review', roles: ['quality_manager', 'admin'] },
    ],
    effectiveness_review: [
      { to: 'complete', action: 'verify_effectiveness', roles: ['quality_manager', 'admin'] },
      { to: 'under_review', action: 'fail_effectiveness', roles: ['quality_manager', 'admin'] },
    ],
    complete: [],
  };

  const STATUS_LABELS = {
    draft: 'Draft',
    under_review: 'Under Review',
    approved: 'Approved',
    rejected: 'Rejected',
    independent_review: 'Independent Review',
    effectiveness_review: 'Effectiveness Review',
    complete: 'Complete',
  };

  const LOCKED_STATUSES = new Set(['approved', 'complete']);

  function availableActions(status, role) {
    const options = TRANSITIONS[status] || [];
    return options.filter((t) => t.roles.includes(role));
  }

  function isLocked(status) {
    return LOCKED_STATUSES.has(status);
  }

  function isSelfReviewBlocked({ status, createdBy, currentUserId }) {
    // Mirrors the DB-side SoD check — used to hide the review button
    // client-side; the RPC is still the actual guard.
    if (status === 'under_review' || status === 'independent_review') {
      return createdBy === currentUserId;
    }
    return false;
  }

  function label(status) {
    return STATUS_LABELS[status] || status;
  }

  function canEdit(status, role) {
    // Only the draft record is freely editable; everything after
    // submission is append-only from the record's own perspective.
    return status === 'draft' && ['employee', 'department_manager', 'admin'].includes(role);
  }

  function canUploadEvidence(status) {
    // Evidence can be attached any time before closure — corrective
    // action evidence pre-approval, effectiveness evidence after.
    return status !== 'complete';
  }

  return {
    TRANSITIONS,
    STATUS_LABELS,
    availableActions,
    isLocked,
    isSelfReviewBlocked,
    label,
    canEdit,
    canUploadEvidence,
  };
})();
