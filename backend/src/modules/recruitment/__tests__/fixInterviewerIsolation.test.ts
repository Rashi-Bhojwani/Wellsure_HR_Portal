import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture } from "./fixtures";

// Independent audit 2026-11-20, "What I could not check": interviewer panel isolation with real interviews (the seed had none; only "not on the panel -> 404"
// was checked). Two interviews with two different panels: each interviewer sees only their own panel's interview, candidate and feedback, never the other's.
describe("interviewer-panel isolation: an interviewer sees only their own panel's candidates and feedback", () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  const ids = { a: { candidate: "", interview: "" }, b: { candidate: "", interview: "" } };

  beforeAll(async () => {
    f = await fixture();
    await f.setting("sources", [{ code: "DEMO", label: "DEMO source" }]);
    await f.setting("retention", { days: 30 });
    await f.setting("scorecard", { questions: [{ id: "DEMO_QUESTION", label: "DEMO chosen question", required: true }], recommendations: [{ code: "DEMO_PROGRESS", label: "DEMO progress" }, { code: "DEMO_STOP", label: "DEMO stop" }] });
    await f.grant("manager", "recruitment.requisition.raise");
    const req = await f.call("manager", "post", "/requisitions", { title: "DEMO isolation role", departmentId: f.org.departmentId, locationId: f.org.locationId, employmentType: "PERMANENT", headcount: 2, reason: "DEMO" });
    await f.call("manager", "post", `/requisitions/${req.body.id}/submit`);
    const p = await f.call("director", "post", "/pipelines", { name: "DEMO isolation", stages: [{ code: "DEMO", label: "DEMO applied" }], reason: "DEMO" });
    const j = await f.call("director", "post", "/jobs", { title: "DEMO isolation role", departmentId: f.org.departmentId, locationId: f.org.locationId, employmentType: "PERMANENT", description: "DEMO", pipelineId: p.body.id, requisitionId: req.body.id });
    expect((await f.call("director", "post", `/jobs/${j.body.id}/state`, { status: "OPEN", reason: "DEMO" })).status).toBeLessThan(300);
    for (const [key, panel, name] of [["a", f.people.interviewer, "DEMO CANDIDATE A"], ["b", f.people.office, "DEMO CANDIDATE B"]] as const) {
      const c = await f.call("director", "post", "/candidates", { name, email: `demo.isolation.${randomUUID()}@example.invalid`, phone: null, source: "DEMO", consentConfirmed: true, consentRecordedAt: new Date().toISOString() });
      ids[key].candidate = c.body.id;
      const a = await f.call("director", "post", `/candidates/${c.body.id}/applications`, { jobId: j.body.id });
      const i = await f.call("director", "post", `/applications/${a.body.id}/interviews`, { round: `DEMO round ${key}`, scheduledAt: "2098-04-01T10:00:00+05:30", panelEmployeeIds: [panel.employeeId], reason: "DEMO panel" });
      expect(i.status, JSON.stringify(i.body)).toBe(201);
      ids[key].interview = i.body.id;
    }
    expect((await f.call("interviewer", "post", `/interviews/${ids.a.interview}/feedback`, { answers: { DEMO_QUESTION: "DEMO_FEEDBACK_A" }, recommendation: "DEMO_PROGRESS" })).status).toBe(201);
    expect((await f.call("office", "post", `/interviews/${ids.b.interview}/feedback`, { answers: { DEMO_QUESTION: "DEMO_FEEDBACK_B" }, recommendation: "DEMO_STOP" })).status).toBe(201);
  });
  afterAll(async () => {
    await f.cleanup();
  });

  for (const [who, own, other, ownMarker, otherMarker] of [["interviewer", "a", "b", "DEMO_FEEDBACK_A", "DEMO_FEEDBACK_B"], ["office", "b", "a", "DEMO_FEEDBACK_B", "DEMO_FEEDBACK_A"]] as const) {
    it(`${who}: lists only their own panel's interview, opens its candidate and feedback, and gets 404 on the other panel's interview, feedback and candidate`, async () => {
      const list = await f.call(who, "get", "/interviews");
      expect(list.status).toBe(200);
      const listed = JSON.stringify(list.body);
      expect(listed).toContain(ids[own].interview);
      expect(listed).not.toContain(ids[other].interview);
      expect(listed).not.toContain(own === "a" ? "DEMO CANDIDATE B" : "DEMO CANDIDATE A");
      const mine = await f.call(who, "get", `/interviews/${ids[own].interview}`);
      expect(mine.status).toBe(200);
      const myFeedback = await f.call(who, "get", `/interviews/${ids[own].interview}/feedback`);
      expect(myFeedback.status).toBe(200);
      expect(JSON.stringify(myFeedback.body)).toContain(ownMarker);
      expect(JSON.stringify(myFeedback.body)).not.toContain(otherMarker);
      expect((await f.call(who, "get", `/interviews/${ids[other].interview}`)).status).toBe(404);
      expect((await f.call(who, "get", `/interviews/${ids[other].interview}/feedback`)).status).toBe(404);
      expect([403, 404]).toContain((await f.call(who, "get", `/candidates/${ids[other].candidate}`)).status);
      expect((await f.call(who, "post", `/interviews/${ids[other].interview}/feedback`, { answers: { DEMO_QUESTION: "intrude" }, recommendation: "DEMO_STOP" })).status).toBe(404);
    });
  }

  it("a director reads both panels' feedback; HR, a manager and the Developer read neither", async () => {
    for (const k of ["a", "b"] as const) expect((await f.call("director", "get", `/interviews/${ids[k].interview}/feedback`)).status).toBe(200);
    for (const who of ["hr", "manager", "developer"] as const) for (const k of ["a", "b"] as const) expect([403, 404]).toContain((await f.call(who, "get", `/interviews/${ids[k].interview}/feedback`)).status);
  });
});
