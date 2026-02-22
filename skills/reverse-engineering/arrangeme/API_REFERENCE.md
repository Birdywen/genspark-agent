# ArrangeMe API Reference (Complete)

## Authentication
- **Method**: HttpOnly session cookie (set by browser login)
- **Cookie lifetime**: Closing browser does NOT invalidate session
- **Sign Out DOES invalidate session** (JSESSIONID becomes useless)
- **Session expiry signal**: API returns HTML page instead of JSON

## AWS S3 Upload Config
- **Region**: `us-west-2`
- **Cognito Identity Pool ID**: `us-west-2:a0ce8d26-2469-4be3-ab21-aa5342357f62`
- **S3 Bucket**: `arrangeme-uploads`
- **S3 Key Format**: `files/{randomString}_{normalizedFilename}`
- **Auth**: CognitoIdentityCredentials (unauthenticated)

## Base URL: `https://www.arrangeme.com`

---

## DATA ENDPOINTS

### Sales Data
- **POST** `/account/dashboardSales.action`
- **Content-Type**: `application/x-www-form-urlencoded`
- **Params**: `returnJson=true` (REQUIRED), `sortColumnIndex`, `sortDirection`, `start`, `length`, `search`
- **Response**: `{recordsTotal, recordsFiltered, data: [{date, sellerTitleId, title, format, assetType, saleChannels, countryName, quantity, salesAmount, commissionAmount}]}`
- **Stats**: 6362 records, 2022-02-27 to present

### Titles Management
- **POST** `/account/dashboardTitles.action`
- Same params as Sales
- **Response**: `{data: [{ame_id, type, title, format, price, status, published_to, added}]}`
- **Stats**: 8522 titles

### CSV Downloads (GET)
- `/account/download/sales/csv` — All sales
- `/account/download/payment/{paymentId}/csv` — Per payment

---

## UPLOAD FLOW (4-Step Wizard)

### Upload URLs by Type
- `/sell/original/sheet/upload` — Original PDF
- `/sell/publicdomain/sheet/upload` — Public domain PDF
- `/sell/copyrighted/search` — Copyrighted arrangement
- `/sell/medley/new` — Medley/mashup
- `/sell/original/audio/upload` — Original MP3
- `/sell/publicdomain/audio/upload` — Public domain MP3

### Step 1: Upload Music
- **Form**: `#uploadFilesForm` POST to `/sell/{type}/sheet/upload`
- **Process**: Files → S3 direct upload → S3 keys as hidden fields → form submit
- **Fields**:
  - `sellerTitleId` (hidden, 0=new)
  - `uploadedPdfS3Key` (hidden, injected after S3 upload)
  - `uploadedMp3S3Key` (hidden, optional)
  - `uploadedPreviewMp3S3Key` (hidden, optional)
  - `uploadedCoverImageS3Key` (hidden, optional)
  - `howModified` (select: Change in arrangement/difficulty/style/Other)
  - `howModifiedDesc` (textarea)
  - `reUpload` (hidden, false)
  - `generatePreviewMp3Status` (hidden, "new")

### Step 2: Title Details
- **POST** `/title/edit/details`
- **Fields**:
  - `sellerTitleId` (hidden)
  - `title.contentTitle` (text) — Display title
  - `title.contributors.artists` (text)
  - `title.contributors.composers` (text)
  - `title.contributors.arrangers` (text)
  - `title.description` (textarea)
  - `title.externalLink.linkUrl` (text) — External link

### Step 3: Arrangement Details
- **POST** `/title/edit/arrangement`
- **Fields**:
  - `sellerTitleId` (hidden)
  - `title.arrangement.groupId` (select) — Arrangement group
  - `title.arrangement.typeId` (loaded via AJAX based on groupId)
  - `title.difficultyLevel` (select: 1-5)
  - `priceStr` (text) — Price with minimum per type
  - `instrumentIds` (multi-select, for applicable types)

### Step 4: Genre
- **POST** `/title/edit/genres`
- **Fields**:
  - `sellerTitleId` (hidden)
  - `title.genreIds` (multi-select)

---

## ARRANGEMENT GROUPS

### GET `/sell/arrangementTypeGroups.action?arrangementGroupId={id}`

| Group ID | Name |
|----------|------|
| 1 | Piano/Keyboard & Voice |
| 2 | Tablature |
| 3 | Lead Sheet |
| 4 | Instrumental Solo |
| 5 | Instrumental Duet |
| 6 | Ensemble: Choral |
| 7 | Ensemble: Band |
| 8 | Ensemble: Orchestra |
| 9 | Ensemble: Other |
| 12 | Ensemble: Score Only |
| 18 | Educational Materials |

### Group 1 Types (Piano/Keyboard)
| Type ID | Name | Min Price |
|---------|------|-----------|
| 1 | Piano/Vocal/Guitar | $5.99 |
| 2 | Easy Piano | $4.99 |
| 3 | Piano Solo | $5.99 |
| 4 | Piano & Vocal | $5.99 |
| 5 | Piano Duet (1 Piano, 4 Hands) | $5.99 |
| 6 | Piano Duet (2 Pianos, 4 Hands) | $5.99 |
| 7 | Vocal Solo | $4.99 |
| 8 | Vocal Duet | $5.99 |
| 17 | Vocal Duet and Piano | $5.99 |
| 18 | Accordion | $4.99 |
| 22 | Harpsichord | $5.99 |
| 23 | Organ | $5.99 |
| 34 | Guitar and Piano | $5.99 |
| 167 | Piano (1 Piano, 6 Hands) | $5.99 |
| 168 | Piano (2 Pianos, 8 Hands) | $5.99 |
| 188 | Organ and Piano | $5.99 |
| 194 | DecPlay Piano | $3.99 |

### Difficulty Levels
| Value | Label |
|-------|-------|
| 1 | Beginner |
| 2 | Easy |
| 3 | Intermediate |
| 4 | Advanced |
| 5 | Expert |

---

## GENRE IDS (Partial)
| ID | Name |
|----|------|
| 2 | Baroque |
| 7 | Classical |
| 38 | 19th Century |
| 1 | 20th Century |
| 61 | 21st Century |
| 13 | Folk |
| 3 | Blues |
| 8 | Contemporary |
| 6 | Christmas |
| 12 | Film/TV |
| 10 | Country |
| 46 | Chamber |

---

## BULK MANAGEMENT

### Bulk Select
- **POST** `/title/bulk/selectAll.action`
- Params: `selectAllPDFs`, `selectAllMP3s`

### Bulk View/Save
- **GET** `/title/bulk/viewArrangementGroups.action`
- **POST** `/title/bulk/saveArrangementGroups.action`
- **GET** `/title/bulk/viewDifficultyLevels.action`
- **POST** `/title/bulk/saveDifficultyLevels.action`
- **GET** `/title/bulk/viewArrangementPrices.action`
- **POST** `/title/bulk/saveArrangementPrices.action`
- **GET** `/title/bulk/viewGenres.action`
- **POST** `/title/bulk/saveGenres.action`

---

## PUBLISH / UNPUBLISH

### New upload lifecycle
- Completing all 4 steps of the upload wizard creates the title in **Draft** status
- Must explicitly call **GET `/title/publish/{sellerTitleId}`** to initiate publishing
- Status flow: **Draft → Processing → Published - Active**
- Processing may take hours (backend review, PDF validation, distribution to sales channels)
- No need to wait for Processing to complete before uploading next title

### Bulk publish
- Add hidden field `publish=true` to bulk save POST requests
- Example: POST `/title/bulk/saveArrangementGroups.action` with form data including `publish=true`
- Without `publish=true`, changes are saved as draft only

### Publish (individual)
- **GET** `/title/publish/{sellerTitleId}` — triggers publishing pipeline
- Returns title detail page with status "Processing"

### Unpublish
- **GET** `/title/unpublish/{sellerTitleId}`

### Delete
- **GET** `/title/delete/{sellerTitleId}`

---

## TITLE EDIT (Individual)
- **GET/POST** `/title/edit/upload/{sellerTitleId}` — Re-upload files
- **GET/POST** `/title/edit/details/{sellerTitleId}` — Edit title details
- **GET/POST** `/title/edit/arrangement/{sellerTitleId}` — Edit arrangement
- **GET/POST** `/title/edit/genres/{sellerTitleId}` — Edit genres
- **GET** `/title/edit/deletePreviewMp3.action?sellerTitleId={id}`
- **GET** `/title/edit/deleteCoverImage.action?sellerTitleId={id}`
- **GET** `/title/unpublish/{sellerTitleId}`

---

## NOTES
- All JSON response data fields contain HTML markup — strip tags for clean data
- S3 upload uses Cognito unauthenticated identity (no user creds needed for S3)
- Session cookie handles all server-side authentication
- arrangement typeId is loaded dynamically via `/sell/arrangementTypeGroups.action` after selecting groupId
- Some arrangement types require instrument selection (Vocal Solo, Vocal Duet, etc.)
