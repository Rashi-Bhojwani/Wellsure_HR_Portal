// PEEPS-BEGIN exits
/** Read-only facts for the future settlement adapter. No amounts or pay fields.
 * Leave balances follow the existing ledger across years, as of the agreed day.
 */
export interface ExitSettlementInputs {
  readonly exitCaseId:string;
  readonly employee:{readonly id:string;readonly employeeCode:string};
  readonly lastWorkingDay:string;
  readonly leaveBalanceDays:ReadonlyArray<{readonly leaveTypeId:string;readonly days:string}>;
  readonly noticeShortfallDays:number|null;
  readonly noticeRuleState:"CONFIRMED"|"NOT_SET";
  readonly clearanceComplete:boolean;
  readonly clearanceOverrideReason:string|null;
  readonly openAssetRecoveryIntentIds:readonly string[];
}
// PEEPS-END exits
