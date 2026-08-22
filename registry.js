/**
 * registry.js
 * ---------------------------------------------------------------
 * Central module registry for AuditQMS Pro Suite.
 *
 * Concept: your 7 (soon 8) accordion pillars are containers.
 * Each feature module self-registers into a pillar with a label,
 * icon, and a render(container, ctx) function. The nav code just
 * asks the registry "what modules exist for this pillar?" and
 * "render module X into this DOM node" — it never needs to know
 * about hira.js, capa.js, etc. directly.
 *
 * This file has zero dependencies and no DOM assumptions beyond
 * what render() functions do internally. It's safe to import from
 * anywhere without pulling in Supabase, state, or other modules.
 * ---------------------------------------------------------------
 */

const pillars = new Map();   // pillarId -> { id, label, icon, order }
const modules = new Map();   // moduleId -> { id, pillarId, label, icon, order, render, canAccess }

/**
 * Register a top-level nav pillar (e.g. "OHS Act").
 * Safe to call multiple times with the same id — last call wins,
 * with a console warning so accidental duplicate registration is visible.
 *
 * @param {object} config
 * @param {string} config.id - unique pillar id, e.g. 'ohs-act'
 * @param {string} config.label - display label, e.g. 'OHS Act'
 * @param {string} [config.icon] - emoji or icon class, matches your existing pillar icons
 * @param {number} [config.order] - lower = earlier in the accordion list (default 100)
 */
export function registerPillar({ id, label, icon = '', order = 100 }) {
  if (!id || !label) {
    throw new Error('registerPillar requires both id and label.');
  }
  if (pillars.has(id)) {
    console.warn(`[registry] Pillar "${id}" already registered — overwriting previous registration.`);
  }
  pillars.set(id, { id, label, icon, order });
}

/**
 * Register a feature module under an already-registered pillar.
 *
 * @param {object} config
 * @param {string} config.id - unique module id, e.g. 'ohs-hira'
 * @param {string} config.pillarId - must match a pillar already registered via registerPillar
 * @param {string} config.label - display label, e.g. 'HIRA Assessments'
 * @param {string} [config.icon]
 * @param {number} [config.order] - ordering within the pillar (default 100)
 * @param {(container: HTMLElement, ctx: object) => void} config.render
 * @param {(userRole: string) => boolean} [config.canAccess] - defaults to always-true
 */
export function registerModule({ id, pillarId, label, icon = '', order = 100, render, canAccess }) {
  if (!id || !pillarId || !label) {
    throw new Error('registerModule requires id, pillarId, and label.');
  }
  if (!pillars.has(pillarId)) {
    throw new Error(
      `Cannot register module "${id}": pillar "${pillarId}" is not registered yet. ` +
      `Call registerPillar({ id: "${pillarId}", ... }) before registering modules into it.`
    );
  }
  if (typeof render !== 'function') {
    throw new Error(`Module "${id}" must provide a render(container, ctx) function.`);
  }
  if (modules.has(id)) {
    console.warn(`[registry] Module "${id}" already registered — overwriting previous registration.`);
  }

  modules.set(id, {
    id,
    pillarId,
    label,
    icon,
    order,
    render,
    canAccess: typeof canAccess === 'function' ? canAccess : () => true,
  });
}

/**
 * Get all registered pillars, sorted by their order value.
 */
export function getPillars() {
  return Array.from(pillars.values()).sort((a, b) => a.order - b.order);
}

/**
 * Get modules for a given pillar, filtered by role access and sorted by order.
 * @param {string} pillarId
 * @param {string} [userRole] - if omitted, canAccess is called with undefined
 */
export function getModulesForPillar(pillarId, userRole) {
  return Array.from(modules.values())
    .filter((m) => m.pillarId === pillarId)
    .filter((m) => m.canAccess(userRole))
    .sort((a, b) => a.order - b.order);
}

/**
 * Render a specific module by id into a container element.
 * Handles the "module not found" and "access denied" cases so callers
 * don't need to duplicate that logic at every call site.
 *
 * @param {string} moduleId
 * @param {HTMLElement} container
 * @param {object} ctx - passed straight through to the module's render function.
 *   Convention: ctx should include at least { userRole, supabase }.
 */
export function renderModule(moduleId, container, ctx = {}) {
  const mod = modules.get(moduleId);

  if (!mod) {
    container.innerHTML = `<div class="registry-error">Module "${escapeHtml(moduleId)}" is not registered.</div>`;
    return;
  }

  if (!mod.canAccess(ctx.userRole)) {
    container.innerHTML = `<div class="registry-error">Your role does not have access to ${escapeHtml(mod.label)}.</div>`;
    return;
  }

  mod.render(container, ctx);
}

/**
 * Look up a single module's metadata without rendering it.
 * @param {string} moduleId
 */
export function getModule(moduleId) {
  return modules.get(moduleId);
}

/**
 * Debug helper — full dump of everything registered so far.
 * Useful in the browser console: import and call registryDebugDump().
 */
export function registryDebugDump() {
  return {
    pillars: getPillars(),
    modules: Array.from(modules.values()).map((m) => ({
      id: m.id,
      pillarId: m.pillarId,
      label: m.label,
      order: m.order,
    })),
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
