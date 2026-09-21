# integrations

Outbound integrations behind interfaces so implementations can swap between
local dev services and AWS: `mail/` (MailService — Mailpit locally, SES in
AWS) and `storage/` (StorageService — MinIO locally, S3 in AWS).
See spec §15.3.
