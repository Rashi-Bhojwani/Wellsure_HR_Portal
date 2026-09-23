import { env } from "../../config/env";
import { LocalStorageService } from "./LocalStorageService";
import { S3StorageService } from "./S3StorageService";
import type { StorageService } from "./StorageService";

export type { StorageService } from "./StorageService";
export { devStorageRouter } from "./devRoute";

function createStorageService(): StorageService {
  switch (env.STORAGE_DRIVER) {
    case "local":
      return new LocalStorageService();
    case "s3":
      return new S3StorageService();
  }
}

export const storageService: StorageService = createStorageService();
