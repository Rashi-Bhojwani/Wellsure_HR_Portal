import { env } from "../config/env";

// The Phase 1.5 go-live gate for ADMS push (docs/DEPLOYMENT.md "Phase 1.5 go-live checklist", item 1;
// docs/plans/PHASE_2.md "P2-J", C). An ADMS device proves who it is by its serial number alone (the protocol
// has no shared secret), and raw punches cannot be deleted, so anyone who learns a serial could post punches
// as that device. In production the whole push path is therefore off until someone has restricted /iclock to
// the office's address and set ADMS_PUSH_ENABLED=true. Only development defaults to on: staging holds real data on the internet,
// so it is off there too until someone turns it on deliberately (the infrastructure half, in the CDK app, refuses to open the listener otherwise).
// An object so a test can switch it.
export function admsPushEnabledFor(appEnv: string, explicit: string | undefined): boolean {
  return explicit !== undefined ? explicit === "true" : appEnv === "development";
}

export const admsGate = {
  enabled: (): boolean => admsPushEnabledFor(env.APP_ENV, env.ADMS_PUSH_ENABLED),
};

export const ADMS_PUSH_DISABLED_MESSAGE =
  "ADMS push is switched off outside development until /iclock is restricted to the office's address (docs/DEPLOYMENT.md, Phase 1.5 go-live checklist). Use the sync agent route.";
