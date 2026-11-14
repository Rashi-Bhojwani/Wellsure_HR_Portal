# Session A part 4 — remaining statutory mechanisms (single state), realtime fix (2026-11-14)

Scope (owner decisions): one company, three branches, one city, one state, one run by the two directors. Payroll per company stays as it is (not extended).
Defaults rule: every statutory figure Not set until a director enters it with a source note and a different director confirms; a feature that depends on one refuses or
has no effect, and says what is missing.

## Rows re-opened, and what each needed
| Row | State before | Now |
|---|---|---|
| PF (wage ceiling, employee and employer rates, ceiling mode) | governed rules `PF_*` (Not set, effective-dated versions, second director) | already complete — verified, no change |
| ESI (ceiling, rates, coverage period, types covered) | rules `ESI_*` | already complete — verified |
| ST-07 PT | rules `PT_SLABS` (by state), `STATE_NAME_MAP`, `PT_STATE_OF_PLACEMENT` | complete for one state: the directors enter one state's slab table and map the branches' state text to it; nothing multi-state is added |
| ST-09 LWF | rule `LWF_TABLE` | complete for one state, as PT |
| Income tax, old and new regime | tax years (both regimes, slabs, standard deduction, rebate, surcharge, cess, sections), TDS_MODE | already complete — verified |
| ST-15 HRA exemption | missing | **built**: an optional, owner-entered part of the tax year (rent section, HRA heads, basis heads, the three percentages, metro or not), old regime only; projected like taxable pay in the run and in the statement |
| ST-18 marginal relief | missing | **built for the rebate** (owner switch in the tax year); surcharge marginal relief deferred (incomes above the surcharge threshold) |
| PY-27 gratuity | manual line | **built**: effective-dated setting (least years, part-year rule, wage heads, days per year, divisor, ceiling or none, rounding), two directors; a settlement line when in force |
| PY-28 notice pay | manual line | **built** (recovery of a shortfall): effective-dated setting (notice days, recover or not, basis heads, divisor, rounding); notice runs from the day the separation was recorded |
| PY-29 / LV-14 leave encashment at exit and its formula | part 3 A3 | already complete |
| ST-02 PF ECR, ST-05 ESI upload | owner-typed layouts (`PF_ECR`, `ESI`) | mechanism complete; the official format is the owners' |
| PY-23 payslip layout | rule `PAYSLIP_LAYOUT` (blocks) | mechanism complete; a sample layout is the owners' |
| PY-43 employer PF/ESI inside CTC | waiting | **deferred, with a risk found** (see below) |
| PY-30 statutory bonus | missing | deferred: an annual payment, not part of a monthly run |
| LC-16 flexible benefit plan, LC-15 travel advance | missing | deferred: not needed for monthly payroll |
| LC-13 manager step on claims | missing | deferred: a workflow choice, not needed for payroll correctness |
| ST-16 LTA, ST-17 perquisites | missing | deferred by the owners |
| ST-19 Form 12BB, ST-22 quarterly return file | missing | deferred: not needed for monthly payroll, the Form 16 draft or challans (the format is the owners') |

**PY-43 risk:** a structure line of type EMPLOYER_CONTRIBUTION is paid by the run as an employer line in addition to the statutory PF/ESI employer lines, so adding an
"employer PF" line to a structure's CTC today would count it twice. A correct "inside CTC" setting must reduce the balance line when salaries are written (and ESI on
gross makes it circular); it needs the owners' decision on how CTC is built.

## Realtime fix
A lost permission now takes effect on this server's sockets at once (local, synchronous leave) before the notice and any later event; the cluster-wide leave still follows
for other servers. Other api servers still apply the leave one Redis round trip later (documented; signal-only events, no pay data on permission rooms HR can hold).
