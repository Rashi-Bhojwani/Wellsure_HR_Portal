export interface StorageService {
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  getObjectSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  deleteObject(key: string): Promise<void>;
}
