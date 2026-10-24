# Security Policy

## Supported versions

Only the latest release is supported. Fixes are not backported: they ship in the next release, and in the `edge` image as soon as they reach `main`.

## Logging in

After a few failed logins for the same username from the same address, further attempts are refused for a while, longer with every failure. How the address is told apart behind a reverse proxy is described in [Accounts](docs/self-hosting.md#accounts).

## Reporting a vulnerability

Please do not open a public issue for security problems.

Report them privately through GitHub: [Report a vulnerability](https://github.com/mperezfo/Gamelog/security/advisories/new).

Include a description of the issue, the steps to reproduce it and, if you can, its potential impact. You can expect an initial response within a few days. Once the issue is confirmed and fixed, it will be disclosed in a security advisory.
