# Security Policy

**Related Guides**: [`README.md`](./README.md) | [`CONTRIBUTING.md`](./CONTRIBUTING.md) | [`SUPPORT.md`](./SUPPORT.md) | [`CLOUD.md`](./CLOUD.md)

---

## Supported Versions

Security fixes are applied to the latest production release:

- **Production (`main` / [`https://capypaint.com/`](https://capypaint.com/))**: Supported
- **Older Releases (prior Git tags)**: Not supported

---

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub Issues or Pull Requests.

Instead, report vulnerabilities privately using **GitHub Private Vulnerability Reporting**:

- [Open a Private Security Advisory](https://github.com/shthed/capy/security/advisories/new)

Please include:

- A clear description of the vulnerability and potential impact.
- Steps to reproduce or a minimal proof of concept.
- Affected component (`web/` client, `worker/` Co-op Durable Object, or `app/` Android launcher).

We will acknowledge receipt, investigate, and coordinate a fix before public disclosure.

---

## Security Architecture Notes

- **Local-First Processing**: All image segmentation and coloring run locally in a Web Worker; photos are not uploaded to backend servers.
- **Cloud Sync**: Optional Google Drive `appDataFolder` OAuth and Android Play Games Services sync store only your own encrypted-in-transit `.capy` save payloads.
- **Co-op Relay (`worker/`)**: Room state uses ephemeral 6-character room codes in Cloudflare Durable Objects with origin validation.
