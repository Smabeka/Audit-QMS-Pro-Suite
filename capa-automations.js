// capa-automations.js
// Wires your existing cross-module automations into automatic CAPA
// creation: EMP Fail -> CAPA, Critical complaint -> Risk + CAPA.
// This file does NOT redefine those trigger points — it assumes they
// already emit an event (or call a hook) somewhere in your existing
// EMP/complaint modules, and it listens for that. Adjust the
// event names/hook signatures below to match what those modules
// actually emit; the shape here is inferred from your described
// automation ("EMP Fail -> CAPA, Critical complaint -> Risk + CAPA").

(function wireCapaAutomations() {
  if (!window.ohsRegistry) {
    console.error('capa-automations.js: window.ohsRegistry bridge not found — load registry.js first');
    return;
  }

  const capaModule = window.ohsRegistry.getModule('capa');
  if (!capaModule) {
    console.error('capa-automations.js: capa module not registered yet — load capa-manifest.js first');
    return;
  }

  // ------------------------------------------------------------
  // EMP Fail -> CAPA
  // Assumes the EMP module calls window.ohsRegistry.emit('emp:fail', {...})
  // (or dispatches a CustomEvent of the same name on document) when a
  // failing EMP result is recorded. Adjust to your real hook.
  // ------------------------------------------------------------
  document.addEventListener('emp:fail', async (evt) => {
    const { empRecordId, title, description, createdBy } = evt.detail || {};
    if (!empRecordId) {
      console.warn('emp:fail event missing empRecordId, skipping auto-CAPA');
      return;
    }
    try {
      const capa = await capaModule.createCapa({
        title: title || `CAPA — EMP failure ${empRecordId}`,
        description: description || `Auto-generated from EMP failure record ${empRecordId}.`,
        rootCause: null, // left for QA to complete — auto-creation should never guess root cause
        correctiveAction: null,
        createdBy,
      });
      console.log(`Auto-created ${capa.reference_number} from EMP failure ${empRecordId}`);
    } catch (err) {
      console.error('capa-automations: failed to auto-create CAPA from EMP fail', err);
    }
  });

  // ------------------------------------------------------------
  // Critical complaint -> Risk + CAPA
  // Assumes the complaints module dispatches 'complaint:critical' with
  // the complaint record. The Risk side of this automation is handled
  // wherever your existing Risk module automation already lives — this
  // only adds the CAPA half so the two stay in sync without this file
  // owning Risk logic it shouldn't.
  // ------------------------------------------------------------
  document.addEventListener('complaint:critical', async (evt) => {
    const { complaintId, title, description, createdBy } = evt.detail || {};
    if (!complaintId) {
      console.warn('complaint:critical event missing complaintId, skipping auto-CAPA');
      return;
    }
    try {
      const capa = await capaModule.createCapa({
        title: title || `CAPA — Critical complaint ${complaintId}`,
        description: description || `Auto-generated from critical complaint ${complaintId}.`,
        rootCause: null,
        correctiveAction: null,
        createdBy,
      });
      console.log(`Auto-created ${capa.reference_number} from critical complaint ${complaintId}`);
    } catch (err) {
      console.error('capa-automations: failed to auto-create CAPA from critical complaint', err);
    }
  });
})();
