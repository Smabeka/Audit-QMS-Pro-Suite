// audit-report-pdf.js
// Client-side PDF generation for the enterprise Audit Summary Report,
// matching your vanilla JS PWA pattern (no server round-trip). Uses
// jsPDF + jspdf-autotable, loaded via CDN in index.html.
//
// Reuses the SHA-256 integrity-hash pattern from your e-signature pad:
// the report's own content gets hashed so the printed "Cryptographic
// Hash" line is real, not decorative.

export const AuditReportPDF = (function () {
  const PAGE_MARGIN = 40;
  const COLORS = {
    navy: [28, 43, 74],       // matches your update-banner navy
    pass: [28, 122, 68],
    warn: [138, 109, 0],
    critical: [163, 38, 60],
    grey: [90, 90, 90],
    line: [220, 220, 220],
  };

  function statusColor(status) {
    if (status === 'PASS') return COLORS.pass;
    if (status === 'WARN') return COLORS.warn;
    return COLORS.critical;
  }

  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function drawSectionHeader(doc, y, title, pageWidth) {
    doc.setFillColor(...COLORS.navy);
    doc.rect(PAGE_MARGIN, y, pageWidth - PAGE_MARGIN * 2, 20, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(title, PAGE_MARGIN + 8, y + 14);
    doc.setTextColor(0, 0, 0);
    return y + 20;
  }

  function labelValue(doc, x, y, label, value) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.grey);
    doc.text(label, x, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    doc.text(String(value ?? '—'), x, y + 13);
  }

  /**
   * data shape:
   * {
   *   docId, standard, date, facility, leadAuditor, auditee, scopeStandard,
   *   overallCompliancePct, overallResult ('PASS'|'WARN'|'FAIL'),
   *   criticalCount, majorCount, minorCount,
   *   findings: [{ ccpId, title, severity, status, capaDue, findingText }],
   *   checklistSections: [{ name, pct, result }],
   *   auditorName, auditorSignedAt, auditeeName, auditeeSignedAt,
   *   companyLogoDataUrl (optional, base64 PNG/JPEG)
   * }
   */
  async function generate(data) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = PAGE_MARGIN;

    // ---------- Header ----------
    if (data.companyLogoDataUrl) {
      doc.addImage(data.companyLogoDataUrl, 'PNG', PAGE_MARGIN, y, 60, 30);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('AUDIT SUMMARY REPORT', PAGE_MARGIN + (data.companyLogoDataUrl ? 70 : 0), y + 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.grey);
    doc.text('AuditQMS Pro Suite', PAGE_MARGIN + (data.companyLogoDataUrl ? 70 : 0), y + 28);
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(9);
    doc.text(`Doc ID: ${data.docId}`, pageWidth - PAGE_MARGIN - 120, y + 14);
    doc.text(`Date: ${data.date}`, pageWidth - PAGE_MARGIN - 120, y + 28);
    y += 45;
    doc.setDrawColor(...COLORS.navy);
    doc.setLineWidth(1.5);
    doc.line(PAGE_MARGIN, y, pageWidth - PAGE_MARGIN, y);
    y += 20;

    // ---------- 1. Metadata & Scope ----------
    y = drawSectionHeader(doc, y, '1. AUDIT METADATA & SCOPE', pageWidth);
    y += 20;
    labelValue(doc, PAGE_MARGIN, y, 'Facility', data.facility);
    labelValue(doc, pageWidth / 2, y, 'Lead Auditor', data.leadAuditor);
    y += 25;
    labelValue(doc, PAGE_MARGIN, y, 'Standard', data.standard);
    labelValue(doc, pageWidth / 2, y, 'Auditee', data.auditee);
    y += 30;

    // ---------- 2. Executive Score & Risk Index ----------
    y = drawSectionHeader(doc, y, '2. EXECUTIVE SCORE & RISK INDEX', pageWidth);
    y += 22;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(...statusColor(data.overallResult));
    doc.text(`${data.overallCompliancePct}%  [${data.overallResult}]`, PAGE_MARGIN, y);
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Overall Compliance', PAGE_MARGIN, y + 12);
    labelValue(doc, PAGE_MARGIN + 180, y - 12, 'Critical Failures', data.criticalCount);
    labelValue(doc, PAGE_MARGIN + 320, y - 12, 'Major Non-Conformances', data.majorCount);
    labelValue(doc, PAGE_MARGIN + 180, y + 12, 'Minor Non-Conformances', data.minorCount);
    y += 35;

    // ---------- 3. Critical & Major Findings ----------
    y = drawSectionHeader(doc, y, '3. CRITICAL & MAJOR FINDINGS BREAKDOWN', pageWidth);
    y += 18;
    (data.findings || []).forEach((f) => {
      if (y > 720) {
        doc.addPage();
        y = PAGE_MARGIN;
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.text(`[${f.ccpId}] ${f.title}`, PAGE_MARGIN, y);
      y += 13;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...statusColor(f.severity === 'CRITICAL' ? 'FAIL' : f.severity));
      doc.text(`Severity: ${f.severity}`, PAGE_MARGIN + 10, y);
      doc.setTextColor(0, 0, 0);
      doc.text(`Status: ${f.status}`, PAGE_MARGIN + 130, y);
      doc.text(`CAPA Due: ${f.capaDue}`, PAGE_MARGIN + 230, y);
      y += 13;
      const findingLines = doc.splitTextToSize(`Finding: ${f.findingText}`, pageWidth - PAGE_MARGIN * 2 - 10);
      doc.text(findingLines, PAGE_MARGIN + 10, y);
      y += findingLines.length * 11 + 10;
      doc.setDrawColor(...COLORS.line);
      doc.line(PAGE_MARGIN, y, pageWidth - PAGE_MARGIN, y);
      y += 12;
    });

    // ---------- 4. Checklist Audit Results ----------
    if (y > 650) {
      doc.addPage();
      y = PAGE_MARGIN;
    }
    y = drawSectionHeader(doc, y, '4. CHECKLIST AUDIT RESULTS', pageWidth);
    y += 15;
    doc.autoTable({
      startY: y,
      margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
      head: [['Section', 'Score', 'Result']],
      body: (data.checklistSections || []).map((s) => [s.name, `${s.pct}%`, s.result]),
      styles: { fontSize: 8.5, cellPadding: 5 },
      headStyles: { fillColor: COLORS.navy, textColor: 255 },
      didParseCell: (hookData) => {
        if (hookData.section === 'body' && hookData.column.index === 2) {
          hookData.cell.styles.textColor = statusColor(hookData.cell.raw);
          hookData.cell.styles.fontStyle = 'bold';
        }
      },
    });
    y = doc.lastAutoTable.finalY + 25;

    // ---------- 5. Digital Sign-off & Verification Log ----------
    if (y > 680) {
      doc.addPage();
      y = PAGE_MARGIN;
    }
    y = drawSectionHeader(doc, y, '5. DIGITAL SIGN-OFF & VERIFICATION LOG', pageWidth);
    y += 20;
    labelValue(doc, PAGE_MARGIN, y, 'Auditor Signature', '[Signed Digitally]');
    labelValue(doc, pageWidth / 2, y, 'Timestamp', data.auditorSignedAt);
    y += 25;
    labelValue(doc, PAGE_MARGIN, y, 'Auditee Signature', '[Signed Digitally]');

    // Hash the report's own textual content so this line is a real
    // integrity check, not a placeholder — same principle as your
    // e-signature pad's SHA-256 hashing.
    const reportFingerprint = JSON.stringify({
      docId: data.docId,
      date: data.date,
      overallCompliancePct: data.overallCompliancePct,
      findings: (data.findings || []).map((f) => f.ccpId),
      auditorSignedAt: data.auditorSignedAt,
      auditeeSignedAt: data.auditeeSignedAt,
    });
    const hash = await sha256Hex(reportFingerprint);
    labelValue(doc, pageWidth / 2, y, 'Cryptographic Hash', hash.slice(0, 16) + '…');
    y += 20;
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.grey);
    doc.text(`Full hash (SHA-256): ${hash}`, PAGE_MARGIN, y);

    return doc;
  }

  async function generateAndDownload(data) {
    const doc = await generate(data);
    doc.save(`${data.docId || 'audit-report'}.pdf`);
  }

  return { generate, generateAndDownload };
})();
