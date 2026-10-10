# secrets

Where the agent key and each device's comm key come from. Never `config.json`.
Linux (development, CI): `WELLSURE_AGENT_KEY`, `WELLSURE_COMMKEY_<SERIAL>`.
Windows: Credential Manager under the service's own account (P2-F commit F2).
