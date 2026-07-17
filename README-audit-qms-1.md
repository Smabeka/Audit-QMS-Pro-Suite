# Audit Quality Management App

A single-page web app for running quality audits against standards like ISO 9001:2015, FSSC 22000, and HACCP — with checklist-based scoring, findings/NCR logging, and CAPA (Corrective and Preventive Action) tracking.

**[Live Demo](#)** ← replace with your GitHub Pages link once deployed

## Features

- **Dashboard** — compliance score average across all audits, open findings count, overdue CAPA alerts, and a priority findings feed
- **Audit Register** — build audits by standard, area, and auditor; organize checks into custom sections with Pass / Fail / N/A results and notes on failures
- **Automatic compliance scoring** — calculated live from checklist results
- **Findings & CAPA** — log non-conformances with severity (Minor / Major / Critical), assign an owner and due date, and track status through to closure
- **CAPA Tracker** — a filterable, sortable view of every corrective action across all audits, with overdue items flagged

## Why I built this

As a QA professional with hands-on experience across ISO 9001:2015, FSSC 22000, ISO 22000, HACCP, and BRCGS audits, I wanted a tool that reflected how audit programs actually run in food manufacturing: structured checklists, traceable findings, and CAPA accountability — not just a static form.

## Tech

Plain HTML, CSS, and vanilla JavaScript — no build step, no framework dependency. Data persists in the browser via `localStorage`. Fonts: Fraunces + Public Sans (Google Fonts).

## Running locally

Just open `index.html` in a browser. No install required.

## Deploying to GitHub Pages

1. Create a new repo (e.g. `audit-qms`)
2. Add this file as `index.html`
3. Settings → Pages → Deploy from branch → `main` / root
4. Your app will be live at `https://<username>.github.io/audit-qms/`
