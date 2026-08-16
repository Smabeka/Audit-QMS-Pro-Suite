/**
 * hira.js
 * ---------------------------------------------------------------
 * Hazard Identification & Risk Assessment (HIRA) core logic.
 * OHS Act 85 of 1993 aligned risk matrix + hierarchy of controls.
 *
 * Pure logic module — no DOM, no Supabase. Import into ohs-ui.js
 * and ohs-supabase.js as needed.
 * ---------------------------------------------------------------
 */

// ---- Risk Matrix Constants ------------------------------------

export const SEVERITY_LEVELS = [
  { value: 1, label: 'Negligible', description: 'No injury / no lost time' },
  { value: 2, label: 'Minor', description: 'First aid only' },
  { value: 3, label: 'Moderate', description: 'Medical treatment / lost time injury' },
  { value: 4, label: 'Major', description: 'Permanent disability / hospitalisation' },
  { value: 5, label: 'Catastrophic', description: 'Fatality or multiple fatalities' },
];

export const LIKELIHOOD_LEVELS = [
  { value: 1, label: 'Rare', description: 'May occur in exceptional circumstances' },
  { value: 2, label: 'Unlikely', description: 'Could occur at some time' },
  { value: 3, label: 'Possible', description: 'Might occur at some time' },
  { value: 4, label: 'Likely', description: 'Will probably occur' },
  { value: 5, label: 'Almost Certain', description: 'Expected to occur in most circumstances' },
];

// 5x5 matrix bands: 1-5 Low, 6-12 Medium, 15-25 Critical (per your Gemini spec)
export const RISK_BANDS = [
  { min: 1, max: 5, label: 'Low', color: '#4caf50', requiresEscalation: false },
  { min: 6, max: 12, label: 'Medium', color: '#ffb300', requiresEscalation: false },
  { min: 13, max: 14, label: 'High', color: '#f57c00', requiresEscalation: true },
  { min: 15, max: 25, label: 'Critical', color: '#c62828', requiresEscalation: true },
];

// Hierarchy of Controls, most to least effective
export const HIERARCHY_OF_CONTROLS = [
  { rank: 1, key: 'ELIMINATION', label: 'Elimination', description: 'Physically remove the hazard' },
  { rank: 2, key: 'SUBSTITUTION', label: 'Substitution', description: 'Replace with a lesser hazard' },
  { rank: 3, key: 'ENGINEERING', label: 'Engineering Controls', description: 'Isolate people from the hazard' },
  { rank: 4, key: 'ADMINISTRATIVE', label: 'Administrative Controls', description: 'Change the way people work' },
  { rank: 5, key: 'PPE', label: 'Personal Protective Equipment', description: 'Protect the worker with PPE' },
];

// Residual risk above this score is never acceptable without executive sign-off
export const RESIDUAL_ACCEPTABLE_THRESHOLD = 12;

// ---- Core Calculations ------------------------------------------

/**
 * Calculate a raw risk score from severity x likelihood.
 * @param {number} severity 1-5
 * @param {number} likelihood 1-5
 * @returns {number} score 1-25
 */
export function calculateRiskScore(severity, likelihood) {
  validateRating(severity, 'severity');
  validateRating(likelihood, 'likelihood');
  return severity * likelihood;
}

/**
 * Resolve a numeric score to its risk band (Low/Medium/High/Critical).
 * @param {number} score
 * @returns {{label: string, color: string, requiresEscalation: boolean}}
 */
export function getRiskBand(score) {
  const band = RISK_BANDS.find((b) => score >= b.min && score <= b.max);
  if (!band) {
    throw new Error(`No risk band found for score ${score}`);
  }
  return band;
}

/**
 * Full inherent risk assessment: score + band in one call.
 * @param {number} severity
 * @param {number} likelihood
 */
export function assessInherentRisk(severity, likelihood) {
  const score = calculateRiskScore(severity, likelihood);
  const band = getRiskBand(score);
  return { severity, likelihood, score, band: band.label, color: band.color, requiresEscalation: band.requiresEscalation };
}

/**
 * Calculate residual risk after controls are applied.
 * Controls don't have a single formula in OHS practice — the assessor
 * re-rates severity/likelihood after considering the controls applied.
 * This function validates the re-rating and flags whether it's acceptable,
 * and whether the claimed reduction is plausible given how many control
 * tiers were actually applied (sanity check, not a hard block).
 *
 * @param {number} residualSeverity
 * @param {number} residualLikelihood
 * @param {string[]} appliedControlKeys - keys from HIERARCHY_OF_CONTROLS
 */
export function assessResidualRisk(residualSeverity, residualLikelihood, appliedControlKeys = []) {
  const result = assessInherentRisk(residualSeverity, residualLikelihood);
  const acceptable = result.score <= RESIDUAL_ACCEPTABLE_THRESHOLD;

  const highestControlApplied = HIERARCHY_OF_CONTROLS
    .filter((c) => appliedControlKeys.includes(c.key))
    .sort((a, b) => a.rank - b.rank)[0] || null;

  return {
    ...result,
    acceptable,
    appliedControls: appliedControlKeys,
    highestControlTier: highestControlApplied ? highestControlApplied.label : 'None',
    // If nothing beyond PPE was applied but score is still Critical, flag for review
    flagForReview: !acceptable && (!highestControlApplied || highestControlApplied.rank === 5),
  };
}

/**
 * Determine whether a work activity requires a mandatory Permit to Work
 * based on inherent risk score, independent of PTW type selection.
 * @param {number} inherentScore
 */
export function requiresPermitToWork(inherentScore) {
  const band = getRiskBand(inherentScore);
  return band.requiresEscalation;
}

/**
 * Full HIRA workflow evaluation — combines inherent + residual in one
 * call for convenience when saving a HIRA record.
 *
 * @param {object} input
 * @param {number} input.severity
 * @param {number} input.likelihood
 * @param {number} input.residualSeverity
 * @param {number} input.residualLikelihood
 * @param {string[]} input.appliedControlKeys
 */
export function evaluateHira(input) {
  const inherent = assessInherentRisk(input.severity, input.likelihood);
  const residual = assessResidualRisk(
    input.residualSeverity,
    input.residualLikelihood,
    input.appliedControlKeys || []
  );

  return {
    inherent,
    residual,
    permitRequired: requiresPermitToWork(inherent.score),
    readyForApproval: residual.acceptable && !residual.flagForReview,
  };
}

// ---- Validation Helpers ------------------------------------------

function validateRating(value, fieldName) {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error(`${fieldName} must be an integer between 1 and 5, got: ${value}`);
  }
}
