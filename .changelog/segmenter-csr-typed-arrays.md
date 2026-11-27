---
bump: patch
---
Replace boxed pixel arrays in puzzle region segmentation with a flat typed-array CSR layout and zero-copy pixel views, reducing peak worker memory on high-resolution custom images while preserving bit-identical puzzle output
