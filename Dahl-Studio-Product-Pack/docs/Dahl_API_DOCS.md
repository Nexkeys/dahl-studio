Docs
OpenAI-compatible inference

Getting started

Introduction
Quickstart
Account

Authentication
Tokens & keys
Reference

Models
API
Tools

OpenCode
VS Code
Hermes Agent
Quickstart
API key and first chat completion in a few minutes.
Authentication
Fingerprint, session cookie, and Bearer API keys.
Tokens & keys
Token pool, allocation, and top-ups.
Models
Live IDs, context, and tools.
OpenCode
Provider config, key, common errors.
VS Code
Cline, Roo Code, Kilo Code, Continue.
Hermes Agent
Custom endpoint, config, context.
How it works
Get a key — create an account.
Allocate tokens to the key — account keys start empty; allocate tokens from the pool.
List models — GET /v1/models (no key).
Call the API — POST /v1/chat/completions with Authorization: Bearer.
The default model in examples is MiniMax M2.7 (MiniMaxAI/MiniMax-M2.7). Always pick IDs from GET /v1/models — they change as models are added or rotated.

Also on the site
Try chat — same API in the browser
Model status — catalog, context, live uptime
Account — keys, pool, usage, top up



Go back
First request

Quickstart
One completion. Confirm the key, the model, and the base URL

Getting started

Introduction
Quickstart
Account

Authentication
Tokens & keys
Reference

Models
API
Tools

OpenCode
VS Code
Hermes Agent
Send a single POST /v1/chat/completions request to verify your key and a live model.

Base URL: https://inference.dahl.global/v1
A Bearer API key with tokens on it
A current model ID from GET /v1/models
Tip

Treat the key like a password. If you create an account, also save the fingerprint — it cannot be recovered.

Step 1 — Get a key with tokens
Open inference.dahl.global → Create account. Save the fingerprint.

The welcome grant is 100 million tokens in the pool. The first key starts at 0.

In /account → API keys, Allocate tokens from the pool to the key, then copy the key.

Export the key:


export DAHL_API_KEY="dahl_…"
Step 2 — List models
GET /v1/models is public — no API key. Pick an id from data. For most tasks start with MiniMax M2.7: MiniMaxAI/MiniMax-M2.7.


curl https://inference.dahl.global/v1/models
Step 3 — First request

curl https://inference.dahl.global/v1/chat/completions \
  -H "Authorization: Bearer $DAHL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MiniMaxAI/MiniMax-M2.7",
    "messages": [
      { "role": "user", "content": "Hello, Dahl!" }
    ]
  }'
Expected result
200 OK. Assistant text is in choices[0].message.content.


{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "..."
      }
    }
  ]
}
Common first failures
Response	Usually means	Check
401 Missing API token	No Authorization header	Add Authorization: Bearer
401 invalid / expired	Wrong or revoked key	New key at /account
402 exhausted	Nothing allocated on the key	Allocate from the pool or top up
400	This model is not currently offered	Use a live id from the error or GET /v1/models
503 / timeouts	Network overload	Short backoff and retry





Go back
Auth keys

Authentication
Fingerprint to sign in. Bearer key to call the API

Getting started

Introduction
Quickstart
Account

Authentication
Tokens & keys
Reference

Models
API
Tools

OpenCode
VS Code
Hermes Agent
Inference uses a Bearer API key. The account session (cookie) is only for the account UI at /account — it does not authorize /v1/chat/completions.

Create an account
Open inference.dahl.global → Create account, or go to /account.

Username: 3–20 characters, letters, digits, underscore.

Save the fingerprint shown once — it is the password. We store a hash; fingerprints cannot be recovered.

A first API key is issued immediately. It starts at 0 tokens. Allocate from the pool before calling the API.

Warning

If you lose the fingerprint, create a new account. There is no email recovery by design.

Sign in
Signing in requires only the fingerprint (not the username). Session cookies last 30 days.


curl -X POST https://inference.dahl.global/v1/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"fingerprint":"your-32-char-fingerprint"}' \
  -c cookies.txt
Signup via API

curl -X POST https://inference.dahl.global/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"username":"swift_eagle_449"}'

{
  "user": { "user_id": "…", "username": "swift_eagle_449", "created_at": "…" },
  "fingerprint": "a1b2c3d4e5f6…",
  "api_key": {
    "id": 123,
    "token": "dahl_…",
    "available_tokens": 0
  }
}
Check a username first: GET /v1/auth/check-username?username=….

Note

available_tokens: 0 on the signup key is expected. The 100 million welcome grant sits in the account pool, not on the key. See Tokens & keys.




Go back
Tokens pool

Tokens & keys
100 million tokens as a gift at signup. Allocate them from the pool to a key before making requests

Getting started

Introduction
Quickstart
Account

Authentication
Tokens & keys
Reference

Models
API
Tools

OpenCode
VS Code
Hermes Agent
Account tokens live in a pool. Inference spends only what you allocate to a key.

In /account you can name and rename keys, allocate tokens from the pool to a key, and return them. Top-ups always credit the pool — then you split them across keys as you like.

Pool
New account: 100 million tokens as a gift at signup — they go to the pool, not to the first key.
New account key: 0 until you allocate.
Top up (account): crypto via NOWPayments. Tokens land in the pool after confirmation.
Move tokens
From /account or with a session cookie:

Action	Endpoint
List keys	GET /v1/account/keys
Create a key	POST /v1/account/keys (starts at 0)
Allocate pool → key	POST /v1/account/allocate { "key_id", "amount" }
Return key → pool	POST /v1/account/return { "key_id", "amount" }
Revoke a key	DELETE /v1/account/keys/{id} (remainder returns to pool)
Usage	GET /v1/account/usage?days=30
Ledger	GET /v1/account/ledger
Packages	GET /v1/billing/packages
Checkout	POST /v1/billing/checkout { "package_id" }

curl -X POST https://inference.dahl.global/v1/account/allocate \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"key_id":123,"amount":10000000}'
Warning

A new key with 0 tokens returns 402 available tokens exhausted until you allocate. Creating extra keys does not grant more free tokens.

Top up
In the account UI, Top up opens crypto checkout (USDT, BTC, and others via NOWPayments). Packages are priced around $0.03 per 1M tokens. Paid tokens are credited to the pool after payment is confirmed — not the key.

Balance on a key
With any API key, GET /tokens/current returns remaining tokens on that key (not the pool).


curl https://inference.dahl.global/tokens/current \
  -H "Authorization: Bearer $DAHL_API_KEY"
Successful inference deducts input + output from the upstream usage field when present. Chat and the account page refresh the same balances.






Models IDs

Models
Use IDs from GET /v1/models. Do not rely on stale model names

Getting started

Introduction
Quickstart
Account

Authentication
Tokens & keys
Reference

Models
API
Tools

OpenCode
VS Code
Hermes Agent
Dahl exposes models through GET /v1/models. Always read IDs from the live response — they change as the network adds or rotates capacity.


curl https://inference.dahl.global/v1/models
Currently available
Typical production IDs (verify live). Embeddings are not served yet.

Model ID	Context	Notes
MiniMaxAI/MiniMax-M2.7	180K	Default — chat and coding. Tools.
deepseek-ai/DeepSeek-V4-Flash-0731	400K	Fast coding, reasoning, agents. Tools.
zai-org/GLM-5.3-Flash	400K	Fast general model with reasoning. Tools.
Qwen/Qwen3.8-Flash-Next	256K	Soon — not serving yet. Tools.
moonshotai/Kimi-K2.6	256K	Retired — no longer offered on Dahl.
zai-org/GLM-5.2-FP8	1.0M	Retired — no longer offered on Dahl.
The landing and status pages show the same IDs. Only the model field changes between curl examples.

Using a model
Set model to the exact id string. All chat completion requests require a Bearer key with tokens.


curl https://inference.dahl.global/v1/chat/completions \
  -H "Authorization: Bearer $DAHL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MiniMaxAI/MiniMax-M2.7",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

curl https://inference.dahl.global/v1/chat/completions \
  -H "Authorization: Bearer $DAHL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-ai/DeepSeek-V4-Flash-0731",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
Availability
GET /v1/status reports recent probes (operational, uptime). Public — no key. Windows: 1h, 24h, 7d, 30d.


curl "https://inference.dahl.global/v1/status?window=24h"
If a model is listed but requests fail: refresh GET /v1/models, check /status, switch to a live id, retry with short backoff on 503. A 400 for a retired or unknown model names the live IDs in error.message.





API reference

API
Same request shape as OpenAI. Different base URL and key

Getting started

Introduction
Quickstart
Account

Authentication
Tokens & keys
Reference

Models
API
Tools

OpenCode
VS Code
Hermes Agent
Base URL
All inference calls use https://inference.dahl.global/v1. Chat completions require Authorization: Bearer <API_KEY> and a key with an allocated token balance.

Chat completions
POST /v1/chat/completions is OpenAI-compatible. Send model and messages. Read assistant text from choices[0].message.content.


curl https://inference.dahl.global/v1/chat/completions \
  -H "Authorization: Bearer $DAHL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MiniMaxAI/MiniMax-M2.7",
    "messages": [
      { "role": "user", "content": "Hello, Dahl!" }
    ]
  }'

{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "..."
      }
    }
  ]
}
Streaming
Add "stream": true. Dahl forwards OpenAI SSE (data: {…} lines, ending with data: [DONE]). Prefer streaming for long completions so the client can render tokens as they arrive.


curl https://inference.dahl.global/v1/chat/completions \
  -H "Authorization: Bearer $DAHL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MiniMaxAI/MiniMax-M2.7",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
Responses (Codex / Agents SDK)
POST /v1/responses is a thin adapter over the same models as chat completions. Codex CLI and the OpenAI Agents SDK use this path by default. Send model and input (a string or item list). Read text from output_text or output[]. Streaming uses Responses SSE (response.created … response.completed) — there is no data: [DONE].


curl https://inference.dahl.global/v1/responses \
  -H "Authorization: Bearer $DAHL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MiniMaxAI/MiniMax-M2.7",
    "input": "Hello, Dahl!"
  }'

{
  "id": "resp_…",
  "object": "response",
  "status": "completed",
  "model": "MiniMaxAI/MiniMax-M2.7",
  "output_text": "…",
  "output": [
    {
      "type": "message",
      "role": "assistant",
      "content": [
        { "type": "output_text", "text": "…" }
      ]
    }
  ]
}
Point Codex at a custom provider id (dahl), not the built-in openai provider — otherwise Codex calls /v1/responses/compact, which this broker does not implement (local compact instead).


model = "MiniMaxAI/MiniMax-M2.7"
model_provider = "dahl"

[model_providers.dahl]
name = "Dahl"
base_url = "https://inference.dahl.global/v1"
env_key = "DAHL_API_KEY"
requires_openai_auth = false

import os
from openai import OpenAI

client = OpenAI(
    base_url="https://inference.dahl.global/v1",
    api_key=os.environ["DAHL_API_KEY"],
)
r = client.responses.create(
    model="MiniMaxAI/MiniMax-M2.7",
    input="Hello, Dahl!",
)
print(r.output_text)
Using a coding tool? See the setup pages for OpenCode, VS Code and Hermes Agent.

Note

Function tools work. Hosted OpenAI tools (web_search, computer use, their code interpreter) are skipped. Server-side previous_response_id / conversations are not stored — send the full input each turn. Prefer MiniMax for agents.

Tools
MiniMax and DeepSeek Flash accept OpenAI-style tools / tool_choice on chat completions. Vision is not offered on current models. Always confirm that the model is currently listed in GET /v1/models before sending tool payloads.

Public endpoints
These do not need an API key:

GET /v1/models — live model IDs
GET /v1/status?window=1h|24h|7d|30d — recent uptime probes (default 24h)
GET /health — process health
GET /v1/auth/check-username?username=… — username availability
Errors
Status	Message	What to do
401	Missing API token / invalid API token	Send Authorization: Bearer with a current key
402	available tokens exhausted	Allocate from the pool or top up
429	too many signup/sign-in attempts	Wait, then retry
429 model_concurrency	This model is at concurrency capacity…	The model is full right now. Retry after Retry-After or switch model (see below)
429 parallel_key_limit / parallel_user_limit	too many parallel requests…	Too many requests at once on this key or account. Wait for in-flight requests to finish or lower concurrency
400	This model is not currently offered (+ live IDs)	Switch model to an id from the error or GET /v1/models
502 / 503 / timeouts	temporary error on our side or overload	Not related to your key. Retry with short backoff
Priority at peak hours
When a model is at capacity, requests are admitted by account class: paid accounts first, then free accounts, then keys not linked to an account. Tokens on the key do not change the order. The first credited top-up makes the account paid.

Note

Key balance lives at the service root (GET /tokens/current). Account routes are under /v1/auth and /v1/account. Chat completions stay under /v1.





OpenCode setup

OpenCode
Dahl as an OpenAI-compatible provider in OpenCode

Getting started

Introduction
Quickstart
Account

Authentication
Tokens & keys
Reference

Models
API
Tools

OpenCode
VS Code
Hermes Agent
OpenCode talks to Dahl as an OpenAI-compatible provider. It needs three things: the base URL with /v1, a key with tokens on it, and a model ID.

Setup
Get a key with tokens — in /account create a key and Allocate tokens to it from the pool (a new key starts at 0).
Add the provider — put this into ~/.config/opencode/opencode.json (or opencode.json in the project):

{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "dahl": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Dahl",
      "options": {
        "baseURL": "https://inference.dahl.global/v1",
        "apiKey": "{env:DAHL_API_KEY}"
      },
      "models": {
        "MiniMaxAI/MiniMax-M2.7": { "name": "MiniMax M2.7" },
        "deepseek-ai/DeepSeek-V4-Flash-0731": { "name": "DeepSeek V4 Flash" },
        "zai-org/GLM-5.3-Flash": { "name": "GLM 5.3 Flash" }
      }
    }
  }
}
3. Give OpenCode the key. Either export it in the shell where you run opencode:


export DAHL_API_KEY="dahl_…"
or store it in OpenCode instead of an env var:


opencode auth login
# → Other → provider id: dahl → paste your dahl_… key
4. Pick the model — run opencode, type /models, choose a Dahl model. Start with MiniMaxAI/MiniMax-M2.7; current IDs are in GET /v1/models.

Windows
The steps are the same. The global config is %USERPROFILE%\.config\opencode\opencode.json (for example C:\Users\you\.config\opencode\opencode.json); an opencode.json in the project folder works too. Set the key in PowerShell instead of export:


# this PowerShell window
$env:DAHL_API_KEY = "dahl_…"

# new windows (open a new PowerShell after this)
setx DAHL_API_KEY "dahl_…"
setx applies to new windows only: open a new PowerShell before running opencode. opencode auth login works on Windows as well.

Common errors
Message	Cause	Fix
No active credentials for provider: dahl	The provider is configured but has no key	Export DAHL_API_KEY in the same shell, or run opencode auth login
Method Not Allowed (405)	baseURL without /v1	Use https://inference.dahl.global/v1
available tokens exhausted (402)	The key has 0 tokens	Allocate from the pool in /account
This model is not currently offered	Stale model ID	Pick an id from GET /v1/models and update models in the config
This model is at concurrency capacity (429)	The model is full at peak hours	OpenCode retries on its own; or switch model. See Errors
Provider request failed with HTTP 502	Temporary error on our side	Not related to your key; OpenCode retries on its own
Note

OpenCode sends the whole conversation on every turn. When it outgrows the model window, Dahl returns the standard context_length_exceeded error and OpenCode compacts the session on its own; you can also run /compact yourself.






VS Code setup

VS Code
Dahl in Cline, Roo Code, Kilo Code and Continue

Getting started

Introduction
Quickstart
Account

Authentication
Tokens & keys
Reference

Models
API
Tools

OpenCode
VS Code
Hermes Agent
VS Code has no built-in Dahl provider. Use a coding extension that supports an OpenAI-compatible API, for example Cline, Roo Code, Kilo Code or Continue. Each needs the same three things: the base URL with /v1, a key with tokens on it, and a model ID.

Get a key with tokens
In /account → API keys, Allocate tokens from the pool to a key (a new key starts at 0), then copy the key.

Cline, Roo Code, Kilo Code
Open the extension settings and pick the OpenAI Compatible provider:


API Provider:  OpenAI Compatible
Base URL:      https://inference.dahl.global/v1
API Key:       dahl_…
Model ID:      MiniMaxAI/MiniMax-M2.7
If the extension asks for the context window, use the value from Models: 180K for MiniMax M2.7, 400K for DeepSeek V4 Flash and GLM 5.3 Flash. Turn image input off — current models do not accept images. For agent work start with MiniMaxAI/MiniMax-M2.7.

Continue
Add the model to ~/.continue/config.yaml:


name: My Config
version: 0.0.1
schema: v1

models:
  - name: MiniMax M2.7 (Dahl)
    provider: openai
    model: MiniMaxAI/MiniMax-M2.7
    apiBase: https://inference.dahl.global/v1
    apiKey: dahl_…
provider: openai means the OpenAI API format; apiBase points it at Dahl.

Prefer the terminal? OpenCode runs in the VS Code terminal too.

Common errors
Message	Cause	Fix
available tokens exhausted (402)	The key has 0 tokens	Allocate from the pool in /account
Method Not Allowed (405)	Base URL without /v1	Use https://inference.dahl.global/v1
This model is not currently offered (400)	Wrong or stale model ID	Use an exact id from GET /v1/models
This model is at concurrency capacity (429)	The model is full at peak hours	Retry after Retry-After or switch model. See Errors







Hermes setup

Hermes Agent
Dahl as a custom endpoint in Hermes Agent

Getting started

Introduction
Quickstart
Account

Authentication
Tokens & keys
Reference

Models
API
Tools

OpenCode
VS Code
Hermes Agent
Hermes Agent connects to Dahl as a custom OpenAI-compatible endpoint. It needs the base URL with /v1, a key with tokens on it, and a model ID.

Setup
Get a key with tokens — in /account → API keys, Allocate tokens from the pool to a key (a new key starts at 0).
Run the model wizard in a terminal (not inside a Hermes chat) and choose Custom endpoint:

hermes model
# → Custom endpoint
#   Base URL: https://inference.dahl.global/v1
#   API key:  dahl_…
#   Model:    MiniMaxAI/MiniMax-M2.7
If the wizard asks for the API mode, choose Chat Completions. Set the context length to the model window (see below).

Config file
The wizard saves the settings to ~/.hermes/config.yaml. You can also edit it by hand and keep the key in ~/.hermes/.env:


# ~/.hermes/config.yaml
model:
  default: MiniMaxAI/MiniMax-M2.7
  provider: custom
  base_url: https://inference.dahl.global/v1
  key_env: DAHL_API_KEY
  context_length: 180000

# ~/.hermes/.env
DAHL_API_KEY=dahl_…
Context length
Hermes needs at least 64K tokens of context for agent work with tools. Dahl models fit: MiniMax M2.7 — 180K, DeepSeek V4 Flash and GLM 5.3 Flash — 400K. Start with MiniMaxAI/MiniMax-M2.7; current IDs are in GET /v1/models.

Common errors
Message	Cause	Fix
available tokens exhausted (402)	The key has 0 tokens	Allocate from the pool in /account
Method Not Allowed (405)	Base URL without /v1	Use https://inference.dahl.global/v1
This model is not currently offered (400)	Wrong or stale model ID	Use an exact id from GET /v1/models
This model is at concurrency capacity (429)	The model is full at peak hours	Retry after Retry-After or switch model. See Errors






