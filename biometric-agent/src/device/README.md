# device

The `DeviceDriver` seam (`driver.ts`) and its two implementations:

- `zk/` — our own **read-only** implementation of the ZKTeco/eSSL protocol on
  port 4370 (TCP, UDP fallback). `protocol.ts` holds the framing, checksum,
  comm key, time and record decoding, checked against vectors produced by
  pyzk; `zkDriver.ts` sends only commands on `READ_ONLY_COMMANDS`. Neither
  `node-zklib` nor `zkteco-js` is used (no comm-key support; `zkteco-js` builds
  punch times in the PC's timezone). `zkteco-js` is a test-only dependency that
  must read our fake device correctly.
- `simulated.ts` — the punch simulator's driver (P2-G), refused for any device
  the server doesn't mark as simulated.
