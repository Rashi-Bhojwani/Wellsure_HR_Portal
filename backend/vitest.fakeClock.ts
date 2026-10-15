// Runs the whole suite as if the wall clock read a chosen instant (TEST_FAKE_NOW, an ISO instant), so a test that quietly
// depends on the hour, the day, the month or the year it happens to run in fails here on purpose, rather than at 00:10 IST
// in CI. The clock keeps running from that instant (it is an offset, not a freeze), so timeouts and ordering still work.
// Without TEST_FAKE_NOW this file does nothing. See `npm run test:clock`.
const at = process.env.TEST_FAKE_NOW;
if (at) {
  const target = Date.parse(at);
  if (Number.isNaN(target)) throw new Error(`TEST_FAKE_NOW="${at}" is not an ISO instant.`);
  const RealDate = Date;
  const offset = target - RealDate.now();
  class OffsetDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...(args as [number]));
    }
    static override now(): number {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = OffsetDate as unknown as DateConstructor;
}
