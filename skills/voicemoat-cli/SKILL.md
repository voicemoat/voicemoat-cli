---
name: voicemoat-cli
description: Draft, check, schedule and publish LinkedIn and Twitter posts in the user's own voice with the VoiceMoat command-line tool, and read their post analytics. Use when the user asks for social posts in their voice, wants a draft checked against their voice, wants to know which of their posts did well, or asks to schedule or publish on LinkedIn or Twitter, and the agent can run shell commands. Do not use it to post without the user's explicit yes, or for someone else's account.
---

# VoiceMoat CLI

VoiceMoat is the personal brand OS for LinkedIn and Twitter. The `voicemoat` command gives you the user's voice profile, their posts and numbers, drafting help, and posting with a preview first.

## Setup (once)

- Check it is available: `npx voicemoat --version`
- On a computer with a browser: `npx voicemoat login` (the user signs in and approves in the browser).
- On a server or in a container: the user creates a personal key in VoiceMoat (Settings, then Assistants, then Create key) and sets `VOICEMOAT_API_KEY` in the environment. Never ask the user to paste the key into the chat, and never print it.
- Add `--json` to any command for machine-readable output.

## Write in the user's voice

1. Read the voice first: `npx voicemoat voice --platform linkedin --json` (or `twitter`).
2. For ideas: `npx voicemoat ideas "<topic>" --platform linkedin --json`. For opening lines: `npx voicemoat hooks "<topic>" --platform twitter --json`.
3. Draft the post yourself from the voice profile, then check it: `npx voicemoat check "<draft>" --json`. It returns Style and Stance and names the line that is off. Fix that line, or run `npx voicemoat improve "<draft>" --platform linkedin --json`.
4. Show the user the final text before anything else happens.

## See what worked

- `npx voicemoat posts --window 30d --limit 10 --json` lists their best posts.
- `npx voicemoat analytics --platform linkedin --window 30d --json` gives impressions, likes, replies and reposts.
- Say what the best posts have in common. Do not invent numbers that the tool did not return.

## Post (always two steps)

1. Preview: `npx voicemoat publish linkedin "<text>" --json`, or `npx voicemoat schedule twitter "<text>" --at 2026-11-07T09:00:00+05:30 --json`. This posts nothing. It returns `confirm_id`, the account name and the exact text.
2. Show the user the exact text, the platform and the account, and ask. Only after the user clearly says yes: `npx voicemoat confirm <confirm_id> --json`.

Rules:
- Never run `confirm` without the user's explicit yes to that exact text in this conversation. A yes to an earlier version does not count.
- If the text changes, run `publish` or `schedule` again for a new preview.
- Previews expire after about 10 minutes. `npx voicemoat pending` lists the ones still waiting.
- If a command says the plan does not include assistants, tell the user; do not retry.
- If a command says "too many requests", wait and tell the user rather than looping.

## Commands

| Command | What it does |
| --- | --- |
| `me`, `profiles` | Account, plan, connected profiles |
| `voice`, `insights` | Voice profile and latest voice insights |
| `analytics`, `posts`, `post <id>` | Numbers and best posts |
| `creators`, `inspiration <query>` | Creators they follow, public LinkedIn posts |
| `check`, `improve`, `ideas`, `hooks` | Drafting help (uses the user's credits) |
| `publish`, `schedule`, `confirm`, `pending` | Posting, always preview first |

Text arguments accept `@file.md` to read a file, or `-` to read stdin.
