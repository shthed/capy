# Security Policy

**Related Guides**: [`README.md`](./README.md) | [`CONTRIBUTING.md`](./CONTRIBUTING.md) | [`SUPPORT.md`](./SUPPORT.md) | [`CLOUD.md`](./CLOUD.md)

---

## Supported Versions

Security fixes are applied to the latest production release:

- **Production (`main` / [capypaint.com](https://capypaint.com/) / [paint.capyboop.com](https://paint.capyboop.com/))**: Supported
- **Older Releases (prior Git tags)**: Not supported

---

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub Issues or Pull Requests.

Instead, report vulnerabilities privately using either of these channels:

- **GitHub Private Vulnerability Reporting**: [Open a Private Security Advisory](https://github.com/shthed/capy/security/advisories/new)
- **Private Email**: [capyboop@gmail.com](mailto:capyboop@gmail.com)

Please include:

- A clear description of the vulnerability and potential impact.
- Steps to reproduce or a minimal proof of concept.
- Affected component (`web/` client, `worker/` Co-op Durable Object, or `app/` Android launcher).

We will acknowledge receipt, investigate, and coordinate a fix before public disclosure.

---

## Security Architecture Notes

- **Local-First Processing**: All image segmentation and coloring run locally in a Web Worker; photos are not uploaded to backend servers.
- **Cloud Sync**: Optional Bring-Your-Own-Cloud (BYOC) sync (Google Drive, Microsoft OneDrive, Apple CloudKit, and Android Play Games Services; feature-gated off by default) stores only the player's own encrypted-in-transit `.capy` save payloads.
- **Co-op Relay & Feedback (`worker/`)**: Opt-in room state uses ephemeral `4`--`8`-character room codes in Cloudflare Durable Objects with origin validation, and anonymous in-game feedback uses a rate-limited `/api/feedback` relay in `worker/`.
