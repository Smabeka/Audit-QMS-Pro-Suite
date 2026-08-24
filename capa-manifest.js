// capa-manifest.js
// Registers the CAPA module with the app's central registry, exactly
// like ohs-manifest.js does for HIRA/PTW. This is the bridge point:
// classic scripts set window.ohsRegistry.supabaseClient / currentUser
// before this module script runs, since ES modules can't see those
// globals directly otherwise.

import { CapaUI } from './js/ohs-core/capa-ui.js';
import { CapaEngine } from './js/ohs-core/capa.js';
import { CapaSupabase } from './js/ohs-core/capa-supabase.js';

(function registerCapaModule() {
  if (!window.ohsRegistry) {
    console.error('capa-manifest.js: window.ohsRegistry bridge not found — load registry.js first');
    return;
  }

  window.ohsRegistry.registerModule('capa', {
    name: 'CAPA',
    navPillar: 'Quality',
    mount(containerEl) {
      containerEl.setAttribute('data-capa-list-root', 'true');
      CapaUI.renderCapaList(containerEl);
    },
    // exposed for other modules that create CAPAs automatically,
    // e.g. your existing EMP Fail -> CAPA and Critical complaint ->
    // Risk + CAPA automations
    createCapa: CapaSupabase.createCapa,
    engine: CapaEngine,
  });
})();
