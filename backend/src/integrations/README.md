# integrations

Outbound integrations behind interfaces so implementations can swap between
local dev services and AWS: `mail/` (MailService — console + `.eml` files
locally, SES in AWS) and `storage/` (StorageService — local filesystem
locally, S3 in AWS). See spec §15.3.
