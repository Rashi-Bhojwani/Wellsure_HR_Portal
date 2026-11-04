# parity

A-9: the functions the Employee and Admin areas still lacked (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md). Each file extends an existing module through its
own service functions instead of writing that module's tables directly, so the record stays consistent:

* `segments.ts` — saved employee filters and named groups (segments). Resolved inside the viewer's own data scope, always.
* `contact.ts` — the audited reveal of a contact number (masked to the last 4 in the grid, the export and the profile).
* `pay.ts` — the profile's Pay tab: directors only, every opening audited.
* `gridColumns.ts` — the columns a person chose on a grid.

Every router here refuses the Developer role (`middleware/refuseDeveloper.ts`).
