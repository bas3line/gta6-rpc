# gta6-rpc

Make your Discord profile say you're already playing **Grand Theft Auto VI**, with a **Watch** button that sends your friends wherever you want.

One file, no dependencies. It talks straight to the Discord desktop app's local IPC socket.

## Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications), create a **New Application**, and name it `Grand Theft Auto VI`. That name becomes the bold title on your status.
2. In **General Information**, copy the **Application ID**. Optionally set the App Icon to a GTA VI logo.
3. In **Rich Presence → Art Assets**, upload a GTA VI logo named `gta6`. A square PNG of at least 512px works best. No logo is included here because it's Rockstar's trademark. New assets can take a few minutes to appear.
4. Copy the example config and fill in your ID and link:
   ```sh
   cp config.example.json config.json
   ```
5. Keep the Discord desktop app open, then run:
   ```sh
   npm start
   ```

The status stays up while the script runs, and Ctrl+C clears it. The script reconnects if Discord restarts.

## Config

| Key | What it does |
| --- | --- |
| `clientId` | Your Discord Application ID. |
| `type` | `playing`, `watching`, `listening`, `competing` or `streaming` (see below). |
| `fallbackType` | Used if Discord rejects `type`. |
| `watchUrl` | Where the button goes. |
| `buttonLabel` | Button text, `Watch` by default. |
| `largeImage` | Art asset name, or a public `https://` image URL. |
| `largeText` | Tooltip on the image. |
| `statuses` | List of `{ details, state }` lines, rotated every `rotateSeconds` (minimum 20). |

## Why not "Streaming"?

Discord's local RPC doesn't allow the Streaming type. Asking for it gets this error back:

```
child "activity" fails because [child "type" fails because ["type" must be one of [0, 2, 3, 5]]]
```

If you set `type` to `streaming`, the script falls back to `fallbackType` with a custom button. The real purple Streaming card can only be set from inside the client. Vencord's CustomRPC plugin does this with Activity type **Streaming** and your YouTube or Twitch link as the **Stream link**. Vencord is a client mod and breaks Discord's Terms of Service, so that one is your call.

## Things that look like bugs but aren't

- **You can't see your own button.** Discord shows buttons only to other people ([docs](https://docs.discord.com/developers/discord-social-sdk/development-guides/setting-rich-presence)). Ask a friend to check.
- **Nothing shows at all.** Turn on Discord Settings → Activity Privacy → "Share your detected activities with others".

Tested on macOS with Node 26. Windows and Linux socket paths are included but untested.

## License

MIT
