# Exits (checkpoint C)

Resignations link one-to-one to the existing separation writer; this module does
not replace account deactivation or implement any pay calculation. Required
business choices are append-only director settings and start **Not set**. HR's
`MANAGE_EXITS` capability is off until explicitly switched on. Office management
also needs its capability and the exit audience choice. Managers read current
team resignations and need an explicit grant to accept them.

Interview access always follows the employee/interviewer relationship, plus
audited director access. It does not follow team, Office membership or an HR
permission. Answers use the shared encryption/key rotation registry. Retention
is chosen before answering and enforced on reads and the daily worker. Only
user rooms receive interview updates; empty access refreshes discard former
participants' cached screens. Notification and audit queries apply the same
current audience before pagination or counts. No interview Tasks source exists.

Clearance snapshots a director's template and creates required items for active
asset assignments. The gate rechecks **all** live assignments. A reasoned director
override covers the recorded blockers only; a new assignment reopens clearance.
The approved last working day still ends access while clearance remains open.

`settlement.ts` exports the read-only `ExitSettlementInputs` projection and the
internal `onSettlementCompleted(exitCaseId)` hook. Neither is wired to payroll.
The recovery-intent ID array is empty because that model is not built. Letter
requests notify directors and never issue letters.

Development DEMO data is guarded by `demo.company`; it chooses labelled example
settings, makes DEMO009 a manager, accepts DEMO006's resignation and appoints
DEMO004 interviewer. General HR management remains off. Regular seeds choose no
exit settings, and the four prepared leave types remain inactive.
