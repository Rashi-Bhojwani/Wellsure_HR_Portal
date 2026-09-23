# storage

`StorageService` interface (`putObject`/`getObjectSignedUrl`/`deleteObject`)
selected by `STORAGE_DRIVER` (`storage/index.ts`):

- **`local`** (default, dev) — `LocalStorageService` writes objects under
  `STORAGE_LOCAL_DIR` (default `.storage/`, gitignored) with a sidecar
  `<key>.meta.json` for content type. Signed URLs are simulated: an HMAC
  over `key:expiry`, verified by the `/dev/storage` route
  (`devRoute.ts`) mounted in `../../app.ts`.
- **`s3`** (staging/production) — `S3StorageService`, real presigned URLs
  via `@aws-sdk/s3-request-presigner`.

Used for documents, photos, letters and exports starting Phase 1.
