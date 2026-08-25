/* =====================================================================
   AuditQMS Pro Suite — Legacy Finding Migration (run in-browser)
   =====================================================================
   WHY THIS RUNS IN THE BROWSER, NOT AS SQL:
   Your findings live in state.audits[].findings[], persisted only to
   localStorage on this device — they were never synced to Supabase.
   A SQL script can only move data that's already in Postgres, so the
   migration has to walk the in-memory `state` this app already has
   loaded and push each finding up via the import_legacy_finding RPC
   (05_legacy_finding_import.sql — apply that first).

   HOW TO RUN:
   1. Open app.auditqmspro.com and sign in as normal (so supabaseClient
      has an authenticated session).
   2. Open the browser DevTools console (F12 or long-press > Inspect on
      mobile Chrome > Console tab).
   3. Paste this whole script and press Enter.
   4. Watch the console output — it reports each finding imported, any
      that used a fallback default (worth a manual check), and a final
      summary. Safe to re-run: already-imported findings are skipped.

   Run this once per device/browser that has local findings — each one
   only sees its own localStorage.
   ===================================================================== */

(async function migrateLegacyFindings(){
  if (typeof state === "undefined" || typeof supabaseClient === "undefined") {
    console.error("This must be run inside the AuditQMS Pro Suite app page — 'state' or 'supabaseClient' not found.");
    return;
  }
  if (!supabaseClient.auth) {
    console.error("Supabase client not ready.");
    return;
  }
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) {
    console.error("Not signed in — sign in first, then re-run this script.");
    return;
  }

  const SEVERITY_MAP = { "Critical": "CRITICAL", "Major": "MAJOR", "Minor": "MINOR" };
  const STATUS_MAP    = { "Open": "DRAFT", "In Progress": "IN_REVIEW", "Closed": "CLOSED" };

  let imported = 0, skipped = 0, failed = 0, fallbacksUsed = [];

  const audits = state.audits || [];
  for (const audit of audits) {
    const findings = audit.findings || [];
    for (const f of findings) {
      const usedSeverityFallback = !SEVERITY_MAP[f.severity];
      const usedStatusFallback = !STATUS_MAP[f.status];
      const severity = SEVERITY_MAP[f.severity] || "MINOR";
      const status = STATUS_MAP[f.status] || "DRAFT";

      if (usedSeverityFallback || usedStatusFallback) {
        fallbacksUsed.push({
          findingId: f.id, desc: (f.desc||"").slice(0,60),
          rawSeverity: f.severity, rawStatus: f.status,
          mappedSeverity: severity, mappedStatus: status
        });
      }

      const { data, error } = await supabaseClient.rpc("import_legacy_finding", {
        p_finding_id: f.id,
        p_audit_id: audit.id,
        p_title: f.desc || "(untitled finding)",
        p_clause_reference: f.clauseRef || f.clause || "",
        p_severity: severity,
        p_status: status,
        p_is_ccp_breach: false,
        p_original_created_at: null // legacy findings didn't track a created_at; uses import time
      });

      if (error) {
        console.error(`FAILED — finding ${f.id} ("${(f.desc||"").slice(0,40)}"):`, error.message);
        failed++;
      } else {
        console.log(`imported: ${f.id} — "${(f.desc||"").slice(0,40)}" [${severity}/${status}]`);
        imported++;
      }
    }
  }

  console.log("\n===== Migration summary =====");
  console.log(`Imported: ${imported}`);
  console.log(`Failed:   ${failed}`);
  if (fallbacksUsed.length) {
    console.log(`\n${fallbacksUsed.length} finding(s) used a default fallback (unrecognized severity/status) — worth a manual check:`);
    console.table(fallbacksUsed);
  }
  console.log("\nDone. Re-running this script is safe — already-imported findings are skipped.");
})();

/* -----------------------------------------------------------------------
   AFTER MIGRATION IS DONE ON ALL DEVICES:
   Run this once in the Supabase SQL editor to close the import path back
   down, since import_legacy_finding deliberately bypasses the state
   machine and shouldn't stay callable indefinitely:

     REVOKE EXECUTE ON FUNCTION public.import_legacy_finding FROM authenticated;
   ----------------------------------------------------------------------- */
