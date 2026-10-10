// zkteco-js ships no types. It is a TEST-ONLY dependency here: the reference
// client that must read our fake device correctly (D-F1). The agent never
// uses it.
declare module "zkteco-js" {
  export default class Zkteco {
    constructor(ip: string, port: number, timeout: number, inport: number, maxChunk?: number);
    createSocket(cbErr?: (e: Error) => void, cbClose?: () => void): Promise<boolean>;
    getInfo(): Promise<{ userCounts: number; logCounts: number; logCapacity: number }>;
    getAttendances(): Promise<{ data: Array<{ sn: number; user_id: string; record_time: string; type: number; state: number }> }>;
    getTime(): Promise<Date>;
    disconnect(): Promise<unknown>;
  }
}
