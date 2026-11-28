---
bump: patch
---
Prevent premature PWA update reloads by waiting up to 5 seconds for the waiting service worker to clear before fallback reloading, with a 10-second hard cap
