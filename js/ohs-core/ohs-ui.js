/**
 * ohs-ui.js
 * ---------------------------------------------------------------
 * Rendering layer for the OHS Core module (HIRA + Permit to Work).
 * Consumes hira.js and ptw.js for logic, ohs-supabase.js (next file)
 * for persistence. No prompt()/confirm() — modal-based, matching
 * the dispute-resolution pattern already used for CAPA findings.
 *
 * Role mapping (per project decision):
 *   Supervisor sign-off      -> Department Manager
 *   Safety Officer sign-off  -> Quality Manager
 * ---------------------------------------------------------------
 */

import {
  SEVERITY_LEVELS,
  LIKELIHOOD_LEVELS,
  HIERARCHY_OF_CONTROLS,
  evaluateHira,
} from './hira.js';

import {
  PERMIT_TYPES,
  GAS_TEST_LIMITS,
  validateGasTest,
  validatePermitForActivation,
  isPermitNearingExpiry,
  isPermitExpired,
} from './ptw.js';

// ---- Role Gating ----------------------------------------------------
// Mirrors the canChallenge / canReview / isAdmin pattern used in CAPA.

/**
 * @param {string} userRole - one of the six RBAC roles
 */
export function canGiveSupervisorSignoff(userRole) {
  return userRole === 'Department Manager' || userRole === 'Admin';
}

export function canGiveSafetyOfficerSignoff(userRole) {
  return userRole === 'Quality Manager' || userRole === 'Admin';
}

export function canCreateHira(userRole) {
  return ['Admin', 'Quality Manager', 'Department Manager', 'Auditor'].includes(userRole);
}

export function canApproveHira(userRole) {
  return userRole === 'Quality Manager' || userRole === 'Admin';
}

export function canCreatePermit(userRole) {
  return ['Admin', 'Quality Manager', 'Department Manager', 'Employee'].includes(userRole);
}

export function canRevokePermit(userRole) {
  return userRole === 'Quality Manager' || userRole === 'Admin';
}

// ---- Modal: HIRA Assessment Form -------------------------------------

/**
 * Renders the HIRA assessment modal into a container element.
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {string} opts.userRole
 * @param {(formResult: object) => void} opts.onSubmit - called with evaluateHira() result + raw fields
 * @param {() => void} opts.onCancel
 */
export function renderHiraModal(container, { userRole, onSubmit, onCancel }) {
  if (!canCreateHira(userRole)) {
    container.innerHTML = `<div class="ohs-modal-error">Your role (${escapeHtml(userRole)}) is not permitted to create HIRA assessments.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="ohs-modal-backdrop" data-role="backdrop">
      <div class="ohs-modal" role="dialog" aria-modal="true" aria-labelledby="hira-modal-title">
        <h2 id="hira-modal-title">New HIRA Assessment</h2>

        <label class="ohs-field">
          <span>Activity Description</span>
          <textarea id="hira-activity" rows="2" required></textarea>
        </label>

        <label class="ohs-field">
          <span>Location</span>
          <input id="hira-location" type="text" required />
        </label>

        <div class="ohs-field-row">
          <label class="ohs-field">
            <span>Inherent Severity</span>
            ${buildRatingSelect('hira-inherent-severity', SEVERITY_LEVELS)}
          </label>
          <label class="ohs-field">
            <span>Inherent Likelihood</span>
            ${buildRatingSelect('hira-inherent-likelihood', LIKELIHOOD_LEVELS)}
          </label>
        </div>

        <div id="hira-inherent-result" class="ohs-risk-badge" aria-live="polite"></div>

        <fieldset class="ohs-controls-fieldset">
          <legend>Applied Controls (select all that apply)</legend>
          ${HIERARCHY_OF_CONTROLS.map(
            (c) => `
            <label class="ohs-checkbox">
              <input type="checkbox" name="hira-control" value="${c.key}" />
              ${escapeHtml(c.rank)}. ${escapeHtml(c.label)} — ${escapeHtml(c.description)}
            </label>`
          ).join('')}
        </fieldset>

        <div class="ohs-field-row">
          <label class="ohs-field">
            <span>Residual Severity</span>
            ${buildRatingSelect('hira-residual-severity', SEVERITY_LEVELS)}
          </label>
          <label class="ohs-field">
            <span>Residual Likelihood</span>
            ${buildRatingSelect('hira-residual-likelihood', LIKELIHOOD_LEVELS)}
          </label>
        </div>

        <div id="hira-residual-result" class="ohs-risk-badge" aria-live="polite"></div>
        <div id="hira-blockers" class="ohs-blockers" aria-live="polite"></div>

        <div class="ohs-modal-actions">
          <button type="button" data-action="cancel" class="ohs-btn-secondary">Cancel</button>
          <button type="button" data-action="submit" class="ohs-btn-primary">Save HIRA Assessment</button>
        </div>
      </div>
    </div>
  `;

  const $ = (sel) => container.querySelector(sel);

  const recalc = () => {
    const inherentSeverity = Number($('#hira-inherent-severity').value);
    const inherentLikelihood = Number($('#hira-inherent-likelihood').value);
    const residualSeverity = Number($('#hira-residual-severity').value);
    const residualLikelihood = Number($('#hira-residual-likelihood').value);
    const appliedControlKeys = Array.from(container.querySelectorAll('input[name="hira-control"]:checked')).map((el) => el.value);

    let result = null;
    try {
      result = evaluateHira({
        severity: inherentSeverity,
        likelihood: inherentLikelihood,
        residualSeverity,
        residualLikelihood,
        appliedControlKeys,
      });
    } catch (e) {
      $('#hira-blockers').textContent = e.message;
      return null;
    }

    $('#hira-inherent-result').innerHTML = riskBadgeHtml('Inherent', result.inherent);
    $('#hira-residual-result').innerHTML = riskBadgeHtml('Residual', result.residual);

    const blockers = [];
    if (!result.residual.acceptable) blockers.push('Residual risk score exceeds the acceptable threshold.');
    if (result.residual.flagForReview) blockers.push('Only PPE (or no control) applied against a high residual score — flagged for independent review.');
    $('#hira-blockers').innerHTML = blockers.map((b) => `<div class="ohs-blocker">${escapeHtml(b)}</div>`).join('');

    return { result, appliedControlKeys, blockers };
  };

  container.querySelectorAll('select, input[name="hira-control"]').forEach((el) => {
    el.addEventListener('change', recalc);
  });
  recalc();

  $('[data-action="cancel"]').addEventListener('click', () => onCancel && onCancel());
  $('[data-role="backdrop"]').addEventListener('click', (e) => {
    if (e.target === e.currentTarget && onCancel) onCancel();
  });

  $('[data-action="submit"]').addEventListener('click', () => {
    const activity = $('#hira-activity').value.trim();
    const location = $('#hira-location').value.trim();
    if (!activity || !location) {
      $('#hira-blockers').innerHTML = `<div class="ohs-blocker">Activity description and location are required.</div>`;
      return;
    }

    const calc = recalc();
    if (!calc) return;

    onSubmit({
      activity_description: activity,
      location,
      inherent_severity: Number($('#hira-inherent-severity').value),
      inherent_likelihood: Number($('#hira-inherent-likelihood').value),
      residual_severity: Number($('#hira-residual-severity').value),
      residual_likelihood: Number($('#hira-residual-likelihood').value),
      applied_controls: calc.appliedControlKeys,
      permit_required: calc.result.permitRequired,
      status: calc.result.readyForApproval ? 'PENDING_APPROVAL' : 'UNDER_REVIEW',
      evaluation: calc.result,
    });
  });
}

// ---- Modal: Permit to Work Wizard --------------------------------------

/**
 * Renders the PTW modal. Two-step: scope/type, then sign-offs.
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {string} opts.userRole
 * @param {boolean} [opts.hiraApproved] - whether the linked HIRA is approved
 * @param {(permitDraft: object) => void} opts.onSubmit
 * @param {() => void} opts.onCancel
 */
export function renderPermitModal(container, { userRole, hiraApproved = null, onSubmit, onCancel }) {
  if (!canCreatePermit(userRole)) {
    container.innerHTML = `<div class="ohs-modal-error">Your role (${escapeHtml(userRole)}) is not permitted to create permits.</div>`;
    return;
  }

  const supervisorAllowed = canGiveSupervisorSignoff(userRole);
  const safetyOfficerAllowed = canGiveSafetyOfficerSignoff(userRole);

  container.innerHTML = `
    <div class="ohs-modal-backdrop" data-role="backdrop">
      <div class="ohs-modal" role="dialog" aria-modal="true" aria-labelledby="ptw-modal-title">
        <h2 id="ptw-modal-title">Issue Permit to Work</h2>

        <label class="ohs-field">
          <span>Permit Type</span>
          <select id="ptw-type">
            ${PERMIT_TYPES.map((p) => `<option value="${p.key}">${escapeHtml(p.label)}</option>`).join('')}
          </select>
        </label>

        <label class="ohs-field">
          <span>Location / Zone</span>
          <input id="ptw-location" type="text" required />
        </label>

        <label class="ohs-field">
          <span>Equipment ID (optional)</span>
          <input id="ptw-equipment" type="text" />
        </label>

        <div class="ohs-field-row">
          <label class="ohs-field">
            <span>Valid From</span>
            <input id="ptw-valid-from" type="datetime-local" required />
          </label>
          <label class="ohs-field">
            <span>Valid To</span>
            <input id="ptw-valid-to" type="datetime-local" required />
          </label>
        </div>

        <div id="ptw-gas-section" style="display:none;">
          <fieldset>
            <legend>Atmospheric Gas Test</legend>
            <div class="ohs-field-row">
              <label class="ohs-field"><span>O2 (%)</span><input id="ptw-gas-o2" type="number" step="0.1" value="20.9" /></label>
              <label class="ohs-field"><span>LEL (%)</span><input id="ptw-gas-lel" type="number" step="0.1" value="0" /></label>
              <label class="ohs-field"><span>CO (ppm)</span><input id="ptw-gas-co" type="number" step="1" value="0" /></label>
            </div>
            <p class="ohs-hint">Safe range: O2 ${GAS_TEST_LIMITS.O2_MIN}-${GAS_TEST_LIMITS.O2_MAX}% · LEL &lt;${GAS_TEST_LIMITS.LEL_MAX}% · CO &lt;${GAS_TEST_LIMITS.CO_MAX}ppm</p>
          </fieldset>
        </div>

        <div id="ptw-firewatch-section" style="display:none;">
          <label class="ohs-checkbox">
            <input type="checkbox" id="ptw-firewatch" />
            Fire watch personnel assigned on site
          </label>
        </div>

        <div class="ohs-signoff-section">
          <div class="ohs-signoff-row">
            <span>Supervisor Sign-off (Department Manager)</span>
            <button type="button" id="ptw-supervisor-sign" class="ohs-btn-secondary" ${supervisorAllowed ? '' : 'disabled title="Your role cannot give this sign-off"'}>
              Sign
            </button>
            <span id="ptw-supervisor-status" class="ohs-signoff-status">Not signed</span>
          </div>
          <div class="ohs-signoff-row">
            <span>Safety Officer Sign-off (Quality Manager)</span>
            <button type="button" id="ptw-safety-sign" class="ohs-btn-secondary" ${safetyOfficerAllowed ? '' : 'disabled title="Your role cannot give this sign-off"'}>
              Sign
            </button>
            <span id="ptw-safety-status" class="ohs-signoff-status">Not signed</span>
          </div>
        </div>

        <div id="ptw-blockers" class="ohs-blockers" aria-live="polite"></div>

        <div class="ohs-modal-actions">
          <button type="button" data-action="cancel" class="ohs-btn-secondary">Cancel</button>
          <button type="button" data-action="submit" class="ohs-btn-primary" disabled>Activate Permit</button>
        </div>
      </div>
    </div>
  `;

  const $ = (sel) => container.querySelector(sel);
  const state = { supervisorSigned: false, safetyOfficerSigned: false };

  const toggleTypeSections = () => {
    const config = PERMIT_TYPES.find((p) => p.key === $('#ptw-type').value);
    $('#ptw-gas-section').style.display = config.requiresGasTest ? 'block' : 'none';
    $('#ptw-firewatch-section').style.display = config.requiresFireWatch ? 'block' : 'none';
    revalidate();
  };

  const revalidate = () => {
    const permitType = $('#ptw-type').value;
    const gasSection = $('#ptw-gas-section').style.display !== 'none';

    const permitDraft = {
      permit_type: permitType,
      fire_watch_assigned: $('#ptw-firewatch').checked,
      gas_test: gasSection
        ? { o2: Number($('#ptw-gas-o2').value), lel: Number($('#ptw-gas-lel').value), co: Number($('#ptw-gas-co').value) }
        : undefined,
      supervisor_signed: state.supervisorSigned,
      safety_officer_signed: state.safetyOfficerSigned,
      hiraApproved,
    };

    const result = validatePermitForActivation(permitDraft);
    $('#ptw-blockers').innerHTML = result.blockers.map((b) => `<div class="ohs-blocker">${escapeHtml(b)}</div>`).join('');
    $('[data-action="submit"]').disabled = !result.canActivate;

    return { permitDraft, result };
  };

  $('#ptw-type').addEventListener('change', toggleTypeSections);
  container.querySelectorAll('#ptw-gas-o2, #ptw-gas-lel, #ptw-gas-co, #ptw-firewatch').forEach((el) => {
    el && el.addEventListener('input', revalidate);
    el && el.addEventListener('change', revalidate);
  });

  $('#ptw-supervisor-sign').addEventListener('click', () => {
    if (!supervisorAllowed) return;
    state.supervisorSigned = true;
    $('#ptw-supervisor-status').textContent = `Signed by ${userRole} at ${new Date().toLocaleTimeString()}`;
    $('#ptw-supervisor-sign').disabled = true;
    revalidate();
  });

  $('#ptw-safety-sign').addEventListener('click', () => {
    if (!safetyOfficerAllowed) return;
    state.safetyOfficerSigned = true;
    $('#ptw-safety-status').textContent = `Signed by ${userRole} at ${new Date().toLocaleTimeString()}`;
    $('#ptw-safety-sign').disabled = true;
    revalidate();
  });

  toggleTypeSections();

  $('[data-action="cancel"]').addEventListener('click', () => onCancel && onCancel());
  $('[data-role="backdrop"]').addEventListener('click', (e) => {
    if (e.target === e.currentTarget && onCancel) onCancel();
  });

  $('[data-action="submit"]').addEventListener('click', () => {
    const location = $('#ptw-location').value.trim();
    const validFrom = $('#ptw-valid-from').value;
    const validTo = $('#ptw-valid-to').value;
    if (!location || !validFrom || !validTo) {
      $('#ptw-blockers').innerHTML = `<div class="ohs-blocker">Location, valid-from and valid-to are required.</div>`;
      return;
    }

    const { permitDraft, result } = revalidate();
    if (!result.canActivate) return;

    onSubmit({
      permit_type: permitDraft.permit_type,
      location,
      equipment_id: $('#ptw-equipment').value.trim() || null,
      valid_from: new Date(validFrom).toISOString(),
      valid_to: new Date(validTo).toISOString(),
      fire_watch_assigned: permitDraft.fire_watch_assigned,
      gas_test_o2: permitDraft.gas_test ? permitDraft.gas_test.o2 : null,
      gas_test_lel: permitDraft.gas_test ? permitDraft.gas_test.lel : null,
      gas_test_co: permitDraft.gas_test ? permitDraft.gas_test.co : null,
      gas_test_time: permitDraft.gas_test ? new Date().toISOString() : null,
      status: 'ACTIVE',
    });
  });
}

// ---- Read-only widget: Permit expiry banner ------------------------------

/**
 * Returns HTML for an expiry warning banner, or empty string if not needed.
 * Call this per-permit in your dashboard render loop.
 * @param {string|Date} validTo
 */
export function permitExpiryBannerHtml(validTo) {
  if (isPermitExpired(validTo)) {
    return `<div class="ohs-banner ohs-banner-expired">Permit expired ${new Date(validTo).toLocaleString()}</div>`;
  }
  if (isPermitNearingExpiry(validTo)) {
    return `<div class="ohs-banner ohs-banner-warning">Permit expires soon: ${new Date(validTo).toLocaleString()}</div>`;
  }
  return '';
}

// ---- Internal helpers -----------------------------------------------------

function buildRatingSelect(id, levels) {
  return `
    <select id="${id}">
      ${levels.map((l) => `<option value="${l.value}">${l.value} — ${escapeHtml(l.label)}</option>`).join('')}
    </select>
  `;
}

function riskBadgeHtml(label, assessment) {
  return `
    <span class="ohs-badge" style="background:${assessment.color}">
      ${escapeHtml(label)}: ${assessment.score} (${escapeHtml(assessment.band)})
    </span>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
