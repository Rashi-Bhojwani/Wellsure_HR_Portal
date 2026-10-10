# api

`client.ts`: the HTTPS client for `POST /api/biometric/agent/punches` and
`POST /api/biometric/agent/heartbeat`, with the agent key as a Bearer token.
The request and reply shapes are `shared/attendance/agentProtocol.ts`, the
same file the backend validates against. It never throws for an HTTP status:
the sync code decides what a 401, 403 or 5xx means.
