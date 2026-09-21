// Placeholder entrypoint — the real Express/Socket.IO/BullMQ bootstrap (and
// the api|worker|scheduler|migrate entrypoint modes) land in Phase 0.
// Imports from shared/ to prove the @shared/* path alias resolves
// correctly, both via `tsx` (dev/Docker) and via `tsc` (typecheck).
import { SHARED_PLACEHOLDER } from "@shared/index";

void SHARED_PLACEHOLDER;
