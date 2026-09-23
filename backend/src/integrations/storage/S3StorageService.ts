import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../config/env";
import type { StorageService } from "./StorageService";

// The AWS implementation — selected by STORAGE_DRIVER=s3 (staging/production
// only; local dev uses LocalStorageService). Credentials and region come
// from the standard AWS SDK chain (an ECS task's IAM role in staging/prod).
export class S3StorageService implements StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    if (!env.S3_BUCKET) {
      throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3");
    }
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({ region: env.AWS_REGION });
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async getObjectSignedUrl(key: string, expiresInSeconds = 900): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
