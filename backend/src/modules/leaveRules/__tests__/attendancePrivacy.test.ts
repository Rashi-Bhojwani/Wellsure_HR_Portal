import request from 'supertest';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setBusinessTodayForTests } from '../../../lib/businessDate';
import { prisma } from '../../../lib/prisma';
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, cleanupTestRole, createEmployeeTestOrgMasters, createFullTestEmployee, grantPermissions, loginAs, type TestOrgMasters } from '../../employee/__tests__/employeeTestHelpers';
import { computeAttendance } from '../../attendance/compute';
import { clearPeepsSettings, setSetting } from '../../peeps/__tests__/peepsTestKit';
import { attendanceBoardDisplay, attendanceDayDisplay, attendanceMonthDisplay, attendanceMusterDisplay } from '../attendancePrivacy';

const TODAY = '2026-09-30';
const date = new Date(`${TODAY}T00:00:00Z`);
const ROLE = 'TEST_ATTENDANCE_PRIVACY';
type Person = { employeeId: string; employeeCode: string; userId: string };
type Who = 'manager' | 'scoped' | 'medical' | 'menstrual' | 'outsider' | 'employee' | 'hrAdmin' | 'hrExec' | 'director' | 'director2' | 'developer';

describe('attendance leave privacy (C-1)', () => {
  let org: TestOrgMasters;
  const p = {} as Record<Who, Person>;
  const tokens = {} as Record<Who, string>;
  const get = (who: Who, path: string) => request(app).get(`/api/attendance${path}`).set(...authHeader(tokens[who]));
  const viewer = (who: Who, roleCodes: string[]) => ({ employeeId: p[who].employeeId, roleCodes });
  const day = (code: string) => ({ date: TODAY, employed: true, status: code, code, firstHalfStatus: code, secondHalfStatus: code, leaveTypeCode: code, leaveReleased: [{ type: code, days: 1 }] });

  beforeAll(async () => {
    setBusinessTodayForTests(date);
    org = await createEmployeeTestOrgMasters();
    p.manager = await createFullTestEmployee(org, { roleCode: 'MANAGER' });
    p.scoped = await createFullTestEmployee(org, { roleCode: ROLE });
    await prisma.role.update({ where: { code: ROLE }, data: { dataScope: 'TEAM' } });
    await grantPermissions(ROLE, ['attendance.view']);
    for (const who of ['medical', 'menstrual'] as const) p[who] = await createFullTestEmployee(org, { managerId: p.scoped.employeeId });
    for (const who of ['outsider', 'employee'] as const) p[who] = await createFullTestEmployee(org);
    for (const [who, roleCode] of [['hrAdmin', 'HR_ADMIN'], ['hrExec', 'HR_EXECUTIVE'], ['director', 'SUPER_ADMIN'], ['director2', 'SUPER_ADMIN'], ['developer', 'DEVELOPER']] as const) p[who] = await createFullTestEmployee(org, { roleCode });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { key: 'attendance.manual.enter' } });
    await prisma.userPermissionOverride.create({ data: { userId: p.manager.userId, permissionId: permission.id, effect: 'GRANT', reason: 'DEMO privacy test: branch marker', createdByUserId: p.director.userId } });
    await prisma.attendanceManualBranch.create({ data: { userId: p.manager.userId, locationId: org.locationId, assignedByUserId: p.director.userId } });
    await prisma.deviceUserMapping.deleteMany({ where: { employeeId: { in: [p.medical.employeeId, p.menstrual.employeeId] } } });
    for (const who of Object.keys(p) as Who[]) tokens[who] = await loginAs(p[who].employeeCode);
    await computeAttendance([p.medical.employeeId, p.menstrual.employeeId], '2026-09-01', TODAY);
    // Stored-day fixtures exercise presentation without approving rules or activating a leave type.
    for (const [who, code] of [['medical', 'MEDICAL'], ['menstrual', 'MENSTRUAL']] as const) {
      await prisma.dailyAttendance.update({ where: { employeeId_date: { employeeId: p[who].employeeId, date } }, data: { status: code, firstHalfStatus: code, secondHalfStatus: code, source: 'LEAVE', leaveTypeCode: code, lopDays: '0' } });
    }
    // A released medical day must not disclose its old type in the corrected-days export.
    const releasedDate = new Date('2026-09-29T00:00:00Z');
    const medical = await prisma.leaveType.findUniqueOrThrow({ where: { code: 'MEDICAL' } });
    const leave = await prisma.leaveRequest.create({ data: { employeeId: p.medical.employeeId, leaveTypeId: medical.id, fromDate: releasedDate, toDate: releasedDate, totalDays: '1', status: 'APPROVED', appliedByUserId: p.medical.userId } });
    const override = await prisma.attendanceOverride.create({ data: { employeeId: p.medical.employeeId, date: releasedDate, origin: 'MANUAL_OVERRIDE', kind: 'RELEASE_ONLY', reason: 'DEMO worked on leave', createdByUserId: p.director.userId } });
    await prisma.leaveDayRelease.create({ data: { employeeId: p.medical.employeeId, date: releasedDate, leaveRequestId: leave.id, leaveTypeId: medical.id, dayPart: 'FULL', days: '1', overrideId: override.id, reason: 'DEMO worked on leave', createdByUserId: p.director.userId } });
    await prisma.dailyAttendance.update({ where: { employeeId_date: { employeeId: p.medical.employeeId, date: releasedDate } }, data: { status: 'P', firstHalfStatus: 'P', secondHalfStatus: 'P', source: 'OVERRIDE', leaveTypeCode: null, overrideKind: 'MANUAL_OVERRIDE', overrideRef: override.id } });
  });

  afterAll(async () => {
    setBusinessTodayForTests(null);
    await clearPeepsSettings();
    for (const person of Object.values(p)) await cleanupFullTestEmployee(person.employeeId);
    await cleanupTestRole(ROLE);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it.each(['MEDICAL', 'MENSTRUAL'])('manager sees Leave for %s on Who’s In, muster and day panel using the leave-module rule', async (code) => {
    const manager = viewer('manager', ['MANAGER']);
    const subject = p.medical.employeeId;
    expect(await attendanceDayDisplay(day(code), manager, subject)).toMatchObject({ status: 'Leave', code: 'Leave', firstHalfStatus: 'Leave', secondHalfStatus: 'Leave', leaveTypeCode: 'Leave', leaveReleased: [{ type: 'Leave', days: 1 }] });
    const board = await attendanceBoardDisplay({ away: [{ employeeId: subject, why: `On leave (${code})` }], arrived: [{ employeeId: subject, halfDayLeave: code }], manual: [{ employeeId: subject, status: `${code}:P` }] }, manager);
    expect(board.away[0]!.why).toBe('On leave (Leave)');
    expect(board.arrived[0]!.halfDayLeave).toBe('Leave');
    expect(board.manual[0]!.status).toBe('Leave:P');
    const muster = await attendanceMusterDisplay({ rows: [{ employeeId: subject, cells: [{ date: TODAY, code, status: code, reason: `On approved leave (${code}).` }], totals: { leave: 1, paidDays: 1 } }] }, manager);
    expect(muster.rows[0]!.cells[0]).toMatchObject({ date: TODAY, code: 'Leave', status: 'Leave', reason: 'On approved leave (Leave).' });
    expect(muster.rows[0]!.totals).toEqual({ leave: 1, paidDays: 1 });
    const month = await attendanceMonthDisplay({ days: [day(`${code}:P`)] }, manager, subject);
    expect(month.days[0]!.code).toBe('Leave:P');
  });

  it.each(['HR_ADMIN', 'HR_EXECUTIVE', 'SUPER_ADMIN'])('%s sees the original type on all three displays', async (roleCode) => {
    const hr = viewer('hrAdmin', [roleCode]);
    for (const code of ['MEDICAL', 'MENSTRUAL']) {
      expect(await attendanceDayDisplay(day(code), hr, p.medical.employeeId)).toEqual(day(code));
      const board = { away: [{ employeeId: p.medical.employeeId, why: `On leave (${code})` }], arrived: [{ employeeId: p.medical.employeeId, halfDayLeave: code }], manual: [] };
      expect(await attendanceBoardDisplay(board, hr)).toEqual(board);
      const muster = { rows: [{ employeeId: p.medical.employeeId, cells: [{ code, status: code, reason: `On approved leave (${code}).` }] }] };
      expect(await attendanceMusterDisplay(muster, hr)).toEqual(muster);
    }
  });

  it('HTTP: masks the board, month and day for a permitted TEAM viewer and the muster for a manager branch marker', async () => {
    // MANAGER cannot receive attendance.view today: keep that ceiling intact.
    expect((await get('manager', '/who-is-in')).status).toBe(403);
    expect((await get('manager', `/employees/${p.medical.employeeId}/day/${TODAY}`)).status).toBe(403);
    const board = await get('scoped', `/who-is-in?locationId=${org.locationId}`);
    expect(board.status).toBe(200);
    expect(board.body.away).toHaveLength(2);
    expect(board.body.away.every((r: { why: string }) => r.why === 'On leave (Leave)')).toBe(true);
    for (const who of ['medical', 'menstrual'] as const) {
      const result = await get('scoped', `/employees/${p[who].employeeId}/day/${TODAY}`);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ date: TODAY, code: 'Leave', leaveTypeCode: 'Leave', firstHalfStatus: 'Leave', secondHalfStatus: 'Leave' });
      const month = await get('scoped', `/employees/${p[who].employeeId}/month?month=2026-09`);
      expect(month.status).toBe(200);
      expect(month.body.days.find((d: { date: string }) => d.date === TODAY)).toMatchObject({ code: 'Leave', status: 'Leave' });
      const muster = await get('manager', `/muster?cycleStart=2026-09-01&employeeId=${p[who].employeeId}`);
      expect(muster.status).toBe(200);
      expect(muster.body.rows[0].cells.find((d: { date: string }) => d.date === TODAY)).toMatchObject({ code: 'Leave', status: 'Leave' });
      for (const body of [board.body, result.body, month.body, muster.body]) expect(JSON.stringify(body)).not.toMatch(/MEDICAL|MENSTRUAL/);
    }
  });

  it.each(['hrAdmin', 'hrExec', 'director'] as const)('HTTP: %s sees each type in the board, muster and day panel', async (who) => {
    const board = await get(who, `/who-is-in?locationId=${org.locationId}`);
    expect(board.status).toBe(200);
    for (const [subject, code] of [['medical', 'MEDICAL'], ['menstrual', 'MENSTRUAL']] as const) {
      expect(board.body.away.find((r: { employeeId: string }) => r.employeeId === p[subject].employeeId).why).toBe(`On leave (${code})`);
      const result = await get(who, `/employees/${p[subject].employeeId}/day/${TODAY}`);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ code, leaveTypeCode: code });
      const muster = await get(who, `/muster?cycleStart=2026-09-01&employeeId=${p[subject].employeeId}`);
      expect(muster.status).toBe(200);
      expect(muster.body.rows[0].cells.find((d: { date: string }) => d.date === TODAY).code).toBe(code);
    }
  });

  it('muster export uses the same labels; employee, outside-team and Developer access stays as before', async () => {
    const exported = await get('manager', `/muster/export?cycleStart=2026-09-01&employeeId=${p.medical.employeeId}`).buffer(true).parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
      res.on('error', callback);
    });
    expect(exported.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.body);
    expect(JSON.stringify(workbook.model)).toContain('Leave');
    expect(workbook.getWorksheet('Corrected days')!.rowCount).toBeGreaterThan(1);
    expect(JSON.stringify(workbook.model)).not.toMatch(/MEDICAL|MENSTRUAL/);
    const releasedDay = await get('scoped', `/employees/${p.medical.employeeId}/day/2026-09-29`);
    expect(releasedDay.status).toBe(200);
    expect(releasedDay.body.leaveReleased).toMatchObject([{ type: 'Leave', days: 1 }]);
    for (const path of ['/who-is-in', '/muster?cycleStart=2026-09-01', `/employees/${p.medical.employeeId}/day/${TODAY}`]) expect((await get('employee', path)).status, path).toBe(403);
    expect((await get('scoped', `/employees/${p.outsider.employeeId}/day/${TODAY}`)).status).toBe(404);
    // Existing attendance.view for the Developer is outside this edit's authority;
    // sensitive type labels are masked in its response, too.
    const developer = await get('developer', `/employees/${p.medical.employeeId}/day/${TODAY}`);
    expect(developer.status).toBe(200);
    expect(developer.body.leaveTypeCode).toBe('Leave');
    const own = await get('medical', `/me/day/${TODAY}`);
    expect(own.status).toBe(200);
    expect(own.body.leaveTypeCode).toBe('MEDICAL');
  });

  it('only a confirmed director setting reveals types; existing leave types and stored attendance stay unchanged', async () => {
    expect((await prisma.leaveType.findMany({ where: { code: { in: ['MEDICAL', 'MENSTRUAL', 'WEDDING', 'BEREAVEMENT'] } } })).every((t) => !t.isActive)).toBe(true);
    const manager = viewer('manager', ['MANAGER']);
    expect(await attendanceDayDisplay(day('PL:P'), manager, p.medical.employeeId)).toEqual(day('PL:P'));
    await setSetting('leave.showSensitiveTypes', { show: true }, p.director, p.director2);
    const board = await get('scoped', `/who-is-in?locationId=${org.locationId}`);
    expect(board.status).toBe(200);
    expect(board.body.away.map((r: { why: string }) => r.why).sort()).toEqual(['On leave (MEDICAL)', 'On leave (MENSTRUAL)']);
    const managerMuster = await get('manager', `/muster?cycleStart=2026-09-01&employeeId=${p.medical.employeeId}`);
    expect(managerMuster.body.rows[0].cells.find((d: { date: string }) => d.date === TODAY).code).toBe('MEDICAL');
    const result = await get('scoped', `/employees/${p.medical.employeeId}/day/${TODAY}`);
    expect(result.body.leaveTypeCode).toBe('MEDICAL');
    expect(await prisma.dailyAttendance.findUniqueOrThrow({ where: { employeeId_date: { employeeId: p.medical.employeeId, date } } })).toMatchObject({ status: 'MEDICAL', leaveTypeCode: 'MEDICAL' });
  });
});
