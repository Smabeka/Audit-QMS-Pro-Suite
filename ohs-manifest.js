/**
 * ohs-manifest.js
 * ---------------------------------------------------------------
 * Registers the OHS Act pillar and its modules (HIRA Assessments,
 * Permit to Work) into the central registry.
 *
 * This is the ONLY file that needs to know both about registry.js
 * AND about ohs-core's internal files (ohs-ui.js, ohs-supabase.js).
 * Everything else in the app just calls renderModule('ohs-hira', ...)
 * without caring how it's implemented underneath.
 *
 * Import this file once, near app startup, purely for its side effect
 * (the registerPillar/registerModule calls at module load time):
 *
 *   <script type="module" src="/ohs-manifest.js"></script>
 *
 * Expected ctx shape when renderModule() is called for these modules:
 *   { userRole: string, supabase: SupabaseClient }
 * ---------------------------------------------------------------
 */

import { registerPillar, registerModule } from './registry.js';

import {
  renderHiraModal,
  renderPermitModal,
  canCreateHira,
  canCreatePermit,
} from './js/ohs-core/ohs-ui.js';

import {
  createHiraAssessment,
  createPermit,
} from './js/ohs-core/ohs-supabase.js';

// ---- Pillar registration ------------------------------------------

registerPillar({
  id: 'ohs-act',
  label: 'OHS Act',
  icon: '🦺',
  order: 75, // sits after "Performance & Insights", before "Administration" — adjust to taste
});

// ---- HIRA Assessments module ---------------------------------------

registerModule({
  id: 'ohs-hira',
  pillarId: 'ohs-act',
  label: 'HIRA Assessments',
  icon: '⚠️',
  order: 10,
  canAccess: canCreateHira,
  render(container, ctx) {
    renderHiraModal(container, {
      userRole: ctx.userRole,
      onSubmit: async (hiraData) => {
        const { data, error, eventLoggingFailed } = await createHiraAssessment(ctx.supabase, hiraData);

        if (error && !data) {
          container.innerHTML = `<div class="ohs-modal-error">Failed to save HIRA assessment: ${escapeHtml(error.message)}</div>`;
          return;
        }

        if (eventLoggingFailed) {
          container.innerHTML = `<div class="ohs-banner ohs-banner-warning">HIRA assessment saved, but the audit log entry failed. Please note the assessment ID (${escapeHtml(data.id)}) and inform your Quality Manager.</div>`;
          return;
        }

        container.innerHTML = `<div class="ohs-success">HIRA assessment saved successfully.</div>`;
        if (typeof ctx.onComplete === 'function') ctx.onComplete(data);
      },
      onCancel: () => {
        container.innerHTML = '';
        if (typeof ctx.onCancel === 'function') ctx.onCancel();
      },
    });
  },
});

// ---- Permit to Work module -------------------------------------------

registerModule({
  id: 'ohs-ptw',
  pillarId: 'ohs-act',
  label: 'Permit to Work',
  icon: '📋',
  order: 20,
  canAccess: canCreatePermit,
  render(container, ctx) {
    renderPermitModal(container, {
      userRole: ctx.userRole,
      hiraApproved: ctx.hiraApproved ?? null, // pass this in if opening from a specific approved HIRA
      onSubmit: async (permitData) => {
        const { data, error } = await createPermit(ctx.supabase, permitData, ctx.hiraId || null);

        if (error) {
          container.innerHTML = `<div class="ohs-modal-error">Failed to create permit: ${escapeHtml(error.message)}</div>`;
          return;
        }

        container.innerHTML = `<div class="ohs-success">Permit created and ready for sign-off.</div>`;
        if (typeof ctx.onComplete === 'function') ctx.onComplete(data);
      },
      onCancel: () => {
        container.innerHTML = '';
        if (typeof ctx.onCancel === 'function') ctx.onCancel();
      },
    });
  },
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---- Bridge for non-module inline scripts -----------------------------
// index.html's main app code is a plain <script> (not type="module"), so
// it cannot `import` from registry.js directly. Expose what it needs here.
import { renderModule as _renderModule, getPillars as _getPillars, getModulesForPillar as _getModulesForPillar } from './registry.js';

window.ohsRegistry = {
  renderModule: _renderModule,
  getPillars: _getPillars,
  getModulesForPillar: _getModulesForPillar,
};
