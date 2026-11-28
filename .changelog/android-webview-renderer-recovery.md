---
bump: patch
---
Recover gracefully from Android WebView renderer crashes or low-memory terminations by recreating the WebView cleanly (with a 2-per-minute loop guard and Tap to reload fallback) instead of closing the app
