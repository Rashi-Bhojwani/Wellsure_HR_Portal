# Standard statutory defaults pack: plan (Session A, 2026-11-16)

Owner decision (2026-11-16): statutory and tax rules ship with standard, sourced values already selected and **in force**, so payroll can run before the directors
enter figures. This **replaces** the Stage 3.2 rule that tax and statutory values stay Not set. Company facts (PAN, TAN, PF and ESI codes, bank layout columns,
salary structures, opening balances) and company choices (pay days basis, payment date, line rounding, PF ceiling mode, who is covered, the ESI period rule, TDS
on or off) stay owner-entered.

State: **Rajasthan** (one company, one city, one state). The values, their sources and check dates: `docs/STATUTORY_DEFAULTS.md`, generated from
`shared/constants/statutoryDefaults.ts` (the single source the code reads).

## 1. Where each value lives

| Group | Store | How the pack fills it |
|---|---|---|
| PF rates, ceiling (dated), EDLI, admin, rounding; ESI rates, ceiling, rounding | payroll rules (`RuleContext`) | `PACK_RULES`, a dated series per STATUTORY-origin rule key |
| Professional tax, LWF | payroll rules `PT_SLABS`, `LWF_TABLE` | by the company's state (`statutory.state`, default RAJASTHAN): Rajasthan = "Not levied" (nothing computed, the run says so with the source); any other state with no director table = refused, "Values for this state have not been loaded" |
| Minimum wages | minimum wages check (ST-29) | the pack's Rajasthan rates are shown and used where no director rate exists (UNVERIFIED; the check never changes pay) |
| Income tax 2026-27 | tax years (`TAX_YEAR`) | `PACK_TAX_YEARS["2026-27"]`, used where no director-confirmed version exists |
| Gratuity, notice recovery, leave encashment | behaviour settings | defaults (gratuity statutory; notice and encashment policy defaults), labelled "Standard default, change in settings" |
| State, review interval, CTC includes employer PF/ESI (PY-43) | behaviour settings | defaults RAJASTHAN, 6 months, included |

## 2. Rules for using a pack value

1. **Never overwrite.** A rule, tax year or setting a director has entered uses the director's value exactly as before (a Placeholder until a different director
   confirms it). Only where nobody has entered anything is the pack's entry used, the one in force on the month's last day. Once a director enters a value, runs
   calculated on the pack value become stale and are recalculated. (Decided 2026-11-16 while building: an earlier draft ignored a director's unconfirmed edit for a
   covered rule; that replaced an entered value with the standard one, which the owners' "never overwrite a value a director has entered" rules out.)
2. **Effective dating.** The pack entry in force on the cycle's last day applies to the whole month (the existing payroll rule). PF ceiling: 15,000 for months
   ending before 17 Sep 2026, 25,000 from the month that contains it. A run is calculated with the cycle's dates; other readers use today.
3. **In force, not a Placeholder.** A pack value is pinned as kind `PACK` (key, pack version, entry date, value hash) and counts as confirmed, so standard values never
   make a run a TEST run. The TEST watermark/refusal stays for company-specific rules with no default, and for a director's own value until it is confirmed.
4. **Review needed.** UNVERIFIED values are still used; each is flagged on the Rules screen and listed on Ready for First Run.
5. **Changing a value** is the existing edit + second-director confirmation, audited.

## 3. Acknowledgement and review

- Table `statutory_pack_reviews` (a_ migration): one append-only row per director action — `ACKNOWLEDGED` (the one-time "I have reviewed the standard values")
  or `REVIEWED` (later reviews), with the pack version. Audited.
- Ready for First Run: a non-blocking row "Using standard statutory values, last reviewed on <date>"; a row for the acknowledgement (both directors); the review-needed
  list.
- **Refusal:** a run that used any pack value cannot be made real (submit/approve/finalise/publish/bank file, the existing `assertRunIsReal`) until two different
  directors have acknowledged. The demo company is exempt.
- **Reminder:** review is due when the last review (or the pack's check date) is older than `statutory.reviewIntervalMonths` (default 6) or a pack value's effective
  date has passed since the last review. Shown on Ready for First Run and on the Rules screen, and a notice to the directors once per cause (daily scheduler).

## 4. PY-43 (employer PF and ESI inside CTC)

- Setting `payroll.ctcIncludesEmployerStatutory`, default **true** (CTC = gross + employer PF + employer ESI), changed by a director with a second director's
  confirmation.
- A salary component may say it **stands for** the statutory employer PF or ESI (`standsFor: PF_EMPLOYER | ESI_EMPLOYER`). Such a line reserves room in CTC only:
  **a run never pays or costs it** (the statutory engine's exact employer figure is the one used), so it cannot be counted twice. When the setting is false, a
  structure may not count such a line toward CTC.

## 5. Returns

- PF ECR: EPFO's ECR 2.0 layout is publicly documented (text file, `#~#` separator, 11 fields in order: UAN, member name, gross, EPF, EPS, EDLI wages, EE share,
  EPS contribution, ER share, NCP days, refund of advances). It is offered as the default PF_ECR layout, labelled "check against the portal before uploading".
- ESI monthly contribution upload: **not publicly documented** (only the portal's own template). Nothing built; an item for the owners to try on the real portal.

## 6. Tests

Golden per group against an independent reference written in the test from the sourced rules, across boundaries (below / at / above each ceiling, slab edge and
rebate limit) and across 17 Sep 2026; existing goldens kept (any changed only because a default is now in force is updated deliberately and recorded in
CHANGED_TESTS); mutation checks on effective dating, no-overwrite, the acknowledgement refusal and the double-pay guard; permission and Developer-403 tests on every
changed route; migrations on a fresh database; browser walk of the changed screens (5 roles, desktop light and 390 dark, keyboard).

## 7. Not built (named)

- ESI daily-wage exemption (Rs 176), ESI for persons with disability (Rs 25,000), PF admin minimum per establishment, fixed-term gratuity after one year,
  old-regime surcharge 37% and surcharge marginal relief: noted on the values; not modelled.
- ESI upload file (format not published).
