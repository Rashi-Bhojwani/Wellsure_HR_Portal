# config

`config.json` on the office PC: the API URL, the poll interval (30 s), and
each device's serial, LAN address, port (4370) and transport. **No secrets**:
the agent key and comm keys come from `secrets/`. Validated with Zod; HTTPS is
required except for localhost.
