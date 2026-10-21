# Laravel integration (jewelpilot)

Jewelpilot reads and writes all images and files through one class,
`App\Helpers\UploadHelper`. That class now has a third driver, `cloud`, next to `local` and
`s3`. None of the ~80 places that call it changed, and the database keeps storing only file
names, exactly as before.

## Files added or changed in jewelpilot

| File | Change |
|---|---|
| `app/Helpers/UploadHelper.php` | `cloud` branch in every method; driver chosen by `UPLOAD_STORAGE` |
| `app/Services/CloudStorage/CloudStorageClient.php` | new: small Guzzle client (PUT/GET/HEAD/DELETE by path, public URLs) |
| `config/cloudstorage.php` | new: settings |
| `.env.example` | new variables |

## Switch it on

In jewelpilot's `.env`:

```env
UPLOAD_STORAGE=cloud
CLOUD_STORAGE_URL=https://storage.example.com
CLOUD_STORAGE_API_KEY=cs_live_xxxxxxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
CLOUD_STORAGE_PUBLIC_URL=https://storage.example.com/p/jewelpilot/website
```

Then run `php artisan config:clear` (or `config:cache` in production).

To roll back, set `UPLOAD_STORAGE=s3` (or `local`); nothing else changes.

## What each helper call does now

| UploadHelper | Cloud storage |
|---|---|
| `uploadSingle`, `uploadMultiple`, `updateFile` | `PUT /objects?path=jewel-pilot/{folder}/{name}` (JPEG) |
| `uploadRawFile` (CAD etc.) | `PUT /objects`, streamed from the temp file |
| `processBannerImage` | two PUTs: original + WebP (same as S3) |
| `createWebpFromExisting` | `GET` original → encode → `PUT` WebP |
| `getImageUrl`, `getMultipleImageUrls` | builds the permanent public URL locally (no request); existence is checked once and cached for the placeholder fallback |
| `getFileUrl` | public URL, no request |
| `imageExists` | `HEAD /objects` (cached) |
| `getImageDataUri` (mPDF) | `GET /objects` |
| `deleteSingle`, `deleteMultiple`, `deleteBannerImages` | `DELETE /objects` (to the server's trash, unless `CLOUD_STORAGE_PERMANENT_DELETE=true`) |

## Speed notes

- Page renders make **no storage calls** for image URLs once the existence cache is warm.
  The URL is computed locally. With `CLOUD_STORAGE_CHECK_EXISTS=false` there is no call even
  on the first render (missing images then show as broken instead of the placeholder).
- The existence cache uses Laravel's cache store. Redis or file is much faster than the
  `database` store.
- Thumbnails: append `?v=thumb` (300×300), `?v=small`, `?v=medium` or `?v=large` to any image
  URL to get a resized WebP. For example,
  `CloudStorageClient::instance()->url($path, 'thumb')` is a good fit for product grids.
- Uploads in one request reuse a single keep-alive connection.

## Moving existing images

Copy the current `jewel-pilot/…` tree from S3 or `public/` to the storage server and run the
`import` CLI command ([deployment.md §5](deployment.md#5-migrating-existing-files)). Paths
are preserved, so every file name already saved in jewelpilot's tables resolves to the same
image.
