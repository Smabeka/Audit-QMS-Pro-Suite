/**
 * ptw.js
 * ---------------------------------------------------------------
 * Permit to Work (PTW) state machine.
 * OHS Act 85 of 1993 / Construction Regs aligned.
 *
 * Pure logic module — no DOM, no Supabase. Consumes evaluateHira()
 * output from hira.js to decide whether a permit is mandatory.
 * ---------------------------------------------------------------
 */

// ---- Constants ----------------------------------------------------

export const PERMIT_TYPES = [
  { key: 'HOT_WORK', label: 'Hot Work', requiresGasTest: true, requiresFireWatch: true },
  { key: 'CONFINED_SPACE', label: 'Confined Space Entry', requiresGasTest: true, requiresFireWatch: false },
  { key: 'ELECTRICAL', label: 'Electrical Isolation / LOTO', requiresGasTest: false, requiresFireWatch: false },
  { key: 'HEIGHTS', label: 'Work at Heights', requiresGasTest: false, requiresFireWatch: false },
  { key: 'EXCAVATION', label: 'Excavation', requiresGasTest: false, requiresFireWatch: false },
  { key: 'GENERAL', label: 'General High-Risk Work', requiresGasTest: false, requiresFireWatch: false },
];

export const PERMIT_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'EXTENDED', 'CLOSED', 'REVOKED'];

// Statutory gas test thresholds
export const GAS_TEST_LIMITS = {
  O2_MIN: 19.5,
  O2_MAX: 23.5,
  LEL_MAX: 10,   // % of Lower Explosive Limit
  CO_MAX: 30,    // ppm
};

// Legal valid state transitions. Anything not listed here is rejected.
const TRANSITIONS = {
  DRAFT: ['PENDING_APPROVAL', 'REVOKED'],
  PENDING_APPROVAL: ['ACTIVE', 'DRAFT', 'REVOKED'], // DRAFT = sent back for corrections
  ACTIVE: ['EXTENDED', 'CLOSED', 'REVOKED'],
  EXTENDED: ['ACTIVE', 'CLOSED', 'REVOKED'],
  CLOSED: [], // terminal
  REVOKED: [], // terminal
};

// ---- Permit Type Helpers -------------------------------------------

export function getPermitTypeConfig(permitTypeKey) {
  const config = PERMIT_TYPES.find((p) => p.key === permitTypeKey);
  if (!config) {
    throw new Error(`Unknown permit type: ${permitTypeKey}`);
  }
  return config;
}

// ---- Gas Test Validation -------------------------------------------

/**
 * Validate a gas test reading against statutory thresholds.
 * @param {{o2: number, lel: number, co: number}} reading
 * @returns {{pass: boolean, failures: string[]}}
 */
export function validateGasTest(reading) {
  const failures = [];

  if (reading.o2 < GAS_TEST_LIMITS.O2_MIN || reading.o2 > GAS_TEST_LIMITS.O2_MAX) {
    failures.push(`O2 reading ${reading.o2}% outside safe range (${GAS_TEST_LIMITS.O2_MIN}-${GAS_TEST_LIMITS.O2_MAX}%)`);
  }
  if (reading.lel > GAS_TEST_LIMITS.LEL_MAX) {
    failures.push(`LEL reading ${reading.lel}% exceeds limit (${GAS_TEST_LIMITS.LEL_MAX}%)`);
  }
  if (reading.co > GAS_TEST_LIMITS.CO_MAX) {
    failures.push(`CO reading ${reading.co}ppm exceeds limit (${GAS_TEST_LIMITS.CO_MAX}ppm)`);
  }

  return { pass: failures.length === 0, failures };
}

// ---- State Machine --------------------------------------------------

/**
 * Check whether a transition from one status to another is legal.
 * @param {string} fromStatus
 * @param {string} toStatus
 */
export function canTransition(fromStatus, toStatus) {
  const allowed = TRANSITIONS[fromStatus];
  if (!allowed) {
    throw new Error(`Unknown status: ${fromStatus}`);
  }
  return allowed.includes(toStatus);
}

/**
 * Attempt a transition. Throws if illegal — callers should catch and
 * surface to the UI rather than silently failing.
 */
export function transition(fromStatus, toStatus) {
  if (!canTransition(fromStatus, toStatus)) {
    throw new Error(`Illegal permit transition: ${fromStatus} -> ${toStatus}`);
  }
  return toStatus;
}

// ---- Issuance Validation ---------------------------------------------

/**
 * Validate that a permit is ready to move from PENDING_APPROVAL to ACTIVE.
 * Mirrors the "Hard Stop Logic" from your architecture doc — this is the
 * function the UI calls before enabling the final sign-off button.
 *
 * @param {object} permit
 * @param {string} permit.permit_type
 * @param {boolean} permit.fire_watch_assigned
 * @param {{o2:number, lel:number, co:number}} [permit.gas_test]
 * @param {boolean} permit.supervisor_signed
 * @param {boolean} permit.safety_officer_signed
 * @param {boolean} [permit.hiraApproved] - result of hira.js readyForApproval
 */
export function validatePermitForActivation(permit) {
  const config = getPermitTypeConfig(permit.permit_type);
  const blockers = [];

  if (config.requiresGasTest) {
    if (!permit.gas_test) {
      blockers.push('Gas test reading is required before activation.');
    } else {
      const gasResult = validateGasTest(permit.gas_test);
      if (!gasResult.pass) {
        blockers.push(...gasResult.failures);
      }
    }
  }

  if (config.requiresFireWatch && !permit.fire_watch_assigned) {
    blockers.push('Fire watch must be assigned before activation.');
  }

  if (!permit.supervisor_signed) {
    blockers.push('Supervisor sign-off missing.');
  }

  if (!permit.safety_officer_signed) {
    blockers.push('Safety Officer sign-off missing.');
  }

  if (permit.hiraApproved === false) {
    blockers.push('Linked HIRA assessment is not yet approved.');
  }

  return { canActivate: blockers.length === 0, blockers };
}

/**
 * Determine if an active permit has expired based on valid_to timestamp.
 * @param {string|Date} validTo
 * @param {Date} [now]
 */
export function isPermitExpired(validTo, now = new Date()) {
  return new Date(validTo).getTime() < now.getTime();
}

/**
 * Determine if a permit is nearing expiry (for warning banners).
 * @param {string|Date} validTo
 * @param {number} warningMinutes - default 30
 * @param {Date} [now]
 */
export function isPermitNearingExpiry(validTo, warningMinutes = 30, now = new Date()) {
  const msRemaining = new Date(validTo).getTime() - now.getTime();
  const warningMs = warningMinutes * 60 * 1000;
  return msRemaining > 0 && msRemaining <= warningMs;
}
