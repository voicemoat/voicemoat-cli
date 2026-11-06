# VoiceMoat CLI

VoiceMoat from your terminal: draft LinkedIn and Twitter posts in your voice, check drafts for Style and Stance, read your analytics, and schedule or publish with a preview first.

```
npx voicemoat login
npx voicemoat ideas "remote work" --platform linkedin
npx voicemoat check "Consistency beats talent. Post weekly."
npx voicemoat schedule linkedin "Shipped dark mode today." --at 2026-11-07T09:00:00+05:30
npx voicemoat confirm 3F9A2C
```

Needs a VoiceMoat account on the Pro or Enterprise plan, or the $5 Pro trial: https://voicemoat.com

## Sign in

- **Your computer:** `npx voicemoat login` opens your browser. You sign in to VoiceMoat and approve, the same screen Claude and ChatGPT use.
- **Servers, containers and agents:** create a personal key in VoiceMoat (Settings, then Assistants, then Create key) and set it as `VOICEMOAT_API_KEY`. Keep it out of shared files.
- `npx voicemoat logout` forgets the sign-in on this computer. To stop every assistant and key at once, use Settings, then Assistants, then Disconnect.

## Commands

| Command | What it does |
| --- | --- |
| `me` | Your account and plan |
| `profiles` | Your connected LinkedIn and Twitter profiles |
| `voice [--platform linkedin\|twitter]` | Your voice profile |
| `insights [--platform ...]` | Latest voice insights |
| `analytics [--platform ...] [--window today\|yesterday\|7d\|30d]` | Impressions, likes, replies, reposts |
| `posts [--window ...] [--limit N]` | Your best posts by engagement |
| `post <post_id>` | One post with its numbers |
| `creators [--limit N]` | Creators you study |
| `inspiration <query> [--limit N]` | Public LinkedIn posts from tracked creators |
| `check <text>` | Style and Stance against your voice |
| `improve <text> [--full] [--platform ...] [--thread]` | A better version of a draft |
| `ideas <topic> [--platform ...] [--count N]` | Post ideas in your voice |
| `hooks <topic> [--platform ...]` | Three opening lines |
| `publish <linkedin\|twitter> <text>` | Preview a post (nothing is posted) |
| `schedule <linkedin\|twitter> <text> --at <ISO time>` | Preview a scheduled post |
| `confirm <id>` | Post the previewed text, once, before it expires |
| `pending` | Previews waiting for confirmation |

Text can be typed, read from a file with `@draft.md`, or piped with `-`. Add `--json` to any command for scripts and agents. Use `--account <id>` if you have more than one profile on a platform.

## Posting asks twice

`publish` and `schedule` only show a preview with the exact text and account, and save a short id. Nothing is posted until you run `voicemoat confirm <id>`. The id works once, for about 10 minutes, and only for that exact text.

## For AI agents

The `skills/voicemoat-cli/SKILL.md` skill teaches agents (Claude Code, Codex, Cursor, OpenClaw, Hermes, nanoclaw, Paperclip and others) to use the CLI safely:

```
npx skills add voicemoat/voicemoat-cli
```

## Network and credentials

- Calls one endpoint: `https://app.voicemoat.com/api/mcp` (VoiceMoat's hosted MCP server), plus VoiceMoat's sign-in server during `login`. Set `VOICEMOAT_URL` to point at another VoiceMoat server.
- Stores the sign-in in `~/.voicemoat/config.json` (file mode 0600) and pending previews in `~/.voicemoat/pending.json`. Set `VOICEMOAT_HOME` to move them.
- No dependencies, no telemetry, no install scripts.

Prefer an assistant? The same tools work in Claude, ChatGPT, Cursor, Gemini and more: https://voicemoat.com/mcp

## License

MIT
