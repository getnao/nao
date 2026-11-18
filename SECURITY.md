# Security Policy

## Reporting a vulnerability

Please do not report security vulnerabilities through public GitHub issues, discussions or pull requests.

Email **christophe@getnao.io** with:

- a description of the issue and its impact
- steps to reproduce, or a proof of concept
- the affected version (`nao-core` version, Docker image tag or commit)

+We acknowledge reports within 3 business days and keep you informed as we work on a fix. Please give us 90 days from acknowledgment to ship a fix before disclosing the issue publicly.

## Scope

nao is self-hosted. In scope are vulnerabilities in the code of this repository: the backend (`apps/backend`), the frontend (`apps/frontend`), the Python CLI and FastAPI sidecar (`cli`), the Docker image and the Helm chart.

Out of scope:

- issues that require an already-compromised administrator account or host
- vulnerabilities in third-party dependencies that nao does not misuse (report them upstream)
- misconfiguration of a specific deployment, such as weak secrets or exposed warehouses
- wrong or misleading answers from the agent that do not cross a security boundary

## Supported versions

Security fixes are released on the latest version of `nao-core` and the latest Docker image tag. Please upgrade to the latest release before reporting.
