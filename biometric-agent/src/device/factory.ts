import type { DeviceConfig } from "../config/schema";
import type { DeviceDriver } from "./driver";
import { JsonFileSimulatedSource, SimulatedDriver } from "./simulated";
import { Zk4370Driver } from "./zk/zkDriver";

/** The driver config.json names for a device. */
export function createDriver(device: DeviceConfig, commKey: number | null, timeoutSeconds = 10): DeviceDriver {
  if (device.driver === "simulated") {
    if (!device.simulatedStateFile) throw new Error(`Device ${device.serial}: the simulated driver needs "simulatedStateFile".`);
    return new SimulatedDriver(new JsonFileSimulatedSource(device.simulatedStateFile));
  }
  return new Zk4370Driver({ host: device.host, port: device.port, transport: device.transport, commKey, timeoutMs: timeoutSeconds * 1000 });
}
