# Security Policy

## Reporting a vulnerability

Do not open a public issue containing FlowAccount credentials, authentication
tokens, company data, tax IDs, attachments, or other accounting records.

Report security concerns privately to the repository maintainer through
GitHub's private vulnerability reporting feature when it is enabled.

## Credential handling

This project stores FlowAccount session data locally. The default token file is
`~/.flowaccount-mcp/tokens.json`; it must never be committed or shared.

Use a dedicated Windows Generic Credential named `FlowAccountMCP` only if you
want background reauthentication. Never export or commit Windows Credential
Manager data.

Always verify the company returned by `get_active_company` before performing a
write operation.
