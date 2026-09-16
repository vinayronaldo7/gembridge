# GemBridge - Cloudflare Workers Deployment Guide

## Project Overview

GemBridge is a serverless proxy service deployed on Cloudflare Workers that converts Google Gemini's web interface into an OpenAI-compatible API interface. No server required, no API Key required (optional), ready to use out of the box.

### Core Features

- **Zero-cost deployment**: Based on Cloudflare Workers free plan (100,000 requests/day)
- **Global acceleration**: Automatically deployed to 300+ Cloudflare edge nodes worldwide
- **OpenAI compatible**: Fully compatible with `/v1/chat/completions` and `/v1/models` endpoints
- **Typewriter streaming**: True SSE (Server-Sent Events) streaming response
- **Multi-fingerprint rotation**: 8 browser fingerprints + 6 language preferences with random rotation, reducing detection probability
- **Multi-Cookie rotation**: Supports multiple Google account cookies with random selection
- **Concurrency-safe**: Request-level configuration isolation, completely eliminates configuration cross-contamination under high concurrency
- **Tool calling support**: Compatible with OpenAI Function Calling format

### Use Cases

- Provide free Gemini API for clients like NextChat, Cherry Studio, ChatBox
- Serve as a Gemini model backend in tools like WorkBuddy
- AI capability integration for personal learning, research, and small projects

---

## Quick Deployment

### Step 1: Log in to Cloudflare

1. Open the [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Log in to your Cloudflare account (free registration available if you don't have an account)
3. Go to the left menu: **Workers & Pages**

### Step 2: Create a Worker

1. Click **Create Application** → **Create Worker**
2. Give the Worker a name (e.g., `api`)
3. Click the **Deploy** button
4. Click the **Edit Code** button
5. Clear the default code in the editor
6. Paste the complete project code into the editor
7. Click **Save and Deploy** in the upper right corner

### Step 3: Get the Test Address

After successful deployment, your API address is:

```
https://your-worker-name.your-account.workers.dev
```

For example: `https://api.gemini-api.workers.dev`

### Step 4: Verify Deployment

Visit the following address in your browser:

```
https://your-worker.workers.dev/health
```

If you see a JSON response like the following, deployment was successful:

```json
{
  "status": "ok",
  "version": "1.5.0-cf-multifingerprint",
  "platform": "Cloudflare Workers",
  "models": ["gemini-3.6-flash", "gemini-3.5-flash", "..."],
  "hasCookie": false,
  "hasSapisid": false
}
```

---

## Client Configuration

### NextChat (ChatGPT-Next-Web)

| Setting | Value |
|--------|-------|
| Interface Type | OpenAI |
| Interface Address | `https://your-worker.workers.dev/v1` |
| API Key | `sk-gemini` (default key) |
| Model | `gemini-3.6-flash` |

### Cherry Studio

| Setting | Value |
|--------|-------|
| API Address | `https://your-worker.workers.dev/v1` |
| API Key | `sk-gemini` |
| Model | `gemini-3.6-flash` |

### ChatBox

| Setting | Value |
|--------|-------|
| API Mode | OpenAI API |
| API Domain | `https://your-worker.workers.dev` |
| API Path | `/v1/chat/completions` |
| API Key | `sk-gemini` |

### Testing with curl

```bash
# Non-streaming request
curl https://your-worker.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-gemini" \
  -d '{
    "model": "gemini-3.6-flash",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }'

# Streaming request (typewriter effect)
curl -N https://your-worker.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-gemini" \
  -d '{
    "model": "gemini-3.6-flash",
    "messages": [{"role": "user", "content": "Tell me a story"}],
    "stream": true
  }'
```

---

## Environment Variables (Optional)

Configure in Cloudflare Dashboard → Workers → Your Worker → Settings → Variables → Environment Variables.

### Authentication

| Variable | Description | Example |
|--------|------|--------|
| `COOKIE_STRING` | Gemini Cookie, separated by `\|` | `cookie1\| cookie2\| cookie3` |
| `SAPISID` | SAPISID value, separated by `\|` | `sapisid1\| sapisid2\| sapisid3` |
| `API_KEYS` | API key whitelist (JSON array) | `["sk-gemini", "my-key"]` |

### Gemini Configuration

| Variable | Description | Example |
|--------|------|--------|
| `GEMINI_BL` | Gemini build label (update when encountering 405) | `boq_assistant-bard-web-server_20260716.08_p0` |
| `DEFAULT_MODEL` | Default model | `gemini-3.6-flash` |
| `AUTH_USER` | Multi-account index | `0` |

### Performance Tuning

| Variable | Description | Default |
|--------|------|--------|
| `RETRY_ATTEMPTS` | Retry count | `3` |
| `RETRY_DELAY_SEC` | Retry interval (seconds) | `2` |
| `REQUEST_TIMEOUT_SEC` | Request timeout (seconds) | `28` |
| `FINGERPRINT_JITTER_MS` | Maximum random delay (ms) | `1500` |
| `RATE_LIMIT_MAX` | Rate limit max requests | `3000` |
| `RATE_LIMIT_WINDOW` | Rate limit time window (seconds) | `60` |

---

## Getting Gemini Cookies

### Why are cookies needed?

Anonymous requests are subject to strict rate limits by Gemini (returning HTTP 429 errors). Configuring valid cookies can:
- Significantly reduce the probability of being rate-limited
- Improve Pro model routing quality
- Provide a more stable service experience

### Steps

1. Open Chrome/Edge browser
2. Visit https://gemini.google.com/app and sign in with your Google account
3. Press **F12** to open Developer Tools
4. Go to the **Application** tab
5. On the left, select **Cookies** → `https://gemini.google.com`
6. Find the following cookies and copy their values:
   - `__Secure-1PSID`
   - `__Secure-3PSID`
   - `SAPISID`
7. Combine into a complete cookie string:
   ```
   __Secure-1PSID=your_value; __Secure-3PSID=your_value; SAPISID=your_value
   ```

### Multi-account Configuration

If you have multiple Google accounts, you can separate multiple cookies with `|`:

```
COOKIE_STRING = "account1_cookie| account2_cookie| account3_cookie"
SAPISID = "sapisid_1| sapisid_2| sapisid_3"
```

Each request randomly selects one Cookie, significantly reducing the probability of a single Google account being rate-limited.

---

## Updating BL Version

If you encounter an `HTTP 405: Method Not Allowed` error, the Gemini frontend has been updated and you need to sync the build label:

1. Open https://gemini.google.com/app in your browser
2. Press **F12** → **Network** tab
3. Search for `boq_assistant` in any request URL
4. Copy the latest version number, for example:
   ```
   boq_assistant-bard-web-server_20260730.02_p0
   ```
5. Update the environment variable `GEMINI_BL` or the `geminiBl` configuration in the code

---

## Multi-Fingerprint Rotation Mechanism

This program has a built-in browser fingerprint rotation system. Each request randomly selects a different browser identifier:

| Fingerprint Type | Pool Size | Description |
|---------|--------|------|
| User-Agent | 8 | Weighted random, simulates real browser market share |
| Accept-Language | 6 | Uniform random, simulates users from different regions |
| Sec-Ch-Ua | 3 | Chrome version identifier (added only for Chrome UA) |
| Random delay | 0-1500ms | Add random delay before request, simulating human operation |

---

## Security Recommendations

1. **Change the default API Key**: Change `sk-gemini` in `apiKeys` to your own key
2. **Set rate limits**: Adjust `RATE_LIMIT_MAX` according to your actual usage
3. **Regularly update cookies**: Google cookies expire; you need to replace them regularly
4. **Do not share cookies**: Cookies are equivalent to your Google account credentials

---

## FAQ

### Q: Returns `empty response from server`

**Reason**: NextChat streaming parsing issue.
**Solution**: Make sure you are using the latest version of the code (SSE format has been fixed).

### Q: Returns `HTTP 429: Too Many Requests`

**Reason**: Gemini rate limit; anonymous requests have stricter frequency limits.
**Solution**: Configure valid `COOKIE_STRING` and `SAPISID`.

### Q: Returns `HTTP 405: Method Not Allowed`

**Reason**: BL version is outdated.
**Solution**: Update `geminiBl` configuration (see the "Updating BL Version" section above).

### Q: Returns `invalid api key`

**Reason**: Client API key configuration error.
**Solution**: Check if the client is configured with the correct API Key (default `sk-gemini`).

### Q: Cross-contamination when using WorkBuddy

**Reason**: Multiple model concurrent requests share global configuration.
**Solution**: The current version has resolved this issue through request-level configuration isolation.

---

## Supported Models

| Model ID | Type | Description |
|---------|------|------|
| `gemini-3.6-flash` | FAST | Latest all-around model |
| `gemini-3.5-flash` | FAST | Alias for gemini-3.6-flash |
| `gemini-3.5-flash-thinking` | THINKING | Deep thinking mode |
| `gemini-3.1-pro` | PRO | Professional (requires cookie) |
| `gemini-auto` | AUTO | Auto model selection |
| `gemini-3.5-flash-thinking-lite` | DYNAMIC | Adaptive dynamic thinking |
| `gemini-flash-lite` | LITE | Lightweight fast model |

Thinking mode can be overridden via the `@think=` parameter:
- `gemini-3.6-flash@think=0` — Flash model + deep thinking
- `gemini-3.1-pro@think=4` — Pro model + auto thinking

---

## Changelog

| Version | Date | Changes |
|------|------|---------|
| 1.5.0 | 2026-07-31 | Added multi-fingerprint rotation, multi-Cookie rotation, random delay mechanism |
| 1.4.0 | 2026-07-30 | Fixed cross-contamination, rate limit memory safety |
| 1.3.0 | 2026-07-29 | Fixed SSE streaming format, NextChat compatibility |
| 1.0.0 | 2026-07-16 | Initial version, ported from gemini-web2api v1.1.0 |

---

## License

This project is ported from the original [gemini-web2api](https://github.com/your-repo/gemini-web2api) project and follows the original project's open-source license.
