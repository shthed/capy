---
bump: patch
---
Reduce idle memory and background activity by lazily allocating optional puzzle canvas buffers, terminating idle generation workers, and pausing background animation and local co-op heartbeat loops when tabs are hidden
