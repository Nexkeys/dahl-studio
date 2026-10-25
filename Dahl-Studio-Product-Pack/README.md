# Dahl Studio — Local-First Windows Coding Workspace

This is the initial product-reference pack for Dahl Studio. It captures the requested product direction and preserves the current generated design references so they can be used during implementation.

## Product definition

Dahl Studio is an online-connected, local-first Windows desktop coding workspace powered by Dahl's API. It can use the internet for model requests, GitHub, user-authorized third-party integrations, MCP tools, and web research, but Dahl Studio does not operate a hosted backend or maintain a database. Project source files and Dahl Studio's persistent workspace state remain on the user's PC.

## Contents

- `docs/PRODUCT_SPEC.md` — product scope and functional requirements.
- `docs/ARCHITECTURE_AND_SECURITY.md` — proposed local-only architecture, key handling, permissions, and integration boundaries.
- `docs/IMPLEMENTATION_AND_TEST_PLAN.md` — staged build sequence and acceptance gates.
- `references/design/` — generated icon and UI design references from this conversation.

## API documentation status

The Dahl API documentation was not present among the files currently available to inspect when this pack was created. The model/API adapter must be built against the actual Dahl documentation; endpoint names, model IDs, authentication headers, usage fields, and thinking-mode parameters must not be guessed. Add the official docs under `references/api/` when available.

## Important delivery note

The target is an installable Windows application (`.exe` installer and/or MSIX), not an Android APK. A distributable installer should only be produced after tests and a clean-install verification pass.
