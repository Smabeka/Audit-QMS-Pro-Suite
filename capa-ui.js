// capa-ui.js
// Modal rendering for the CAPA module, mirroring ohs-ui.js. This file
// owns the DOM. It asks CapaEngine what's allowed and CapaSupabase to
// do it — it never contains business rules or Supabase calls itself.

import { CapaEngine } from './capa.js';
import { CapaSupabase } from './capa-supabase.js';

export const CapaUI = (function () {
  function currentUser() {
    // Bridged from the classic-script global auth/session state, same
    // pattern as the OHS module's window.ohsRegistry bridge.
    return window.ohsRegistry?.currentUser || null;
  }

  function statusBadge(status) {
    const span = document.createElement('span');
    span.className = `capa-status-badge capa-status-${status}`;
    span.textContent = CapaEngine.label(status);
    if (CapaEngine.isLocked(status)) span.title = 'Locked — history preserved';
    return span;
  }

  async function renderCapaList(containerEl) {
    containerEl.innerHTML = '<p>Loading CAPAs…</p>';
    const capas = await CapaSupabase.listCapas();
    containerEl.innerHTML = '';

    const table = document.createElement('table');
    table.className = 'capa-table';
    table.innerHTML = `
      <thead><tr><th>Reference</th><th>Title</th><th>Status</th><th></th></tr></thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');

    capas.forEach((capa) => {
      const row = document.createElement('tr');
      const badge = statusBadge(capa.status);
      row.innerHTML = `<td>${capa.reference_number}</td><td>${capa.title}</td><td></td>
        <td><button data-capa-id="${capa.id}" class="capa-open-btn">Open</button></td>`;
      row.children[2].appendChild(badge);
      tbody.appendChild(row);
    });

    containerEl.appendChild(table);

    tbody.querySelectorAll('.capa-open-btn').forEach((btn) => {
      btn.addEventListener('click', () => openCapaDetail(btn.dataset.capaId));
    });
  }

  async function openCapaDetail(capaId) {
    const user = currentUser();
    const [capa, events, evidence, reviews] = await Promise.all([
      CapaSupabase.getCapa(capaId),
      CapaSupabase.getEvents(capaId),
      CapaSupabase.getEvidence(capaId),
      CapaSupabase.getReviews(capaId),
    ]);

    const modal = document.createElement('div');
    modal.className = 'capa-modal-overlay';
    modal.innerHTML = `
      <div class="capa-modal">
        <div class="capa-modal-header">
          <h2>${capa.reference_number} — ${capa.title}</h2>
          <button class="capa-modal-close">&times;</button>
        </div>
        <div class="capa-modal-body">
          <p><strong>Status:</strong> <span id="capa-detail-status"></span></p>
          <p><strong>Root cause:</strong> ${capa.root_cause || '—'}</p>
          <p><strong>Corrective action:</strong> ${capa.corrective_action || '—'}</p>

          <h3>History</h3>
          <ul class="capa-event-log">
            ${events.map((e) => `<li>${new Date(e.timestamp).toLocaleString()} — ${e.event_type} (${e.previous_status || '—'} → ${e.new_status || '—'})${e.reason ? ` — ${e.reason}` : ''}</li>`).join('')}
          </ul>

          <h3>Evidence</h3>
          <ul class="capa-evidence-list">
            ${evidence.map((e) => `<li>${e.file_name} (${e.evidence_type})</li>`).join('')}
          </ul>

          <h3>Reviews</h3>
          <ul class="capa-review-list">
            ${reviews.map((r) => `<li>${r.review_type}: ${r.decision}${r.comments ? ` — ${r.comments}` : ''}</li>`).join('')}
          </ul>

          <div class="capa-action-bar"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('#capa-detail-status').appendChild(statusBadge(capa.status));
    modal.querySelector('.capa-modal-close').addEventListener('click', () => modal.remove());

    renderActionBar(modal.querySelector('.capa-action-bar'), capa, user);
  }

  function renderActionBar(barEl, capa, user) {
    if (!user) return;
    const blocked = CapaEngine.isSelfReviewBlocked({
      status: capa.status,
      createdBy: capa.created_by,
      currentUserId: user.id,
    });

    const actions = CapaEngine.availableActions(capa.status, user.role);

    if (blocked) {
      barEl.innerHTML = '<p class="capa-sod-notice">You cannot review a CAPA you created.</p>';
      return;
    }

    actions.forEach((action) => {
      const btn = document.createElement('button');
      btn.textContent = actionLabel(action.action);
      btn.className = 'capa-action-btn';
      btn.addEventListener('click', () => handleAction(action.action, capa, user));
      barEl.appendChild(btn);
    });
  }

  function actionLabel(action) {
    const labels = {
      submit: 'Submit for Review',
      approve: 'Approve',
      reject: 'Reject',
      appeal: 'Submit Appeal',
      uphold_appeal: 'Uphold Appeal (Approve)',
      deny_appeal: 'Deny Appeal',
      start_effectiveness_review: 'Start Effectiveness Review',
      verify_effectiveness: 'Verify Effectiveness (Close)',
      fail_effectiveness: 'Effectiveness Failed (Reopen)',
    };
    return labels[action] || action;
  }

  async function handleAction(action, capa, user) {
    try {
      switch (action) {
        case 'submit':
          await CapaSupabase.submitCapa(capa.id);
          break;
        case 'approve':
          await CapaSupabase.reviewCapa({ capaId: capa.id, decision: 'approved', comments: promptComment() });
          break;
        case 'reject':
          await CapaSupabase.reviewCapa({ capaId: capa.id, decision: 'rejected', comments: requireComment('Rejection reason is required') });
          break;
        case 'appeal':
          await CapaSupabase.submitAppeal({ capaId: capa.id, reason: requireComment('Appeal reason is required') });
          break;
        case 'uphold_appeal':
          await CapaSupabase.resolveAppeal({ capaId: capa.id, appealId: capa.latest_appeal_id, decision: 'approved', comments: promptComment() });
          break;
        case 'deny_appeal':
          await CapaSupabase.resolveAppeal({ capaId: capa.id, appealId: capa.latest_appeal_id, decision: 'rejected', comments: requireComment('Denial reason is required') });
          break;
        case 'start_effectiveness_review':
          await CapaSupabase.startEffectivenessReview(capa.id);
          break;
        case 'verify_effectiveness':
          await CapaSupabase.verifyEffectiveness({ capaId: capa.id, comments: promptComment() });
          break;
        case 'fail_effectiveness':
          await CapaSupabase.failEffectiveness({ capaId: capa.id, comments: requireComment('Reason effectiveness failed is required') });
          break;
      }
      document.querySelectorAll('.capa-modal-overlay').forEach((m) => m.remove());
      const list = document.querySelector('[data-capa-list-root]');
      if (list) renderCapaList(list);
    } catch (err) {
      alert(`Action failed: ${err.message}`);
    }
  }

  function promptComment() {
    return window.prompt('Comments (optional):') || null;
  }

  function requireComment(message) {
    const val = window.prompt(message);
    if (!val) throw new Error(message);
    return val;
  }

  return { renderCapaList, openCapaDetail };
})();
