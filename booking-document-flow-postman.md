# Booking Document Flow Postman Details

Base URL: `http://localhost:5000`

Authentication: both endpoints require a learner/user JWT.

Header:

```http
Authorization: Bearer {{userToken}}
```

## 1. Get Documents Screen

```http
GET {{baseUrl}}/api/bookings/{{bookingId}}/flow/documents
```

Use this first. It returns the current document step, resolved checklist variant, required documents, uploaded state, upload action, and whether Continue should be enabled.

Important response paths:

```json
{
  "data": {
    "screen": {
      "checklistVariant": "am2",
      "requirements": [],
      "completion": {
        "uploadedCount": 0,
        "totalRequired": 1,
        "percentage": 0
      },
      "actions": {
        "continue": {
          "enabled": false,
          "apiUrl": "/api/bookings/:id/flow/checklist"
        }
      }
    }
  }
}
```

## 2. Upload Document

```http
POST {{baseUrl}}/api/bookings/{{bookingId}}/flow/documents/upload
```

Body type: `form-data`

Do not manually add a `Content-Type` header. Postman will add the correct multipart boundary.

Fields:

| Key | Type | Required | Notes |
| --- | --- | --- | --- |
| `file` | File | Yes | You can also use `document`, `upload`, `certificate`, or `supportingDocument`. |
| `documentType` | Text | Yes for multi-document flows | Use one of the IDs returned by the documents screen. |
| `documentLabel` | Text | No | Defaults to the requirement title. |

Accepted file types: `pdf`, `jpg`, `jpeg`, `png`, `webp`

Maximum size: `10MB`

## Document Type Values

AM2:

```text
full_certificate
```

AM2E:

```text
experienced-worker-qualification-certificate
walled-garden-report
skills-scan-pre-september-2023
```

AM2E V1:

```text
experienced-worker-qualification-certificate
walled-garden-report
skills-scan-pre-september-2023
level-2-or-level-3-technical-certificate
```

Re-uploading the same `documentType` replaces the old file for that requirement.

## Common Errors

`400 A document file is required`: no file was attached.

`400 documentType is required`: the booking has multiple required documents and no `documentType` was sent.

`400 Invalid documentType`: the value does not match this booking variant.

`400 Only PDF, JPG, PNG, and WEBP uploads are allowed`: unsupported file type.

`400 Document size must be 10MB or smaller`: file is too large.
