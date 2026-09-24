# local-agent

A local, offline-capable automation tool that drafts content with a local AI
runtime and then sends it using your own persisted credentials:

- Read persisted logins from Opera GX's local profile
- Send email via Gmail SMTP
- Draft and publish Instagram updates via the supported Graph API path

This is a credential delegation tool, not a browser robot. The AI layer
drafts text; the action layer sends it using credentials you control.

## What you need before this runs

1. A local AI backend reachable from this machine (for example a local
   OpenAI-compatible server). The tool is written to call one hosted locally.
2. Gmail sending credentials (SMTP host/port, email, app password or real
   password depending on your setup).
3. For Instagram posting: a Facebook/Instagram app, the right publishing
   scopes, and a user token. Without that, the Instagram path will refuse to
   run and tell you exactly what is missing.
4. Decide how you want this tool to get context. By default it reads from a
   local journal file you maintain; you can later point it at Gmail or another
   source.

## Security posture

- Secrets are read from environment or an optional config file, not pasted into
  prompts.
- The AI layer and the send layer are separate modules.
- Every send action is logged to a local log file with a timestamp and what was
  sent, so you can audit what the tool did on your behalf.
