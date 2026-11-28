---
bump: patch
---
Enforce the 8 KB body size cap while streaming /api/feedback requests so oversized payloads without Content-Length abort early with HTTP 413
