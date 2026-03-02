# Splunk Cyber Defense Triage App (SHC Bundle Ready)

This repository contains a starter Splunk app designed for cyber defense analysts to triage and prioritize alerts.

## App location

The app is scaffolded under:

`etc/shcluster/apps/soc_triage_app`

This matches Search Head Cluster (SHC) deployer bundle layout.

## Included in this starter

- App metadata and launcher config (`default/app.conf`)
- KV Store collections for triage state and audit (`default/collections.conf`)
- KV Store lookup definitions for triage overlays (`default/transforms.conf`)
- Alert normalization macro with ES notable primary and lookup fallback (`default/macros.conf`)
- Saved searches for key triage queues (`default/savedsearches.conf`)
- Dashboard and navigation (`default/data/ui/views/triage_dashboard.xml`, `default/data/ui/nav/default.xml`)
- ACL defaults (`metadata/default.meta`)
- Seed lookup data for immediate dashboard rendering (`lookups/soc_triage_seed_alerts.csv`)

## Data source strategy (recommended)

- Primary source: Enterprise Security notables (`index=notable`)
- Fallback source: `lookups/soc_triage_seed_alerts.csv`
- Shared schema is provided by macro `soc_alerts_normalized` so all dashboards/searches use one data contract.
- Analyst triage state is overlaid from KV Store (`soc_alert_triage`) by `alert_id`.

If ES notables are available, they are prioritized. Seed records remain as backup/demo records.

## ESCU mapping notes

- `alert_id` prioritizes ESCU-friendly identifiers (`orig_sid`, then notable/event/rule IDs, then deterministic hash).
- ESCU status values are normalized (`new`, `in_progress`, `closed`) for consistent triage logic.
- KV Store triage values override base telemetry values for: `status`, `owner`, `severity`, `risk_score`, `sla_due`, and `notes`.
- Keep ESCU content unchanged; put workflow customizations in this app layer.

## SHC deployment flow

From your deployer host:

1. Copy `soc_triage_app` into:
   - `$SPLUNK_HOME/etc/shcluster/apps/`
2. Validate config:
   - `$SPLUNK_HOME/bin/splunk btool check --debug`
3. Apply the SHC bundle:
   - `$SPLUNK_HOME/bin/splunk apply shcluster-bundle -target https://<captain>:8089 -auth <user>:<pass>`
4. In Splunk Web, verify app visibility and open **Cyber Defense Triage** dashboard.

## Next hardening steps

- Add role-based filtering and per-team routing for notables (e.g., by domain/business unit).
- Add custom commands or workflow actions to update KV Store triage status from dashboard actions.
- Restrict write access in `metadata/default.meta` to your SOC lead roles.
- Add CI checks with Splunk AppInspect before production deployment.
