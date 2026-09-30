import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../config/env";
import { attachmentContentDisposition, type SignedUrlOptions, type StorageService } from "./StorageService";

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

  async getObject(key: string): Promise<{ body: Buffer; contentType: string }> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new Error(`S3 object has no body: ${key}`);
    return { body: Buffer.from(await result.Body.transformToByteArray()), contentType: result.ContentType ?? "application/octet-stream" };
  }

  async getObjectSignedUrl(key: string, expiresInSeconds = 900, options: SignedUrlOptions = {}): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(options.downloadFileName && { ResponseContentDisposition: attachmentContentDisposition(options.downloadFileName) }),
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
