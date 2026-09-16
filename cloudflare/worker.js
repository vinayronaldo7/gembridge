/**
 * GemBridge - Cloudflare Workers Concurrency-Safe Fixed Edition
 * Multi-fingerprint rotation + Multi-Cookie rotation + Typewriter effect + Random delay
 *
 * ============================================================================
 * Project Description
 * ============================================================================
 * This program converts Google Gemini's web interface into an OpenAI-compatible API interface.
 * Deployed on the Cloudflare Workers edge computing platform, it runs without a server.
 * Supports streaming output (SSE typewriter effect), non-streaming output, and tool calling (Function Calling).
 *
 * ============================================================================
 * Feature List:
 * ============================================================================
 *
 * 1. [Concurrency Safety] Completely eliminates the serious risk of global CONFIG being tampered with or cross-contaminated by concurrent async requests.
 *    Root cause: CF Workers' Isolate does not re-execute global scope code during hot start (reuse).
 *    When clients like WorkBuddy send multiple concurrent requests in a very short time,
 *    they may share the same global CONFIG object (because they share the same Isolate).
 *    Request A sets CONFIG.cookieString = "cookie_a",
 *    Request B then sets CONFIG.cookieString = "cookie_b" (overwriting A's value!),
 *    Request A continues execution using "cookie_b" - cross-contamination!
 *    This is especially severe in WorkBuddy's multi-model concurrent call scenarios.
 *
 *    Solution:
 *    Each request creates a brand new independent configuration copy via getRequestConfig(env),
 *    all functions receive the configuration object via parameters, completely no reliance on global mutable state.
 *
 * 2. [Request-Level Configuration Isolation] Implements a mechanism of creating independent configuration copies per request.
 *    - DEFAULT_CONFIG serves as a read-only template and is never modified
 *    - getRequestConfig(env) creates an independent configuration copy for each request
 *    - Configuration is loaded from env (environment variables, independently injected by the CF platform per request)
 *    - All function signatures include a config parameter, completely eliminating global state dependency
 *    - Uses explicit assignment (env.X || null) to prevent value residue from Isolate reuse
 *
 * 3. [Rate Limit Memory Safety] Fixes the implicit memory leak of global rateLimitStore in Serverless environments.
 *    - In Serverless environments, Isolates may survive for a long time (hot start reuse)
 *    - If expired records are not cleaned up, the Map grows infinitely causing memory leaks
 *    - Uses a random probability cleanup mechanism (5% probability triggers global cleanup)
 *    - Each cleanup iterates all keys and removes expired or empty records
 *    - Ensures stable memory usage after long-term operation
 *
 * 4. [SAPISID Auto-Extraction] Adds defensive logic to auto-extract SAPISID from COOKIE_STRING.
 *    - Users typically copy complete Cookie strings from browsers
 *    - Cookie format: "__Secure-1PSID=xxx; SAPISID=yyy; ..."
 *    - If the user sets COOKIE_STRING but forgets to set SAPISID separately
 *    - The program automatically extracts the SAPISID value from the Cookie string via regex
 *    - Regex: /SAPISID=([^;]+)/
 *    - Improves user experience and reduces configuration errors
 *
 * 5. [Multi-Fingerprint Rotation] Adds browser fingerprint rotation mechanism, reducing the probability of being identified by Gemini.
 *    - User-Agent rotation pool (8 real browser UAs covering Windows/macOS/Linux)
 *    - Accept-Language rotation pool (6 language preference settings)
 *    - Sec-Ch-Ua rotation pool (3 Chrome version identifiers)
 *    - Sec-Ch-Ua-Platform rotation pool (3 OS platforms)
 *    - Weighted random selection, simulating real browser market share distribution
 *    - Chrome ~72% (including Windows/macOS/Linux), Firefox ~8%, Safari ~8%
 *
 * 6. [Multi-Cookie Rotation] Supports configuring Cookies from multiple Google accounts with random selection.
 *    - Environment variables use | to separate multiple Cookies: "cookie1| cookie2| cookie3"
 *    - Environment variables use | to separate multiple SAPISIDs: "sapisid1| sapisid2| sapisid3"
 *    - Each request randomly selects one Cookie and its corresponding SAPISID
 *    - If SAPISID count matches Cookie count, uses the indexed SAPISID
 *    - Significantly reduces the probability of a single Google account being rate-limited (429)
 *
 * 7. [Random Delay] Adds a small random delay before each request, simulating human operation intervals.
 *    - Delay time is randomly between 0 and fingerprintJitterMs (default 1500ms)
 *    - New random delay is also added on retries
 *    - Configurable: set environment variable FINGERPRINT_JITTER_MS=0 to disable
 *    - Works even better in combination with fingerprint rotation
 *
 * 8. [SSE Typewriter Effect] OPTIONS preflight priority handling, real-time incremental output, heartbeat keepalive.
 *    SSE format strictly follows OpenAI standards:
 *    - First chunk: delta: { role: 'assistant' } (role only, no content)
 *    - Content chunk: delta: { content: 'incremental text' } (real-time incremental calculation and push)
 *    - End chunk: delta: { content: "" }, finish_reason: 'stop'
 *    - Heartbeat: sends ": heartbeat\n\n" SSE comment every 2 seconds
 *
 * 9. [Full Feature Retention] Tool calling (Function Calling), rate limiting, API authentication,
 *    Google native API (Gemini CLI compatible), Responses API (Codex CLI compatible).
 *
 * ============================================================================
 * Deployment Instructions:
 * ============================================================================
 * 1. Log in to Cloudflare Dashboard -> Workers & Pages
 * 2. Create Worker -> Paste this code -> Save and Deploy
 * 3. Configure environment variables (optional):
 *
 *    [Authentication]
 *    - COOKIE_STRING: Cookie string, separated by |
 *      Format: "cookie_account1| cookie_account2| cookie_account3"
 *      Copy complete Cookie from browser: F12 -> Application -> Cookies
 *      Includes __Secure-1PSID, __Secure-3PSID, SAPISID, etc.
 *    - SAPISID: SAPISID value, separated by |
 *      Format: "sapisid_1| sapisid_2| sapisid_3"
 *      If not set, will be auto-extracted from COOKIE_STRING
 *
 *    [API Security]
 *    - API_KEYS: API key JSON array, e.g. ["sk-gemini", "sk-my-key"]
 *      Leave empty or set to [] to disable key verification
 *
 *    [Gemini Configuration]
 *    - GEMINI_BL: Gemini build label
 *      Update this value when encountering 405 errors
 *      How to obtain: Open gemini.google.com in browser -> F12 -> Network -> Search "boq_assistant"
 *    - DEFAULT_MODEL: Default model name, e.g. "gemini-3.6-flash"
 *    - AUTH_USER: Multi-account index, 0=first account, 1=second account
 *
 *    [Performance Tuning]
 *    - RETRY_ATTEMPTS: Retry count, default 3
 *    - RETRY_DELAY_SEC: Retry interval (seconds), default 2
 *    - REQUEST_TIMEOUT_SEC: Request timeout (seconds), default 28
 *    - FINGERPRINT_JITTER_MS: Max random delay before request (ms), default 1500
 *      Set to 0 to disable random delay
 *    - RATE_LIMIT_MAX: Rate limit max requests, default 3000
 *    - RATE_LIMIT_WINDOW: Rate limit time window (seconds), default 60
 *
 *    Client configuration:
 *    Base URL: https://your-worker.workers.dev/v1
 *    API Key: sk-gemini (or the key you set in configuration)
 *    Model: gemini-3.6-flash
 *
 * ============================================================================
 * Technical Architecture:
 * ============================================================================
 *
 * [Isolate Model]
 * Cloudflare Workers uses Isolate (sandboxed environment) to process each request:
 * - Cold start: Global code re-executes, all variables are reinitialized
 * - Hot start: Existing Isolate is reused, global code does not execute, variables retain previous state
 * - env parameter: Each request is independently injected by the CF platform, always containing the latest environment variables
 *
 * [Configuration Isolation Principle]
 * 1. DEFAULT_CONFIG serves as an immutable template (read-only)
 * 2. getRequestConfig(env) creates a brand new copy each time
 * 3. Reads configuration from env, uses || null to explicitly override all fields
 * 4. All functions receive configuration via config parameter
 * 5. No dependency on any global mutable state exists
 *
 * [Why Explicit Override Is Needed]
 * If using the pattern if (env.X) CONFIG.X = env.X:
 * - When env.X exists, CONFIG.X is updated (good)
 * - When env.X does not exist, the if block does not execute, CONFIG.X retains the previous value (bad)
 * Using CONFIG.X = env.X || null ensures explicit assignment every time.
 *
 * Ported from the original gemini-web2api v1.1.0 project
 * Original project: https://github.com/your-repo/gemini-web2api
 */

// ============================================================================
// Default Configuration - Read-only template only
// ============================================================================
// This is the "blueprint" for all request configurations, used to generate independent configuration copies for each request.
// This object is never modified; all modifications are made in request-level config copies.
// Uses Object.freeze() to ensure immutability and prevent accidental modifications that could have global impact.

var DEFAULT_CONFIG = {
  // ---- Retry Configuration ----
  // The number of automatic retries when a request fails
  // Each retry uses exponential backoff: delay = retryDelaySec * 2^attempt
  // Example: First retry delay 2 seconds, second 4 seconds, third 8 seconds
  retryAttempts: 3,
  // Base time for retry interval (seconds)
  // Actual delay = retryDelaySec * 2^attempt (exponential backoff)
  retryDelaySec: 2,

  // ---- Request Timeout ----
  // Timeout for a single HTTP request (seconds)
  // Note: CF Workers free tier has a 30-second CPU time limit
  // Streaming request CPU time resets when data arrives, so it is not subject to this strict limit
  // But the initial connection and first data chunk must arrive within the timeout
  requestTimeoutSec: 28,

  // ---- Gemini Build Label ----
  // The version identifier from the Gemini frontend, used as a URL parameter for API requests
  // If you encounter an HTTP 405 Method Not Allowed error, this value has expired
  // Update method:
  //   1. Open https://gemini.google.com/app in your browser
  //   2. Press F12 to open Developer Tools
  //   3. Switch to the Network tab
  //   4. Search for "boq_assistant" in any request URL
  //   5. Copy the latest version number, e.g. "boq_assistant-bard-web-server_20260730.02_p0"
  geminiBl: 'boq_assistant-bard-web-server_20260716.08_p0',

  // ---- Multi-Account Support ----
  // Google supports logging in to multiple accounts in the same browser
  // null or "" means use the default account (the first logged-in account)
  // "0" means the first account, "1" means the second account, and so on
  // When using a non-default account, the Gemini URL will include a /u/1 prefix
  authUser: null,

  // ---- XSRF Token ----
  // Cross-site request forgery protection token
  // The Gemini web frontend uses this token, but API calls typically do not need it
  // If you encounter a 403 error, try extracting this value from the browser
  xsrfToken: null,

  // ---- Default Model ----
  // The default model to use when the client request does not specify a model parameter
  // Available options refer to the keys in the MODELS dictionary
  defaultModel: 'gemini-3.6-flash',

  // ---- API Key Whitelist ----
  // A list of keys used to authenticate client requests
  // An empty array [] means no authentication; all requests can access (not recommended for production)
  // Once set, the client must provide a valid key in the request headers
  // Supports Bearer Token, x-api-key, x-goog-api-key, URL parameter ?key=
  // Example: ["sk-gemini", "sk-my-custom-key"]
  apiKeys: ['sk-gemini'],

  // ---- Cookie Authentication ----
  // Gemini enforces strict rate limits on anonymous requests (prone to triggering 429 Too Many Requests)
  // Providing valid cookies can significantly improve stability and reduce the probability of being rate-limited
  // cookieString: Complete cookie string copied from the browser
  //   Format: "__Secure-1PSID=xxx; __Secure-3PSID=xxx; SAPISID=xxx; ..."
  //   Supports multiple cookies (separated by |), one is randomly selected per request
  //   Example: "cookie1| cookie2| cookie3"
  cookieString: null,
  // sapisid: SAPISID value extracted from the cookie
  //   Used to generate the SAPISIDHASH authentication header required by Google API
  //   Format: "abc123/def456"
  //   If cookieString is set but sapisid is not, the program will auto-extract it
  //   Supports multiple (separated by |), corresponding to cookies
  //   Example: "sapisid1| sapisid2| sapisid3"
  sapisid: null,

  // ---- Log Switch ----
  // Whether to output request logs to the console
  // It is recommended to keep this enabled in production for troubleshooting
  // Log format: [HH:MM:SS] [LEVEL] message
  logRequests: true,

  // ---- Rate Limiting ----
  // Request frequency control at the Cloudflare Workers level
  // Used to prevent abuse and protect the upstream Gemini API
  rateLimit: {
    // Whether to enable rate limiting
    enabled: true,
    // Maximum number of requests within the time window
    // Default 3000, set to a higher value to prevent normal usage from being limited
    // If you encounter abuse, you can lower this value (e.g. 30-100)
    maxRequests: 3000,
    // Time window size (seconds)
    // 60 means at most maxRequests requests are allowed per minute
    windowSec: 60,
  },

  // ---- Fingerprint Rotation Configuration ----
  // Maximum random delay before the request (milliseconds)
  // Simulates human operation intervals, reducing the probability of being detected as an automated request
  // Default 1500ms (1.5 seconds); set to 0 to disable
  // Works best in combination with User-Agent rotation
  fingerprintJitterMs: 1500,
};

// ============================================================================
// Multi-Fingerprint Rotation Pool
// ============================================================================
// The following fingerprint pools are used to randomly select different browser identifiers for each request.
// The purpose is to make each request appear to come from a different browser and device,
// reducing the probability of being identified as an automated script by the Gemini server.

/**
 * User-Agent Rotation Pool
 * 
 * Contains 8 real browser User-Agent strings.
 * Covers Windows, macOS, and Linux platforms.
 * Covers Chrome 125-127, Firefox 128, Safari 17.4, and other mainstream browser versions.
 * 
 * Each UA has a corresponding weight (UA_WEIGHTS) for weighted random selection.
 * Weights simulate real browser market share distribution:
 *   - Chrome Windows: ~65% (two versions combined)
 *   - Safari macOS: ~8%
 *   - Chrome macOS: ~10%
 *   - Chrome Linux: ~7%
 *   - Firefox all platforms: ~10% (three versions combined)
 * 
 * The weight array corresponds one-to-one with the USER_AGENTS array, totaling 100.
 */

var USER_AGENTS = [
  // Chrome 127 on Windows 10/11 (highest share, ~35%)
  // This is currently the most mainstream browser configuration
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  // Chrome 126 on Windows 10/11 (~30%)
  // The previous version of Chrome, still with many users not updated
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  // Safari 17.4 on macOS 14.5 (~8%)
  // Mac users use the built-in browser
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  // Chrome 127 on macOS 14.5 (~10%)
  // Mac users install Chrome browser
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  // Chrome 127 on Linux (~7%)
  // Linux desktop users (developer community)
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  // Firefox 128 on Windows (~5%)
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  // Firefox 128 on macOS (~3%)
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:128.0) Gecko/20100101 Firefox/128.0',
  // Firefox 128 on Linux (~2%)
  'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
];

// Weight array, one-to-one correspondence with USER_AGENTS
// Total = 35 + 30 + 8 + 10 + 7 + 5 + 3 + 2 = 100
// Simulates real browser market share: Chrome ~72%, Safari ~8%, Firefox ~10%
var UA_WEIGHTS = [35, 30, 8, 10, 7, 5, 3, 2];

/**
 * Weighted random selection of User-Agent
 * 
 * Algorithm steps:
 * 1. Calculate the sum of all weights (totalWeight = 100)
 * 2. Generate a random float between 0 and totalWeight
 * 3. Accumulate weights from the beginning, when the cumulative value exceeds the random number
 * 4. Return the User-Agent at the current index
 * 
 * This algorithm ensures that higher-weight UAs have a higher probability of being selected.
 * 
 * @returns {string} Randomly selected User-Agent string
 */
function getRandomUserAgent() {
  // Step 1: Calculate total weight
  var totalWeight = 0;
  for (var i = 0; i < UA_WEIGHTS.length; i++) {
    totalWeight += UA_WEIGHTS[i];
  }
  // Step 2: Generate a random number between 0 and total weight
  var random = Math.random() * totalWeight;
  // Step 3: Accumulate weights, find which interval the random number falls into
  var cumulative = 0;
  for (var j = 0; j < USER_AGENTS.length; j++) {
    cumulative += UA_WEIGHTS[j];
    // When the cumulative value exceeds the random number, return the current UA
    if (random < cumulative) {
      return USER_AGENTS[j];
    }
  }
  // Fallback: if no match due to floating point precision, return the first
  return USER_AGENTS[0];
}

/**
 * Accept-Language Rotation Pool
 * 
 * Contains 6 different browser language preference settings.
 * Simulates browser configurations of users from different regions.
 * Primarily English (US/UK), some include Chinese, Japanese, Korean, Spanish as secondary languages.
 * 
 * q values represent priority weights:
 *   - q=0.9 means high priority for secondary language
 *   - Primary language has no q value (defaults to 1.0)
 */
var ACCEPT_LANGUAGES = [
  'en-US,en;q=0.9',              // English-only users (US), most common configuration
  'en-US,en;q=0.9,zh-CN;q=0.8',  // Primarily English with Chinese secondary (Chinese-American or Chinese students)
  'en-GB,en;q=0.9',              // British English users (UK/Commonwealth)
  'en-US,en;q=0.9,ja;q=0.8',     // Primarily English with Japanese secondary (Japanese or Japanese learners)
  'en-US,en;q=0.9,ko;q=0.8',     // Primarily English with Korean secondary (Korean or Korean learners)
  'en-US,en;q=0.9,es;q=0.8',     // Primarily English with Spanish secondary (Latino)
];

/**
 * Randomly select Accept-Language
 * Uses uniform random distribution (each language preference has equal probability of being selected)
 * @returns {string} Randomly selected Accept-Language string
 */
function getRandomAcceptLanguage() {
  var idx = Math.floor(Math.random() * ACCEPT_LANGUAGES.length);
  return ACCEPT_LANGUAGES[idx];
}

/**
 * Sec-Ch-Ua Rotation Pool (Chrome User Agent Client Hints)
 * 
 * Sec-Ch-Ua is an additional request header sent by Chrome browsers (Chromium-based),
 * containing browser brand and version information. Only Chrome-family browsers send this header.
 * Firefox and Safari do not send this header.
 * 
 * Format: "Brand";v="MajorVersion"
 * - "Not)A;Brand";v="99" is a Chromium fixed identifier
 * - "Google Chrome";v="127" indicates Chrome major version number
 * - "Chromium";v="127" indicates Chromium kernel version number
 */
var SEC_CH_UA_POOLS = [
  // Chrome 127
  '"Not)A;Brand";v="99", "Google Chrome";v="127", "Chromium";v="127"',
  // Chrome 126
  '"Not)A;Brand";v="99", "Google Chrome";v="126", "Chromium";v="126"',
  // Chrome 125
  '"Not)A;Brand";v="99", "Google Chrome";v="125", "Chromium";v="125"',
];

/**
 * Sec-Ch-Ua-Platform Rotation Pool (OS platform identifier)
 * 
 * Used together with Sec-Ch-Ua to identify the browser's operating system platform.
 * Should match the platform information in the User-Agent.
 */
var SEC_CH_UA_PLATFORMS = [
  '"Windows"',   // Windows platform
  '"macOS"',     // macOS platform (mind case sensitivity)
  '"Linux"',     // Linux platform
];

/**
 * Randomly select Sec-Ch-Ua (Chrome version identifier)
 * @returns {string} Randomly selected Sec-Ch-Ua string
 */
function getRandomSecChUa() {
  var idx = Math.floor(Math.random() * SEC_CH_UA_POOLS.length);
  return SEC_CH_UA_POOLS[idx];
}

/**
 * Randomly select Sec-Ch-Ua-Platform (OS platform identifier)
 * @returns {string} Randomly selected platform string
 */
function getRandomSecChUaPlatform() {
  var idx = Math.floor(Math.random() * SEC_CH_UA_PLATFORMS.length);
  return SEC_CH_UA_PLATFORMS[idx];
}

// ============================================================================
// 🤖 Model Definitions
// ============================================================================
// Mapped from the MODE_CATEGORY enum in Gemini Web frontend JS source code
// 
// mode field meaning (MODE_CATEGORY enum values):
//   1 = FAST (fast mode) - Gemini Flash series, fastest
//   2 = THINKING (deep thinking) - Enables deep reasoning, higher output quality
//   3 = PRO (professional) - Most powerful model, requires valid Cookie for correct routing
//   4 = AUTO (automatic) - Gemini automatically selects the most suitable model
//   5 = FAST_DYNAMIC_THINKING (dynamic thinking) - Adaptive thinking depth
//   6 = FLASH_LITE (lightweight fast) - Lightest model, fastest but lower quality
// 
// think field meaning (thinking mode):
//   0 = Enable deep thinking (model spends more time reasoning)
//   4 = AUTO (automatically select thinking depth, decided by Gemini)

var MODELS = {
  'gemini-3.6-flash': {
    mode: 1,        // FAST - fast mode
    think: 4,       // AUTO - automatically select thinking depth
    desc: 'Latest all-around model (Gemini 3.6 Flash)',
  },
  'gemini-3.5-flash': {
    mode: 1,        // FAST
    think: 4,       // AUTO
    desc: 'Alias for gemini-3.6-flash (backend upgraded)',
  },
  'gemini-3.5-flash-thinking': {
    mode: 2,        // THINKING - deep thinking mode
    think: 0,       // Enable deep thinking
    desc: 'Deep thinking mode, longest output (~20k chars)',
  },
  'gemini-3.1-pro': {
    mode: 3,        // PRO - professional
    think: 4,       // AUTO
    desc: 'Pro model (requires cookie for real routing)',
  },
  'gemini-auto': {
    mode: 4,        // AUTO - automatic model selection
    think: 4,       // AUTO
    desc: 'Auto model selection',
  },
  'gemini-3.5-flash-thinking-lite': {
    mode: 5,        // FAST_DYNAMIC_THINKING - dynamic thinking
    think: 0,       // Enable thinking
    desc: 'Dynamic thinking with adaptive depth',
  },
  'gemini-flash-lite': {
    mode: 6,        // FLASH_LITE - lightweight fast
    think: 4,       // AUTO
    desc: 'Lightweight fast model',
  },
};

// ============================================================================
// 🔑 Core: Request-level config generator (solves concurrency crosstalk + multi-Cookie rotation + fingerprint rotation)
// ============================================================================

/**
 * Creates an independent configuration copy for the current request
 * 
 * [Why is this function needed? -- Concurrency crosstalk problem]
 * Cloudflare Workers uses Isolate (sandboxed environment) to process each request.
 * Cold start: Global code re-executes, all variables are reinitialized.
 * Hot start: Existing Isolate is reused, global code does not execute,
 * variables retain the values modified by the previous request.
 * 
 * When clients like WorkBuddy send 5-20 concurrent requests in a very short time,
 * these requests may be assigned to the same Isolate, sharing global variables.
 * 
 * Example illustrating the crosstalk process:
 *   Request A arrives -> CONFIG.cookieString = "cookie_a"
 *   Request B arrives -> CONFIG.cookieString = "cookie_b"  <-- overwrites A setting!
 *   Request A continues execution -> uses "cookie_b" <-- crosstalk!
 * 
 * [How to solve? -- Request-level config isolation]
 * 1. Call this function on each request to create a brand new config object from DEFAULT_CONFIG template
 * 2. Read customized config from env (env variables, independently injected by CF platform per request)
 * 3. All subsequent functions receive config via parameter, completely no reliance on global state
 * 4. Use explicit assignment (env.X || null) to prevent value residue from Isolate reuse
 * 
 * [Multi-Cookie Rotation]
 * If environment variables use | to separate multiple Cookies and SAPISIDs,
 * each request randomly selects one combination to use.
 * This can significantly reduce the probability of a single Google account being rate-limited.
 * 
 * [Environment variable format]
 * COOKIE_STRING = "cookie_account1| cookie_account2| cookie_account3"
 * SAPISID = "sapisid_1| sapisid_2| sapisid_3"
 * 
 * @param {Object} env - Cloudflare Worker environment variables (independent per request)
 * @returns {Object} Configuration copy exclusive to the current request
 */
function getRequestConfig(env) {
  // Create a brand new config object from the default template
  // Manually copy field by field, ensuring each field is an independent primitive copy
  // Do not use spread operator (...DEFAULT_CONFIG) to avoid reference sharing issues
  var config = {
    // ---- Basic config fields ----
    retryAttempts: DEFAULT_CONFIG.retryAttempts,
    retryDelaySec: DEFAULT_CONFIG.retryDelaySec,
    requestTimeoutSec: DEFAULT_CONFIG.requestTimeoutSec,
    geminiBl: DEFAULT_CONFIG.geminiBl,
    authUser: DEFAULT_CONFIG.authUser,
    xsrfToken: DEFAULT_CONFIG.xsrfToken,
    defaultModel: DEFAULT_CONFIG.defaultModel,
    apiKeys: DEFAULT_CONFIG.apiKeys,
    cookieString: DEFAULT_CONFIG.cookieString,
    sapisid: DEFAULT_CONFIG.sapisid,
    logRequests: DEFAULT_CONFIG.logRequests,
    fingerprintJitterMs: DEFAULT_CONFIG.fingerprintJitterMs,

    // ---- Nested object: rateLimit needs deep copy ----
    // Because rateLimit is an object, it cannot be directly assigned (will share reference)
    // Need to create a new object and copy field by field
    rateLimit: {
      enabled: DEFAULT_CONFIG.rateLimit.enabled,
      maxRequests: DEFAULT_CONFIG.rateLimit.maxRequests,
      windowSec: DEFAULT_CONFIG.rateLimit.windowSec,
    },
  };

  // ================================================================
  // Environment variable override
  // env is the environment variable object independently provided by Cloudflare for each request
  // These values are configured in CF Dashboard and take effect automatically after modification
  // ================================================================

  // ---- String type: override only if value exists (keep default as fallback) ----
  if (env.GEMINI_BL) {
    config.geminiBl = env.GEMINI_BL;
  }
  if (env.DEFAULT_MODEL) {
    config.defaultModel = env.DEFAULT_MODEL;
  }

  // ---- Auth-related fields: use || operator to ensure explicit override ----
  // These fields may be null or empty string
  // Use || null to ensure that even if env value is undefined or empty string,
  // it will be explicitly set to null, preventing previous request value residue from Isolate reuse
  config.authUser = env.AUTH_USER || null;
  config.xsrfToken = env.XSRF_TOKEN || null;

  // ================================================================
  // 🎭 Multi-Cookie rotation support
  // ================================================================
  // Split the string in env variable by | into an array
  // Filter out empty strings (handles consecutive | or leading/trailing |)
  // 
  // Environment variable format examples:
  //   COOKIE_STRING = "cookie_account1| cookie_account2| cookie_account3"
  //   SAPISID = "sapisid_1| sapisid_2| sapisid_3"
  // 
  // If there is only 1 element after splitting, it is equivalent to a single Cookie

  var cookieStrings = (env.COOKIE_STRING || '').split('|').filter(function (c) {
    return c.trim();  // Filter out empty strings
  });
  var sapisids = (env.SAPISID || '').split('|').filter(function (s) {
    return s.trim();  // Filter out empty strings
  });

  // Case 1: Multiple Cookies available for selection
  if (cookieStrings.length > 0) {
    // Randomly select a Cookie index
    var cookieIdx = Math.floor(Math.random() * cookieStrings.length);
    config.cookieString = cookieStrings[cookieIdx].trim();

    // If SAPISID count matches Cookie count, use the indexed SAPISID
    // This maintains the correspondence between Cookie and SAPISID
    if (sapisids.length === cookieStrings.length) {
      config.sapisid = sapisids[cookieIdx].trim();
    } else if (sapisids.length > 0) {
      // If counts do not match, randomly select a SAPISID
      var sapisidIdx = Math.floor(Math.random() * sapisids.length);
      config.sapisid = sapisids[sapisidIdx].trim();
    }
    // If only one SAPISID or no SAPISID, leave for later auto-extraction logic
  }
  // Case 2: Only SAPISID, no Cookie
  else if (sapisids.length > 0) {
    // Randomly select a SAPISID
    var sapisidIdx = Math.floor(Math.random() * sapisids.length);
    config.sapisid = sapisids[sapisidIdx].trim();
  }
  // Case 3: Neither Cookie nor SAPISID
  // config.cookieString and config.sapisid remain default null

  // ================================================================
  // 🛡️ Smart compatibility: Auto-extract SAPISID from COOKIE_STRING
  // ================================================================
  // If final SAPISID is empty but Cookie is not empty,
  // Try to extract SAPISID value via regex match from Cookie string
  // 
  // Cookie format example:
  //   "__Secure-1PSID=AJDrVf...; __Secure-3PSID=AJDrVf...; SAPISID=abc123/def456; ..."
  // 
  // Regex /SAPISID=([^;]+)/ meaning:
  //   SAPISID=   matches literal "SAPISID="
  //   ([^;]+)    capture group: matches one or more non-semicolon characters (i.e. the SAPISID value)
  if (!config.sapisid && config.cookieString) {
    var match = config.cookieString.match(/SAPISID=([^;]+)/);
    if (match) {
      // match[1] is the first capture group, i.e. the SAPISID value
      // trim() removes potential leading/trailing whitespace
      config.sapisid = match[1].trim();
    }
  }

  // ---- API keys: JSON array format, requires special parsing ----
  // env.API_KEYS is a string type, e.g. '["sk-gemini", "sk-my-key"]'
  // Needs to be parsed with JSON.parse into a real array
  if (env.API_KEYS) {
    try {
      config.apiKeys = JSON.parse(env.API_KEYS);
    } catch (e) {
      // Keep default value when JSON parsing fails
      // Log error but do not interrupt program execution
      console.error('[ERROR] API_KEYS 解析失败: ' + e.message + '，使用默认值');
    }
  }

  // ---- Numeric fields: require parseInt conversion ----
  // Environment variables in env are all string type
  // Need to use parseInt(value, 10) to convert to decimal integer
  // Use isNaN() to check conversion result, prevent invalid values
  if (env.RETRY_ATTEMPTS) {
    var ra = parseInt(env.RETRY_ATTEMPTS, 10);
    if (!isNaN(ra)) config.retryAttempts = ra;
  }
  if (env.RETRY_DELAY_SEC) {
    var rd = parseInt(env.RETRY_DELAY_SEC, 10);
    if (!isNaN(rd)) config.retryDelaySec = rd;
  }
  if (env.REQUEST_TIMEOUT_SEC) {
    var rt = parseInt(env.REQUEST_TIMEOUT_SEC, 10);
    if (!isNaN(rt)) config.requestTimeoutSec = rt;
  }
  // Fingerprint rotation random delay config
  if (env.FINGERPRINT_JITTER_MS) {
    var fj = parseInt(env.FINGERPRINT_JITTER_MS, 10);
    if (!isNaN(fj)) config.fingerprintJitterMs = fj;
  }

  // ---- Rate limit config ----
  if (env.RATE_LIMIT_MAX) {
    var rlmax = parseInt(env.RATE_LIMIT_MAX, 10);
    if (!isNaN(rlmax)) config.rateLimit.maxRequests = rlmax;
  }
  if (env.RATE_LIMIT_WINDOW) {
    var rlwin = parseInt(env.RATE_LIMIT_WINDOW, 10);
    if (!isNaN(rlwin)) config.rateLimit.windowSec = rlwin;
  }

  // Return request-specific config copy
  // This object is recycled with the Isolate after the request ends
  return config;
}

// ============================================================================
// 🛠 Utility functions
// ============================================================================

/**
 * Logging function
 * 
 * Controls whether to output logs using the logRequests switch in request-level config.
 * If no config parameter is passed (e.g. called within getRequestConfig),
 * uses the logRequests setting from DEFAULT_CONFIG.
 * 
 * Log format: [HH:MM:SS] [LEVEL] message
 * Example: [14:30:25] [INFO] Chat: model=gemini-3.6-flash, stream=true
 * 
 * @param {string} msg - The log message to record
 * @param {string} [level] - Log level, default 'INFO'. Options: INFO / WARN / ERROR
 * @param {Object} [config] - Request-level config object (optional, for concurrency safety)
 */
function log(msg, level, config) {
  // If no log level is specified, default to INFO
  level = level || 'INFO';
  // Decide whether to output logs based on config parameter
  // Use config.logRequests when config is available, otherwise use default config
  var shouldLog = config ? config.logRequests : DEFAULT_CONFIG.logRequests;
  if (shouldLog) {
    // Generate timestamp, format: HH:MM:SS
    // toISOString() returns "2026-07-30T14:30:25.123Z"
    // split('T')[1] gets "14:30:25.123Z"
    // split('.')[0] gets "14:30:25"
    var ts = new Date().toISOString().split('T')[1].split('.')[0];
    console.log('[' + ts + '] [' + level + '] ' + msg);
  }
}

/**
 * Generate UUID v4 (Universally Unique Identifier)
 * 
 * UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 * Where 4 is fixed as the version number, and y's high bits are fixed to 10xx (indicating variant)
 * 
 * Cloudflare Workers environment preferentially uses the built-in crypto.randomUUID() method.
 * If unavailable (older versions or other environments), use Math.random() fallback.
 * The fallback has weaker randomness, not suitable for security-sensitive scenarios.
 * 
 * @returns {string} UUID v4 formatted string, e.g. "550e8400-e29b-41d4-a716-446655440000"
 */
function generateUUID() {
  // Prefer CF Workers built-in method (better performance, stronger randomness)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback: Manually generate a string conforming to UUID v4 specification
  // Use Math.random() to generate pseudo-random numbers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    // Generate a random integer 0-15
    var r = Math.random() * 16 | 0;
    // x position uses random value directly
    // y position ensures high bits are 10xx (conforming to UUID v4 spec: 10xx = 8,9,a,b)
    var v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Generate short ID
 * 
 * Extract the first length hex characters from UUID (removing hyphens).
 * Used for generating chat completion IDs, tool call IDs, request IDs, etc. where a full UUID is not needed.
 * 
 * @param {number} [length] - Desired ID length, default 12 characters
 * @returns {string} Short ID string, e.g. "a1b2c3d4e5f6"
 */
function generateShortId(length) {
  var len = length || 12;
  // Remove hyphens from UUID, take first len characters
  return generateUUID().replace(/-/g, '').substring(0, len);
}

/**
 * Get current Unix timestamp (seconds)
 * 
 * Unix timestamp is the number of seconds since 1970-01-01 00:00:00 UTC.
 * Widely used in the created field of API responses.
 * 
 * @returns {number} Unix timestamp (seconds), e.g. 1753872000
 */
function timestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Estimate the number of tokens in text
 * 
 * Uses a simple heuristic algorithm for rough estimation:
 * - English approximately 4 characters = 1 token
 * - This estimate is not precise but sufficient for basic resource estimation and log display
 * - Not a precise calculation, for reference only
 * 
 * @param {string} text - The text to estimate
 * @returns {number} Estimated token count, at least 1
 */
function estimateTokens(text) {
  if (!text) return 0;
  // At least return 1 to avoid division by zero error
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Generate SAPISID authentication hash
 * 
 * Google API uses time-based SHA-1 hash for authentication.
 * This hash proves the request comes from a user with a valid Google session.
 * 
 * Algorithm steps:
 * 1. Get current Unix timestamp (seconds)
 * 2. Construct input string: "{timestamp} {sapisid} https://gemini.google.com"
 * 3. Hash the input using SHA-1 algorithm
 * 4. Convert the hash result to hexadecimal string
 * 5. Return formatted string: "SAPISIDHASH {timestamp}_{hex_hash}"
 * 
 * Format example: SAPISIDHASH 1753872000_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0
 * 
 * @param {string} sapisid - SAPISID value extracted from Google Cookie
 * @returns {Promise<string>} Authentication hash string
 */
async function makeSapisidHash(sapisid) {
  // Get current timestamp
  var ts = timestamp();
  // Construct hash input (exactly matching Google Web frontend format)
  var input = ts + ' ' + sapisid + ' https://gemini.google.com';

  // Encode input string to UTF-8 byte array
  var encoder = new TextEncoder();
  var data = encoder.encode(input);

  // Use Web Crypto API for SHA-1 hashing
  var hashBuffer = await crypto.subtle.digest('SHA-1', data);

  // Convert hash result (ArrayBuffer) to hexadecimal string
  var hashArray = Array.from(new Uint8Array(hashBuffer));
  var hashHex = hashArray.map(function (b) {
    // Each byte converted to two hexadecimal digits
    return b.toString(16).padStart(2, '0');
  }).join('');

  // Return formatted authentication string
  return 'SAPISIDHASH ' + ts + '_' + hashHex;
}

/**
 * Get multi-account URL prefix
 * 
 * Google supports logging into multiple Google accounts in the same browser.
 * When using non-default accounts, the Gemini URL path includes account index:
 * - Default account: https://gemini.google.com/app
 * - Second account: https://gemini.google.com/u/1/app
 * - Third account: https://gemini.google.com/u/2/app
 * 
 * @param {Object} config - Request-level config object
 * @returns {string} URL prefix like "/u/1", empty string "" for default account
 */
function getAccountPrefix(config) {
  var authUser = config.authUser;
  // If authUser is null, undefined, or empty string, use default account
  if (authUser === null || authUser === undefined || authUser === '') {
    return '';
  }
  // Return account prefix with leading slash
  return '/u/' + authUser;
}

// ============================================================================
// 📡 Gemini API Request Building
// ============================================================================
// Gemini's internal API uses complex nested array structures.
// The following functions build request payloads and headers exactly matching Gemini Web frontend.
// This is the foundation for the entire program to work correctly.

/**
 * Build Gemini API request payload
 * 
 * Gemini internally uses a nested array of 80 elements as the request body.
 * This structure was obtained through reverse engineering of Gemini Web frontend JS code.
 * 
 * Key field descriptions:
 *   inner[0]: User message and metadata
 *     [prompt, message index, image data, attachment info, metadata, context ID, is new conversation]
 *   inner[1]: Language setting ["en"]
 *   inner[2]: Conversation context (empty means new conversation)
 *   inner[6]: Continuous conversation flag [0]
 *   inner[7]: Streaming output flag 1
 *   inner[10]: Streaming output flag 1
 *   inner[11]: Safety filter level (0=basic, 1=strict, 2=strictest)
 *   inner[17]: Thinking mode [[thinkMode]]
 *     thinkMode=0: Enable deep thinking
 *     thinkMode=4: Automatic selection
 *   inner[18]: Extended thinking flag 0
 *   inner[30]: Output format [4]
 *   inner[41]: Response type [2]
 *   inner[59]: Unique request ID (UUID v4)
 *   inner[61]: Attachment list []
 *   inner[79]: Model selection (MODE_CATEGORY enum value) ⭐ Most critical field
 *     1=FAST, 2=THINKING, 3=PRO, 4=AUTO, 5=FAST_DYNAMIC_THINKING, 6=FLASH_LITE
 * 
 * Values at other index positions are null, meaning default settings are used.
 * 
 * Outer wrapper:
 *   outer = [null, json.dumps(inner)]
 *   Then URL-encoded as the value of the f.req parameter
 * 
 * @param {string} prompt - User input prompt text
 * @param {number} modelId - Model category ID (MODE_CATEGORY enum values: 1-6)
 * @param {number} thinkMode - Thinking mode setting (0=deep thinking, 4=automatic)
 * @param {Object} config - Request-level config object
 * @returns {string} URL-encoded request body string, format "f.req=..."
 */
function buildPayload(prompt, modelId, thinkMode, config) {
  // Create an array of 80 elements, all initialized to null
  // This is the data structure actually used by Gemini Web frontend
  var inner = new Array(80).fill(null);

  // --- User message ---
  // [prompt, message index, image, attachment, metadata, context ID, new conversation flag]
  inner[0] = [prompt, 0, null, null, null, null, 0];

  // --- Language set to English ---
  inner[1] = ['en'];

  // --- Conversation context ---
  // All empty means new conversation, no history used
  inner[2] = ['', '', '', null, null, null, null, null, null, ''];

  // --- Continuous conversation flag ---
  inner[6] = [0];

  // --- Streaming output flag ---
  inner[7] = 1;    // Enable streaming
  inner[10] = 1;   // Streaming output

  // --- Safety filter level ---
  // 0 = Basic filter (recommended, will not over-block normal content)
  // 1 = Strict filter (may false-block)
  // 2 = Strictest filter (very conservative)
  inner[11] = 0;

  // --- Thinking mode config ---
  // Nested double array: [[thinkMode]]
  // Outer array contains one inner array, inner array contains thinkMode value
  inner[17] = [[thinkMode]];

  // --- Extended thinking flag ---
  inner[18] = 0;

  // --- Various internal parameters ---
  // These parameters' specific meanings are unknown but kept consistent with Gemini Web frontend
  inner[27] = 1;   // Unknown flag
  inner[30] = [4]; // Output format setting
  inner[41] = [2]; // Response type setting
  inner[53] = 0;   // Unknown flag

  // --- Unique request ID ---
  // Use UUID v4 to ensure a globally unique identifier for each request
  inner[59] = generateUUID();

  // --- Attachment list ---
  // Empty array means no attachments
  inner[61] = [];

  // --- Other settings ---
  inner[68] = 1;   // Unknown flag

  // ⭐ Model selection (most critical field)
  // MODE_CATEGORY enum values:
  //   1=FAST (fast), 2=THINKING (deep thinking), 3=PRO (professional)
  //   4=AUTO (automatic), 5=FAST_DYNAMIC_THINKING, 6=FLASH_LITE
  inner[79] = modelId;

  // --- Outer wrapper ---
  // Gemini's request body is double-nested JSON:
  // Outer: [null, inner_json_string]
  var outer = [null, JSON.stringify(inner)];

  // --- Build URL-encoded parameters ---
  var params = new URLSearchParams();
  // Main data goes in f.req parameter
  params.append('f.req', JSON.stringify(outer));

  // Optional: Add XSRF token
  // Usually not needed, but may be required by Gemini in extreme cases
  if (config.xsrfToken) {
    params.append('at', config.xsrfToken);
  }

  // Return URL-encoded string
  // Example: f.req=%5Bnull%2C%22%5B%5B...%5D%5D%22%5D
  return params.toString();
}

/**
 * Build Gemini API request URL
 * 
 * URL format:
 * https://gemini.google.com{prefix}/_/BardChatUi/data/
 *   assistant.lamda.BardFrontendService/StreamGenerate
 *   ?bl={build_label}&hl=en&_reqid={request_id}&rt=c
 * 
 * Parameter description:
 * - bl (build label): Gemini frontend build version identifier, used for API version control
 * - hl (host language): Interface language, fixed to en (English)
 * - _reqid: Request ID, using last 6 digits of timestamp
 * - rt: Request type, c means normal chat request
 * 
 * @param {Object} config - Request-level config object
 * @returns {string} Complete request URL
 */
function buildUrl(config) {
  // Get multi-account URL prefix
  var prefix = getAccountPrefix(config);
  // Generate request ID (using last 6 digits of timestamp)
  // Example: timestamp() = 1753872000 → reqid = 872000
  var reqid = timestamp() % 1000000;
  // Concatenate complete URL
  return 'https://gemini.google.com' + prefix +
    '/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate' +
    '?bl=' + config.geminiBl +
    '&hl=en' +
    '&_reqid=' + reqid +
    '&rt=c';
}

/**
 * Build Gemini API request headers (includes multi-fingerprint rotation)
 * 
 * 🎭 Multi-fingerprint rotation mechanism:
 * When this function is called, a different browser fingerprint combination is randomly selected:
 * - User-Agent: Weighted random selection from 8 real browser UAs
 * - Accept-Language: Uniform random selection from 6 language preferences
 * - Sec-Ch-Ua: If Chrome UA is selected, randomly select Chrome version identifier
 * - Sec-Ch-Ua-Platform: Randomly select OS platform
 * 
 * This makes each request appear to come from a different browser and device,
 * reducing the probability of being identified as an automated script by the Gemini server.
 * 
 * Note: Firefox and Safari do not send Sec-Ch-Ua series headers,
 * so these headers are only added when UA is Chrome.
 * 
 * @param {Object} config - Request-level config object
 * @returns {Promise<Object>} HTTP request header object
 */
async function buildHeaders(config) {
  // Get multi-account URL prefix
  var prefix = getAccountPrefix(config);

  // 🎭 Step 1: Randomly select browser fingerprint
  var selectedUA = getRandomUserAgent();           // Weighted random selection of User-Agent
  var selectedLanguage = getRandomAcceptLanguage(); // Uniform random selection of language preference

  // Step 2: Build base request headers
  var headers = {
    // Standard form submission format (matches browser form submission)
    'Content-Type': 'application/x-www-form-urlencoded',
    // Declare request origin domain (must be gemini.google.com)
    'Origin': 'https://gemini.google.com',
    // Declare referring page
    'Referer': 'https://gemini.google.com' + prefix + '/app',
    // Same-origin request flag (tells Gemini this is an internal request)
    'X-Same-Domain': '1',
    // 🔑 Use randomly selected User-Agent
    'User-Agent': selectedUA,
    // Accept any response type
    'Accept': '*/*',
    // 🔑 Use randomly selected Accept-Language
    'Accept-Language': selectedLanguage,
    // Browser security policy header (standard behavior of modern browsers)
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
  };

  // 🎭 Step 3: If Chrome UA, add Sec-Ch-Ua series headers
  // Method: Check if User-Agent string contains "Chrome"
  // Firefox UA contains "Gecko" and "Firefox", does not contain "Chrome"
  // Safari UA contains "Safari" but does not contain "Chrome"
  if (selectedUA.indexOf('Chrome') !== -1) {
    headers['Sec-Ch-Ua'] = getRandomSecChUa();              // Chrome version identifier
    headers['Sec-Ch-Ua-Mobile'] = '?0';                      // Desktop (not mobile)
    headers['Sec-Ch-Ua-Platform'] = getRandomSecChUaPlatform(); // OS platform
  }

  // Step 4: Multi-account support
  // If non-default account is used (authUser is not empty), add auth user header
  if (prefix) {
    headers['X-Goog-AuthUser'] = String(config.authUser);
  }

  // Step 5: Cookie authentication (if available)
  // Providing valid cookies can significantly improve request stability
  // Reduce probability of 429 (rate limit) and 403 (forbidden) errors
  if (config.cookieString) {
    headers['Cookie'] = config.cookieString;
  }

  // Step 6: SAPISID authentication hash (if available)
  // Generate time-based SHA-1 hash proving request comes from valid Google session
  // Format: SAPISIDHASH {timestamp}_{sha1_hex_hash}
  if (config.sapisid) {
    headers['Authorization'] = await makeSapisidHash(config.sapisid);
  }

  return headers;
}

// ============================================================================
// 📡 Non-streaming API call
// ============================================================================

/**
 * Non-streaming call to Gemini API
 * 
 * Sends request to Gemini StreamGenerate endpoint and waits for complete response.
 * Supports automatic retry, exponential backoff, detailed error handling.
 * 
 * [Retry Strategy]
 * Uses exponential backoff algorithm:
 * - First retry: wait retryDelaySec * 2^0 = 2 seconds
 * - Second retry: wait retryDelaySec * 2^1 = 4 seconds
 * - Third retry: wait retryDelaySec * 2^2 = 8 seconds
 * 
 * [Error Handling]
 * - 405: BL version expired, need to update geminiBl config
 * - 429: Request rate limited, wait Retry-After seconds then retry
 * - 403: Valid Cookie authentication required
 * - Other: Log error and retry
 * 
 * 🎭 [Fingerprint Rotation]
 * Request headers are rebuilt on each retry, using different browser fingerprints.
 * This increases the chance of retry success, as different fingerprints may pass different rate-limit rules.
 * 
 * 🎭 [Random Delay]
 * A random delay between 0 and fingerprintJitterMs is added before the request.
 * Simulates natural intervals of human operation, reducing probability of being detected as a script.
 * 
 * @param {string} prompt - User input prompt text
 * @param {number} modelId - Model category ID (MODE_CATEGORY enum values: 1-6)
 * @param {number} thinkMode - Thinking mode setting (0=deep thinking, 4=automatic)
 * @param {Object} config - Request-level config object
 * @returns {Promise<string>} API raw response text (includes nested JSON)
 * @throws {Error} Throws last error after all retries fail
 */
async function geminiStreamGenerate(prompt, modelId, thinkMode, config) {
  // 🎭 Add small random delay before request (simulates human operation interval)
  // Delay time is randomly and uniformly distributed between 0 and fingerprintJitterMs ms
  // When fingerprintJitterMs=1500, delay is between 0 and 1.5 seconds
  if (config.fingerprintJitterMs > 0) {
    var jitter = Math.random() * config.fingerprintJitterMs;
    await new Promise(function (resolve) { setTimeout(resolve, jitter); });
  }

  // Build request payload, headers, URL
  var body = buildPayload(prompt, modelId, thinkMode, config);
  var headers = await buildHeaders(config);
  var url = buildUrl(config);

  // Save last error, throw after all retries fail
  var lastError;

  // Retry loop
  for (var attempt = 0; attempt < config.retryAttempts; attempt++) {
    try {
      // 🎭 Rebuild request headers on retry (using different browser fingerprints)
      // This increases the chance of retry success
      if (attempt > 0) {
        headers = await buildHeaders(config);
        // Also add new random delay on retry
        // Avoid retrying at exactly the same time
        if (config.fingerprintJitterMs > 0) {
          var retryJitter = Math.random() * config.fingerprintJitterMs;
          await new Promise(function (resolve) { setTimeout(resolve, retryJitter); });
        }
      }

      // Create AbortController for timeout control
      var controller = new AbortController();
      var timeout = setTimeout(function () {
        controller.abort();  // Abort request after timeout
      }, config.requestTimeoutSec * 1000);

      // Send HTTP POST request
      var response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: body,
        signal: controller.signal,  // Associate abort signal
      });

      // Request succeeded, clear timeout timer
      clearTimeout(timeout);

      // ============================================================
      // Error status code handling
      // ============================================================

      // 405 Method Not Allowed: BL version expired
      // Gemini updated its frontend, need to update geminiBl config accordingly
      if (response.status === 405) {
        throw new Error('HTTP 405: Method Not Allowed - 可能 BL 版本过期，请更新 geminiBl');
      }

      // 429 Too Many Requests: Request rate exceeded
      // Wait server-specified Retry-After time then retry
      if (response.status === 429) {
        var retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
        log('收到 429 限流，等待 ' + retryAfter + ' 秒后重试...', 'WARN', config);
        if (attempt < config.retryAttempts - 1) {
          await new Promise(function (resolve) { setTimeout(resolve, retryAfter * 1000); });
           continue;  // Skip this, go to next retry
        }
        throw new Error('HTTP 429: Too Many Requests - 请添加有效的 Cookie 或降低请求频率');
      }

      // 403 Forbidden: Authentication required
      if (response.status === 403) {
        throw new Error('HTTP 403: Forbidden - 可能需要有效的 Cookie 认证');
      }

      // Other HTTP errors
      if (!response.ok) {
        var errorText = '';
        try {
          errorText = await response.text();
        } catch (e) {
          errorText = '无法读取错误信息';
        }
        throw new Error('HTTP ' + response.status + ': ' + errorText.substring(0, 200));
      }

      // Request succeeded, return response text
      return await response.text();

    } catch (error) {
      // Save error information
      lastError = error;

      // If retries remain, wait then retry
      if (attempt < config.retryAttempts - 1) {
        log('重试 ' + (attempt + 1) + '/' + config.retryAttempts + ': ' + error.message, 'WARN', config);
        // Exponential backoff: delay = base delay * 2^attempt
        var delay = config.retryDelaySec * Math.pow(2, attempt) * 1000;
        await new Promise(function (resolve) { setTimeout(resolve, delay); });
      }
    }
  }

  // All retries failed, throw last error
  throw lastError;
}

// ============================================================================
// 📝 Text Processing
// ============================================================================

/**
 * Clean code execution traces from Gemini response
 * 
 * Gemini sometimes includes code execution references and output blocks in the response, as follows:
 * ```python?code_reference&code_event_index=0
 * ...代码内容...
 * ```
 * ```javascript?code_stdout&code_event_index=1
 * ...输出内容...
 * ```
 * 
 * These code execution blocks are meaningless to end users and should be removed to obtain clean response text.
 * 
 * Regex explanation:
 * - ```(?:python|javascript|text): matches the three backticks and language identifier at the start of a code block
 * - \?code_(?:reference|stdout): matches code execution parameters
 * - &code_event_index=\d+: matches event index
 * - \n[\s\S]*?```: matches code block content (non-greedy) up to the closing three backticks
 * - \n?: matches optional trailing newline
 * 
 * @param {string} text - Raw response text
 * @param {boolean} [strip] - Whether to trim leading/trailing whitespace, default true
 * @returns {string} Cleaned text
 */
function cleanGeminiText(text, strip) {
  // If strip parameter is not specified, default value is true
  if (strip === undefined) strip = true;

  // Remove code execution blocks
  // Uses global replace (g flag) and multiline mode (s flag, allows . to match newlines)
  text = text.replace(
    /```(?:python|javascript|text)\?code_(?:reference|stdout)&code_event_index=\d+\n[\s\S]*?```\n?/g,
    ''
  );

  // Decide whether to trim leading/trailing whitespace based on strip parameter
  return strip ? text.trim() : text;
}

/**
 * Extract final text from Gemini API raw response
 * 
 * Gemini API returns multi-line nested JSON data, each line format:
 * [["wrb.fr", "[[...]]", ...], ...]
 * 
 * Parsing logic:
 * 1. Check for BardErrorInfo error information
 * 2. Split raw response text by line
 * 3. Skip lines that do not contain "wrb.fr" marker (non-data lines)
 * 4. Skip lines shorter than 200 characters (too short, no valid data)
 * 5. Parse JSON data of each line (double-nested structure)
 * 6. Extract text content from inner[4]
 * 7. Return the last non-empty text (usually the final complete response)
 * 
 * Data structure explanation:
 * Outer JSON array:
 *   [0]: "wrb.fr" (data marker)
 *   [1]: Reserved
 *   [2]: Inner JSON string
 * Inner JSON array:
 *   [4]: Conversation content array
 *     [*][0]: Content type
 *     [*][1]: Text array
 * 
 * @param {string} raw - Raw response text
 * @returns {string} Extracted and cleaned final text
 * @throws {Error} If BardErrorInfo error is detected
 */
function extractResponseText(raw) {
  // Step 1: Check for BardErrorInfo error
  // Format: BardErrorInfo [error code]
  // Example: BardErrorInfo [10] means request was rejected
  var bardErr = raw.match(/BardErrorInfo\s*\[(\d+)\]/);
  if (bardErr) {
    throw new Error('Gemini upstream rejected request: BardErrorInfo [' + bardErr[1] + ']');
  }

  // Step 2: Collect all extracted text fragments
  var texts = [];

  // Step 3: Split raw response by line
  var lines = raw.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // Skip lines without "wrb.fr" (not data lines)
    // Skip lines shorter than 200 (too short, no valid data)
    if (line.indexOf('"wrb.fr"') === -1 || line.length < 200) continue;

    try {
      // Step 4: Parse outer JSON
      var arr = JSON.parse(line);
          // Extract inner JSON string (arr[0][2])
      var innerStr = arr[0][2];

      // Skip empty or too short inner JSON
      if (!innerStr || innerStr.length < 50) continue;

      // Step 5: Parse inner JSON
      var inner = JSON.parse(innerStr);

      // Step 6: Check if inner[4] exists and contains content
      if (Array.isArray(inner) && inner.length > 4 && inner[4]) {
        var parts = inner[4];
        // Iterate through each part of inner[4]
        for (var j = 0; j < parts.length; j++) {
          var part = parts[j];
          // part[1] contains text data
          if (Array.isArray(part) && part.length > 1 && part[1]) {
            if (Array.isArray(part[1])) {
              var textItems = part[1];
              // Iterate through text items
              for (var k = 0; k < textItems.length; k++) {
                var t = textItems[k];
                // Collect non-empty strings
                if (typeof t === 'string' && t.length > 0) {
                  texts.push(t);
                }
              }
            }
          }
        }
      }
    } catch (e) {
      // JSON parse error, response may be incomplete
      // Continue to next line, do not interrupt the entire parsing process
    }
  }

  // Step 7: Get the last non-empty text
  // Gemini response accumulates progressively, the last text usually contains complete content
  var text = '';
  for (var m = texts.length - 1; m >= 0; m--) {
    if (texts[m].trim()) {
      text = texts[m];
      break;
    }
  }

  // Step 8: Clean code execution traces and return
  return cleanGeminiText(text);
}

// ============================================================================
// 🔄 OpenAI Format Conversion
// ============================================================================

/**
 * Convert OpenAI message list to Gemini prompt text
 * 
 * This is the "translation layer" of the entire program, responsible for converting OpenAI Chat Completions API format
 * into a plain text format that Gemini can understand.
 * 
 * Conversion rules:
 * ┌──────────────┬──────────────────────────────────────────┐
 * │ OpenAI Role  │ Gemini Format                             │
 * ├──────────────┼──────────────────────────────────────────┤
 * │ system       │ [System instruction]: {content}           │
 * │ assistant    │ [Assistant]: {content}                    │
 * │ tool         │ [Tool result for {name}]: {content}       │
 * │ user         │ {content} (use directly)                  │
 * │ tool call   │ ```tool_call\n{json}\n``` code block format  │
 * └──────────────┴──────────────────────────────────────────┘
 * 
 * Multiple messages are separated by double newlines (\n\n).
 * 
 * @param {Array} messages - OpenAI format message list
 *   Each message format: { role: string, content: string | array }
 * @param {Array} [tools] - Available tool/function definition list (optional)
 *   Each tool format: { type: "function", function: { name, description, parameters } }
 * @returns {string} Converted prompt text
 */
function messagesToPrompt(messages, tools) {
  // Array storing each message segment
  var parts = [];

  // ================================================================
  // Step 1: If tool definitions are provided, add tool usage instructions at the beginning
  // ================================================================
  if (tools && tools.length > 0) {
    // Normalize tool definition format
    // Compatible with two formats:
    //   1. { type: "function", function: { name, description, parameters } }
    //   2. { name, description, parameters } (short form)
    var toolDefs = [];
    for (var ti = 0; ti < tools.length; ti++) {
      var tool = tools[ti];
      var fn = (tool.type === 'function') ? (tool.function || tool) : tool;
      toolDefs.push({
        name: fn.name || tool.name || '',
        description: fn.description || tool.description || '',
        parameters: fn.parameters || tool.parameters || {},
      });
    }

    // Build tool usage instruction text
    // Contains:
    //   1. Tool call format description
    //   2. JSON definitions of all available tools
    parts.push(
      '[System instruction]: You have access to tools. ' +
      'To call a tool, respond with:\n' +
      '```tool_call\n{"name": "func_name", "arguments": {...}}\n```\n' +
      'Only use tool_call blocks when needed.\n\n' +
      'Available tools:\n' + JSON.stringify(toolDefs, null, 2)
    );
  }

  // ================================================================
  // Step 2: Process messages one by one
  // ================================================================
  for (var mi = 0; mi < messages.length; mi++) {
    var msg = messages[mi];
    var role = msg.role || 'user';     // Role, defaults to user
    var content = msg.content || '';    // Message content

    // If content is an array (multimodal message), extract text parts
    // Example: [{ type: "text", text: "Hello" }, { type: "image_url", ... }]
    // Only extract parts where type is "text" or "input_text"
    if (Array.isArray(content)) {
      var textParts = [];
      for (var ci = 0; ci < content.length; ci++) {
        var c = content[ci];
        if (c.type === 'text' || c.type === 'input_text') {
          textParts.push(c.text || '');
        }
      }
      content = textParts.join(' ');
    }

    // Apply different formatting based on role
    if (role === 'system') {
      // System message: Add instruction prefix
      parts.push('[System instruction]: ' + content);
    } else if (role === 'assistant') {
      // Assistant message: Check if it contains tool calls
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // Convert tool calls to code block format
        var tcStrs = [];
        for (var tci = 0; tci < msg.tool_calls.length; tci++) {
          var tc = msg.tool_calls[tci];
          var fn = tc.function || {};
          tcStrs.push(
            '```tool_call\n' +
            '{"name": "' + fn.name + '", "arguments": ' + (fn.arguments || '{}') + '}\n' +
            '```'
          );
        }
        parts.push('[Assistant]: ' + (content || '') + '\n' + tcStrs.join('\n'));
      } else {
        parts.push('[Assistant]: ' + content);
      }
    } else if (role === 'tool') {
      // Tool response: Add result prefix and tool name
      parts.push('[Tool result for ' + (msg.name || 'unknown') + ']: ' + content);
    } else {
      // User message: Use content directly
      parts.push(content || '');
    }
  }

  // Step 3: Join all parts with double newlines, filter out empty strings
  return parts.filter(function (p) { return p; }).join('\n\n');
}

/**
 * Parse tool calls from response text
 * 
 * Tool call format (in response text):
 * ```tool_call
 * {"name": "get_weather", "arguments": {"city": "Beijing"}}
 * ```
 * 
 * After parsing, converts to OpenAI format tool call object:
 * {
 *   id: "call_xxxxxxxxxxxx",
 *   type: "function",
 *   function: {
 *     name: "get_weather",
 *     arguments: '{"city":"Beijing"}'
 *   }
 * }
 * 
 * @param {string} text - Response text that may contain tool calls
 * @returns {Object} { cleanText: cleaned plain text, toolCalls: array of tool calls }
 */
function parseToolCalls(text) {
  var toolCalls = [];

  // Regex match tool_call code blocks
  // /```tool_call\s*\n(.*?)\n```/gs
  // g: Global flag (find all matches, not just the first)
  // s: dotAll mode (allows . to match newlines \n)
  var pattern = /```tool_call\s*\n(.*?)\n```/gs;
  var match;

  // Loop to extract all tool calls
  while ((match = pattern.exec(text)) !== null) {
    try {
      // match[1] is the first capture group, i.e. the JSON content in the tool_call code block
      var data = JSON.parse(match[1].trim());

      // Build OpenAI format tool call object
      toolCalls.push({
        id: 'call_' + generateShortId(8),       // Generate unique call ID
        type: 'function',
        function: {
          name: data.name,                       // Function name
          arguments: JSON.stringify(data.arguments || {}),  // Arguments (must be JSON string)
        },
      });
    } catch (e) {
      // JSON parse error, skip malformed code block
      // Do not interrupt the entire parsing process
    }
  }

  // Remove all tool_call code blocks from text
  var cleanText = text.replace(pattern, '').trim();

  return {
    cleanText: cleanText,    // Cleaned plain text
    toolCalls: toolCalls     // Array of tool calls
  };
}

/**
 * Google native API format to prompt text
 * 
 * Supports Google Gemini CLI native API format (generateContent).
 * Format example:
 * {
 *   "systemInstruction": {
 *     "parts": [{"text": "你是一个有用的助手"}]
 *   },
 *   "contents": [
 *     {"role": "user", "parts": [{"text": "你好"}]},
 *     {"role": "model", "parts": [{"text": "你好！有什么可以帮助你的？"}]}
 *   ]
 * }
 * 
 * Conversion rules:
 * - systemInstruction.parts[].text → "[System instruction]: {text}"
 * - contents[].role="model" → "[Assistant]: {text}"
 * - contents[].role="user" → {text} (use directly)
 * 
 * @param {Object} req - Google API format request object
 * @returns {string} Converted prompt text
 */
function googleContentsToPrompt(req) {
  var parts = [];

  // Process system instruction (systemInstruction)
  var sysInst = req.systemInstruction;
  if (sysInst && sysInst.parts) {
    var sysTextParts = [];
    for (var si = 0; si < sysInst.parts.length; si++) {
      var sp = sysInst.parts[si];
      if (sp.text) sysTextParts.push(sp.text);
    }
    var sysText = sysTextParts.join(' ');
    if (sysText) {
      parts.push('[System instruction]: ' + sysText);
    }
  }

  // Process conversation content (contents)
  var contents = req.contents || [];
  for (var ci = 0; ci < contents.length; ci++) {
    var content = contents[ci];
    var role = content.role || 'user';
    var textParts = [];
    var partsArr = content.parts || [];
    for (var pi = 0; pi < partsArr.length; pi++) {
      if (partsArr[pi].text) textParts.push(partsArr[pi].text);
    }
    var text = textParts.join(' ');

    // model role → Assistant prefix
    if (role === 'model') {
      parts.push('[Assistant]: ' + text);
    } else {
      parts.push(text);
    }
  }

  return parts.filter(function (p) { return p; }).join('\n\n');
}

// ============================================================================
// 🚦 Rate Limiting (Serverless-safe memory storage)
// ============================================================================

// Use Map data structure to store request history per IP
// Advantages of Map over plain Object:
// 1. Supports keys of any type (strings used here)
// 2. Has built-in size property
// 3. Better iteration performance
var rateLimitStore = new Map();

/**
 * Check if request exceeds rate limit (sliding window algorithm)
 * 
 * Algorithm steps:
 * 1. Get current time and historical request records for the IP
 * 2. Filter valid requests within the time window
 * 3. If valid request count reaches or exceeds threshold → reject (return false)
 * 4. Otherwise record this request and allow (return true)
 * 
 * [Memory Management]
 * Since Cloudflare Workers Isolates may survive for a long time (hot start reuse),
 * records in rateLimitStore will grow infinitely if not cleaned up, causing memory leaks.
 * 
 * Cleanup strategy:
 * - 5% probability of triggering global cleanup on each check (Math.random() < 0.05)
 * - Iterate all IP records, remove expired or empty entries
 * - 5% probability ensures cleanup does not affect performance too frequently
 * 
 * @param {string} clientIP - Client IP address
 * @param {Object} config - Request-level config object
 * @returns {boolean} true allows request, false rejects due to rate limit
 */
function checkRateLimit(clientIP, config) {
  // If rate limit is not enabled, allow directly
  if (!config.rateLimit || !config.rateLimit.enabled) return true;

  var now = Date.now();
  // Calculate time window in milliseconds (config is in seconds, needs conversion)
  var windowMs = config.rateLimit.windowSec * 1000;
  // Generate storage key (add prefix to avoid conflicts with other keys)
  var key = 'rl:' + clientIP;

  // Get historical records for the IP and filter valid requests in current window
  var timestamps = (rateLimitStore.get(key) || []).filter(function (t) {
    return now - t < windowMs;
  });

  // Check if threshold is reached or exceeded
  if (timestamps.length >= config.rateLimit.maxRequests) {
    return false;  // Reject request
  }

  // Record timestamp of this request
  timestamps.push(now);
  rateLimitStore.set(key, timestamps);

  // ================================================================
  // 🛡️ Random probability cleanup of expired keys (5% probability trigger)
  // ================================================================
  // Prevent a large amount of cold IP records from accumulating in memory after long-term high-concurrency operation
  // 5% probability (triggered about every 20 checks) ensures it does not execute frequently
  if (Math.random() < 0.05) {
    // Use forEach to iterate all entries in the Map
    rateLimitStore.forEach(function (v, k) {
      // Filter valid (not expired) records
      var valid = v.filter(function (t) {
        return now - t < windowMs;
      });
      if (valid.length === 0) {
        // IP has no valid records, delete entire entry
        rateLimitStore.delete(k);
      } else {
        // Update to array containing only valid records
        rateLimitStore.set(k, valid);
      }
    });
  }

  return true;  // Allow request
}

// ============================================================================
// 🔐 API Key Authentication
// ============================================================================

/**
 * Authenticate API key (supports multiple authentication methods)
 * 
 * Authentication methods in priority order:
 * 1. Authorization: Bearer <key> (standard Bearer Token auth, most recommended)
 * 2. x-api-key: <key> (custom request header, commonly used by OpenAI SDK)
 * 3. x-goog-api-key: <key> (Google-style request header)
 * 4. URL query parameter ?key=<key> (least recommended, key exposed in URL)
 * 
 * If apiKeys is an empty array [], no key authentication is performed; all requests are allowed.
 * Suitable for internal network use or scenarios with other security measures.
 * 
 * @param {Request} request - HTTP request object
 * @param {Object} config - Request-level config object
 * @returns {boolean} true means authenticated, false means authentication failed
 */
function checkApiKey(request, config) {
  // Get API key whitelist
  var keys = config.apiKeys || [];

  // If no keys are configured, allow all requests (no-auth mode)
  if (keys.length === 0) return true;

  // ================================================================
  // Method 1: Authorization: Bearer <key>
  // ================================================================
  var auth = request.headers.get('Authorization') || '';
  // Check if starts with "Bearer "
  if (auth.indexOf('Bearer ') === 0) {
    // Extract token after "Bearer " (remove "Bearer " prefix, 7 characters)
    var token = auth.slice(7);
    // Use indexOf to check if token is in whitelist
    if (keys.indexOf(token) !== -1) return true;
  }

  // ================================================================
  // Method 2 & 3: x-api-key / x-goog-api-key
  // ================================================================
  var headerNames = ['x-api-key', 'x-goog-api-key'];
  for (var i = 0; i < headerNames.length; i++) {
    var value = request.headers.get(headerNames[i]) || '';
    if (keys.indexOf(value) !== -1) return true;
  }

  // ================================================================
  // Method 4: URL query parameter ?key=<key>
  // ================================================================
  var url = new URL(request.url);
  var keyParam = url.searchParams.get('key');
  if (keyParam && keys.indexOf(keyParam) !== -1) return true;

  // All authentication methods failed
  return false;
}

// ============================================================================
// 📤 HTTP Response Builder
// ============================================================================

/**
 * Send JSON HTTP response
 * 
 * Automatically sets CORS headers, allowing requests from any domain.
 * 
 * @param {Object} data - Response data to send (will be JSON.stringify serialized)
 * @param {number} [status] - HTTP status code, default 200
 * @returns {Response} HTTP response object
 */
function sendJSON(data, status) {
  if (status === undefined) status = 200;
  // Serialize data to JSON string
  var body = JSON.stringify(data);
  // Build and return Response object
  return new Response(body, {
    status: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',           // Allow all domains
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',  // Allowed HTTP methods
      'Access-Control-Allow-Headers': '*',           // Allow all request headers
    },
  });
}

/**
 * Send SSE (Server-Sent Events) streaming response
 * 
 * SSE is a protocol for server to push real-time data to client.
 * Compared to WebSocket, SSE is simpler:
 * - Unidirectional communication (server → client)
 * - Based on HTTP protocol
 * - Auto-reconnect mechanism
 * 
 * Data format:
 * data: {json}\n\n
 * 
 * Special format:
 * data: [DONE]\n\n  → indicates stream end
 * : heartbeat\n\n   → SSE comment (ignored by client), used to keep connection alive
 * 
 * @param {ReadableStream} stream - Readable stream object
 * @returns {Response} HTTP streaming response object
 */
function sendSSE(stream) {
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',  // Required content type for SSE
      'Cache-Control': 'no-cache',                          // Disable caching
      'Connection': 'keep-alive',                           // Keep connection open
      'X-Accel-Buffering': 'no',                            // Disable nginx proxy buffering
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  });
}

// ============================================================================
// 🎯 Model Resolution
// ============================================================================

/**
 * Parse model name, get corresponding configuration parameters
 * 
 * Supports @think= parameter to override default thinking mode.
 * Example: "gemini-3.6-flash@think=0"
 * means use Flash model with deep thinking enabled (think=0).
 * 
 * @param {string} modelName - Model name
 *   Format: "model name" or "model name@think=number"
 * @returns {Object} 
 *   - modelName: Actual model name after removing @think= parameter
 *   - modelId: MODE_CATEGORY enum value (1-6)
 *   - thinkMode: Thinking mode (0=deep thinking, 4=automatic)
 *   - error: Error information, null means normal
 */
function resolveModel(modelName) {
  var thinkOverride = null;
  var actualModelName = modelName;

  // Check if @think= parameter is included
  if (modelName.indexOf('@think=') !== -1) {
    var parts = modelName.split('@think=');
    actualModelName = parts[0];           // Extract actual model name
    thinkOverride = parseInt(parts[1], 10);  // Extract thinking mode override value
    if (isNaN(thinkOverride)) {
      return { error: '无效的 think 参数: ' + parts[1] };
    }
  }

  // Look up model configuration
  var cfg = MODELS[actualModelName];
  if (!cfg) {
    return { error: '未知模型: ' + actualModelName };
  }

  // Return parse result
  return {
    modelName: actualModelName,
    modelId: cfg.mode,                                            // Model category ID
    thinkMode: thinkOverride !== null ? thinkOverride : cfg.think,  // Use override value or default
    error: null,
  };
}

// ============================================================================
// 📋 Core Request Processing - /v1/chat/completions
// ============================================================================

/**
 * Handle /v1/chat/completions request
 * 
 * This is the core endpoint of the OpenAI-compatible API and the most critical function in the entire program.
 * Responsible for converting OpenAI format chat requests to Gemini format and returning responses.
 * 
 * [Two Modes Supported]
 * 1. Non-streaming (stream=false): 
 *    - Wait for Gemini to return complete response
 *    - Parse and return response in JSON format at once
 *    - Suitable for tool calls (requires complete response to parse tool_call code blocks)
 * 
 * 2. Streaming (stream=true):
 *    - Read Gemini streaming data in real time
 *    - Calculate incremental text (current total - previous total)
 *    - Immediately push increment to client (typewriter effect)
 *    - Includes heartbeat keepalive mechanism (sends SSE comment every 2 seconds)
 * 
 * [SSE format strictly follows OpenAI standard]
 * First chunk: { delta: { role: 'assistant' }, finish_reason: null }
 * Content chunk: { delta: { content: 'incremental text' }, finish_reason: null }
 * End chunk: { delta: { content: "" }, finish_reason: 'stop' }
 * 
 * @param {Request} request - HTTP request object
 * @param {Object} body - Parsed request body (OpenAI Chat Completions format)
 * @param {Object} config - Request-level config object
 * @returns {Promise<Response>} HTTP response object
 */
async function handleChatCompletions(request, body, config) {
  // ---- Step 1: Parse model ----
  var resolved = resolveModel(body.model || config.defaultModel);
  if (resolved.error) {
    return sendJSON({ error: { message: resolved.error } }, 400);
  }

  var modelName = resolved.modelName;
  var modelId = resolved.modelId;
  var thinkMode = resolved.thinkMode;
  var tools = body.tools || null;

  // ---- Step 2: Convert messages to prompt text ----
  var prompt = messagesToPrompt(body.messages || [], tools);
  if (!prompt.trim()) {
    return sendJSON({ error: { message: 'empty prompt' } }, 400);
  }

  var stream = body.stream === true;
  var chatId = 'chatcmpl-' + generateShortId(12);

  log('Chat: model=' + modelName + ', stream=' + stream + ', tokens≈' + estimateTokens(prompt), 'INFO', config);

  // ================================================================
  // Case A: Non-streaming or with tool calls
  // ================================================================
  // Tool calls require complete response text to parse tool_call code blocks
  // So even if stream=true is requested, if tools exist, force non-streaming
  if (!stream || tools) {
    try {
      // Call Gemini API to get complete response
      var raw = await geminiStreamGenerate(prompt, modelId, thinkMode, config);

      // Extract and clean response text
      var text = extractResponseText(raw);
      var toolCalls = null;

      // If tools are enabled, parse tool calls
      if (tools && text) {
        var parsed = parseToolCalls(text);
        text = parsed.cleanText;
        toolCalls = parsed.toolCalls.length > 0 ? parsed.toolCalls : null;
      }

      // Build response message
      var msg = { role: 'assistant', content: text || null };
      if (toolCalls) {
        msg.tool_calls = toolCalls;
      }

      var finishReason = toolCalls ? 'tool_calls' : 'stop';

      // If streaming requested but tools exist, return as single SSE chunk
      if (stream) {
        var encoder = new TextEncoder();
        var nonStreamSSE = new ReadableStream({
          start: function (controller) {
            var chunk = {
              id: chatId,
              object: 'chat.completion.chunk',
              created: timestamp(),
              model: modelName,
              choices: [{ index: 0, delta: msg, finish_reason: finishReason }],
            };
            controller.enqueue(encoder.encode('data: ' + JSON.stringify(chunk) + '\n\n'));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        });
        return sendSSE(nonStreamSSE);
      }

      // Standard non-streaming JSON response
      return sendJSON({
        id: chatId,
        object: 'chat.completion',
        created: timestamp(),
        model: modelName,
        choices: [{ index: 0, message: msg, finish_reason: finishReason }],
        usage: {
          prompt_tokens: estimateTokens(prompt),
          completion_tokens: estimateTokens(text),
          total_tokens: estimateTokens(prompt + text),
        },
      });

    } catch (error) {
      log('Upstream error: ' + error.message, 'ERROR', config);
      return sendJSON({ error: { message: 'upstream error: ' + error.message } }, 502);
    }
  }

  // ================================================================
  // Case B: True streaming SSE response (typewriter effect)
  // ================================================================
  var streamEncoder = new TextEncoder();

  var streamBody = new ReadableStream({
    start: function (controller) {
      // ---- State management variables ----
      var heartbeatTimer = null;  // Heartbeat timer ID
      var isFinished = false;      // Whether the stream has ended (prevent double close)

      /**
       * Clean up heartbeat timer
       * Called when stream ends or errors, ensures timer is properly cleared
       */
      var clearHeartbeat = function () {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      };

      /**
     * Safely end stream
     * Ensure end chunk and [DONE] marker are sent before closing stream
     * Prevent double close causing errors
       * 
       * @param {string} reason - End reason, 'stop' means normal end, 'error' means abnormal end
       */
      var finishStream = function (reason) {
        // Prevent double end (may trigger error and close events simultaneously)
        if (isFinished) return;
        clearHeartbeat();
        isFinished = true;
        try {
          // Send OpenAI standard end chunk
          // ⚠️ Important: delta.content must be "" (empty string), not empty object {}
          // Clients like NextChat check if delta.content exists
          controller.enqueue(streamEncoder.encode('data: ' + JSON.stringify({
            id: chatId,
            object: 'chat.completion.chunk',
            created: timestamp(),
            model: modelName,
            choices: [{
              index: 0,
              delta: { content: "" },
              finish_reason: reason || 'stop'
            }],
          }) + '\n\n'));
          // Send [DONE] marker (SSE protocol defined stream end signal)
          controller.enqueue(streamEncoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (e) {
          log('Failed to finish stream: ' + e.message, 'ERROR', config);
        }
      };

      // Use async immediately-invoked function expression (IIFE) to handle streaming logic
      // Because ReadableStream start cannot be an async function
      (async function () {
        try {
          // ---- Step 1: Send role declaration chunk ----
          // Conforms to OpenAI standard: first chunk only contains role, no content
          // This tells the client: "next is an assistant role message"
          controller.enqueue(streamEncoder.encode('data: ' + JSON.stringify({
            id: chatId,
            object: 'chat.completion.chunk',
            created: timestamp(),
            model: modelName,
            choices: [{
              index: 0,
              delta: { role: 'assistant' },
              finish_reason: null
            }],
          }) + '\n\n'));

          // ---- Step 2: Start heartbeat timer ----
          // Send SSE comment (line starting with colon) every 2 seconds
          // Client ignores comment lines but connection stays alive
          // This prevents connection from being dropped by intermediate proxy during long periods with no data
          heartbeatTimer = setInterval(function () {
            if (!isFinished) {
              try {
                // SSE comment format: starts with colon, ignored by client
                controller.enqueue(streamEncoder.encode(': heartbeat\n\n'));
              } catch (e) {
                clearHeartbeat();  // Write failed, stop heartbeat
              }
            } else {
              clearHeartbeat();
            }
          }, 2000);

          // ---- Step 3: Build and send Gemini request ----
          var reqBody = buildPayload(prompt, modelId, thinkMode, config);
          var headers = await buildHeaders(config);
          var url = buildUrl(config);

          // Create separate AbortController for timeout control
          var fetchController = new AbortController();
          var fetchTimeout = setTimeout(function () {
            fetchController.abort();  // Abort fetch request after timeout
          }, (config.requestTimeoutSec - 2) * 1000);

          try {
            // Send HTTP POST request to Gemini
            var response = await fetch(url, {
              method: 'POST',
              headers: headers,
              body: reqBody,
              signal: fetchController.signal,
            });
            clearTimeout(fetchTimeout);

            // Check response status code
            if (!response.ok) {
              var errorText = '';
              try {
                errorText = await response.text();
              } catch (e) {
                errorText = '无法读取错误信息';
              }
              throw new Error('HTTP ' + response.status + ': ' + errorText.substring(0, 200));
            }

            // ---- Step 4: Read streaming response and forward incremental data in real time ----
            var reader = response.body.getReader();
            var decoder = new TextDecoder();
            var buffer = '';      // Line buffer (handles incomplete lines)
            var prevText = '';    // Track previously sent full text

            while (true) {
              var readResult = await reader.read();
              if (readResult.done) break;  // Stream ended

              // Decode new data and append to buffer
              buffer += decoder.decode(readResult.value, { stream: true });

              // Check for Gemini error information
              if (buffer.indexOf('BardErrorInfo') !== -1) {
                var match = buffer.match(/BardErrorInfo\s*\[(\d+)\]/);
                if (match) {
                  throw new Error('Gemini upstream rejected request: BardErrorInfo [' + match[1] + ']');
                }
              }

              // Split and process by line (Gemini response is one JSON per line)
              var lines = buffer.split('\n');
              // Last line may be incomplete, kept in buffer
              buffer = lines.pop() || '';

              // Iterate through each complete line of data
              for (var li = 0; li < lines.length; li++) {
                var line = lines[li];
                // Skip lines without data marker or too short
                if (line.indexOf('"wrb.fr"') === -1 || line.length < 200) continue;

                try {
                  // Parse Gemini nested JSON response
                  var arr = JSON.parse(line);
                  var innerStr = arr[0][2];
                  if (!innerStr || innerStr.length < 50) continue;

                  var inner2 = JSON.parse(innerStr);

                  // Extract text content
                  if (Array.isArray(inner2) && inner2.length > 4 && inner2[4]) {
                    var parts = inner2[4];
                    for (var pi = 0; pi < parts.length; pi++) {
                      var part = parts[pi];
                      if (Array.isArray(part) && part.length > 1 && part[1] && Array.isArray(part[1])) {
                        var textItems = part[1];
                        for (var ti = 0; ti < textItems.length; ti++) {
                          var t = textItems[ti];
                          // Check if there is new content (text length increased)
                          if (typeof t === 'string' && t.length > prevText.length) {
                            // 🔑 Calculate incremental text
                            // Incremental = current full text - previously sent full text
                            var delta = t.slice(prevText.length);
                            // Clean code execution traces (no trim, preserve whitespace formatting)
                            var cleaned = cleanGeminiText(delta, false);
                            if (cleaned) {
                              // Immediately push incremental chunk to client (typewriter effect)
                              controller.enqueue(streamEncoder.encode('data: ' + JSON.stringify({
                                id: chatId,
                                object: 'chat.completion.chunk',
                                created: timestamp(),
                                model: modelName,
                                choices: [{
                                  index: 0,
                                  delta: { content: cleaned },
                                  finish_reason: null
                                }],
                              }) + '\n\n'));
                            }
                            // Update sent text record
                            prevText = t;
                          }
                        }
                      }
                    }
                  }
                } catch (e) {
                  // JSON parse error, continue to next line
                  // Gemini response may be truncated in transit
                }
              }
            }
          } finally {
            // Ensure timeout timer is cleared whether success or failure
            clearTimeout(fetchTimeout);
          }

          // ---- Step 5: Normally end stream ----
          finishStream('stop');

        } catch (error) {
          // Error handling: log and attempt to notify client
          log('Stream error: ' + error.message, 'ERROR', config);
          try {
            if (!isFinished) {
              controller.enqueue(streamEncoder.encode('data: ' + JSON.stringify({
                error: { message: error.message, type: 'upstream_error' }
              }) + '\n\n'));
            }
          } catch (e) {
            // Failed to send error info, client may have disconnected
          }
          finishStream('error');
        }
      })();  // Immediately invoked async function
    },

    /**
     * Callback when client disconnects
     * Triggered when user closes page or network interrupts
     * Clean up resources, stop heartbeat
     */
    cancel: function () {
      log('Client disconnected from stream', 'INFO', config);
    },
  });

  return sendSSE(streamBody);
}

/**
 * Handle /v1/responses request (OpenAI Responses API)
 * 
 * This is OpenAI's new Responses API (used by Codex CLI and other tools).
 * Similar to Chat Completions API but with slightly different message format.
 * 
 * Responses API format:
 * {
 *   "model": "gpt-4o",
 *   "input": [
 *     {"role": "user", "content": "Hello"},
 *     {"type": "function_call_output", "call_id": "...", "output": "..."}
 *   ],
 *   "instructions": "系统指令（可选）",
 *   "tools": [...]
 * }
 * 
 * This function is responsible for converting Responses API format to Chat Completions format,
 * then reuses handleChatCompletions logic.
 * 
 * @param {Request} request - HTTP request object
 * @param {Object} body - Parsed request body
 * @param {Object} config - Request-level config object
 * @returns {Promise<Response>} HTTP response object
 */
async function handleResponses(request, body, config) {
  // Parse model
  var resolved = resolveModel(body.model || config.defaultModel);
  if (resolved.error) {
    return sendJSON({ error: { message: resolved.error } }, 400);
  }

  var modelName = resolved.modelName;
  var modelId = resolved.modelId;
  var thinkMode = resolved.thinkMode;
  var messages = [];

  // Add system instruction (instructions field)
  if (body.instructions) {
    messages.push({ role: 'system', content: body.instructions });
  }

  // Process input items (input field)
  var inputs = body.input || [];
  // Compatible with string format input
  if (typeof inputs === 'string') {
    inputs = [inputs];
  }
  for (var i = 0; i < inputs.length; i++) {
    var item = inputs[i];
    if (typeof item === 'string') {
      // Simple string → user message
      messages.push({ role: 'user', content: item });
    } else if (item.type === 'function_call_output') {
      // Function call output → tool message
      messages.push({
        role: 'tool',
        tool_call_id: item.call_id,
        name: item.name,
        content: item.output,
      });
    } else {
      // Other format message
      var content = item.content;
      if (Array.isArray(content)) {
        var textParts = [];
        for (var j = 0; j < content.length; j++) {
          var c = content[j];
          if (c.type === 'output_text') textParts.push(c.text || '');
        }
        content = textParts.join(' ');
      }
      messages.push({ role: item.role || 'user', content: content });
    }
  }

  // Normalize tool definitions
  var tools = body.tools;
  if (tools) {
    var normalizedTools = [];
    for (var ti = 0; ti < tools.length; ti++) {
      var t = tools[ti];
      if (t.type === 'function' && !t.function) {
        // Short form → full form
        normalizedTools.push({
          type: 'function',
          function: { name: t.name, description: t.description || '', parameters: t.parameters || {} },
        });
      } else {
        normalizedTools.push(t);
      }
    }
    tools = normalizedTools;
  }

  // Convert messages to prompt text
  var prompt = messagesToPrompt(messages, tools);
  if (!prompt.trim()) {
    return sendJSON({ error: { message: 'empty input' } }, 400);
  }

  try {
    // Call Gemini API
    var raw = await geminiStreamGenerate(prompt, modelId, thinkMode, config);
    var text = extractResponseText(raw);
    var toolCalls = null;

    // Parse tool calls
    if (tools && text) {
      var parsed = parseToolCalls(text);
      text = parsed.cleanText;
      toolCalls = parsed.toolCalls.length > 0 ? parsed.toolCalls : null;
    }

    // Build Responses API format output
    var responseId = 'resp_' + generateShortId(16);
    var messageId = 'msg_' + generateShortId(12);
    var output = [];

    // Add tool call output
    if (toolCalls) {
      for (var tci = 0; tci < toolCalls.length; tci++) {
        var tc = toolCalls[tci];
        output.push({
          type: 'function_call',
          id: tc.id,
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
          status: 'completed',
        });
      }
    }

    // Add text output
    if (text || !toolCalls) {
      output.push({
        type: 'message',
        id: messageId,
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: text || '', annotations: [] }],
      });
    }

    return sendJSON({
      id: responseId,
      object: 'response',
      created_at: timestamp(),
      status: 'completed',
      model: modelName,
      output: output,
      usage: {
        input_tokens: estimateTokens(prompt),
        output_tokens: estimateTokens(text),
        total_tokens: estimateTokens(prompt + text),
      },
    });
  } catch (error) {
    return sendJSON({ error: { message: 'upstream error: ' + error.message } }, 502);
  }
}

/**
 * Handle Google native API (Gemini CLI compatible)
 * 
 * Supports Google Gemini CLI native generateContent and streamGenerateContent formats.
 * URL format: /v1beta/models/{model}:generateContent
 * 
 * @param {Request} request - HTTP request object
 * @param {Object} body - Parsed request body (Google format)
 * @param {boolean} stream - Whether to use streaming
 * @param {Object} config - Request-level config object
 * @returns {Promise<Response>} HTTP response object
 */
async function handleGoogleAPI(request, body, stream, config) {
  // Extract model name from URL path
  // Example: /v1beta/models/gemini-3.6-flash:generateContent → "gemini-3.6-flash"
  var requestUrl = new URL(request.url);
  var match = requestUrl.pathname.match(/\/v1beta\/models\/([^:]+)/);
  var modelName = match ? match[1] : null;

  if (!modelName) {
    return sendJSON({ error: { message: 'model not specified in path' } }, 400);
  }

  var resolved = resolveModel(modelName);
  if (resolved.error) {
    return sendJSON({ error: { message: resolved.error } }, 400);
  }

  var modelId = resolved.modelId;
  var thinkMode = resolved.thinkMode;

  // Convert Google format to prompt text
  var prompt = googleContentsToPrompt(body);
  if (!prompt.trim()) {
    return sendJSON({ error: { message: 'empty content' } }, 400);
  }

  try {
    var raw = await geminiStreamGenerate(prompt, modelId, thinkMode, config);
    var text = extractResponseText(raw);

    // Build Google format response
    var response = {
      candidates: [{
        content: { parts: [{ text: text || '' }], role: 'model' },
        finishReason: 'STOP',
        index: 0,
      }],
      usageMetadata: {
        promptTokenCount: estimateTokens(prompt),
        candidatesTokenCount: estimateTokens(text),
        totalTokenCount: estimateTokens(prompt + text),
      },
      modelVersion: modelName,
    };

    if (stream) {
      return new Response('data: ' + JSON.stringify(response) + '\n\n', {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    return sendJSON(response);
  } catch (error) {
    return sendJSON({ error: { message: 'upstream error: ' + error.message } }, 502);
  }
}

// ============================================================================
// 🚀 Main entry - Cloudflare Workers fetch event handler
// ============================================================================

export default {
  /**
   * Core entry function of Cloudflare Workers
   * 
   * Every HTTP request arriving at the Worker calls this function.
   * Processing follows strictly this order:
   * 
   * 1. OPTIONS preflight → Return CORS headers (mandatory for browser CORS)
   * 2. Create request-level config → getRequestConfig(env) (solves concurrency crosstalk)
   * 3. Rate limit check → checkRateLimit() (anti-abuse)
   * 4. API key verification → checkApiKey() (security auth)
   * 5. Routing dispatch:
   *    GET  /health              → Health check
   *    GET  /v1/models           → Model list (OpenAI format)
   *    GET  /v1beta/models       → Model list (Google format)
   *    POST /v1/chat/completions → Chat completion (OpenAI format)
   *    POST /v1/responses        → Responses API (Codex CLI)
   *    POST ...:generateContent  → Generate content (Google format)
   *    POST /v1/*                → Universal fallback (auto-route to chat)
   * 
    * @param {Request} request - HTTP request object
    * @param {Object} env - Environment variables (independently injected by CF platform per request)
    * @param {Object} ctx - Execution context
    * @returns {Promise<Response>} HTTP response object
   */
  async fetch(request, env, ctx) {
    // ================================================================
    // Step 1: OPTIONS CORS preflight request handled first
    // ================================================================
    // Browsers send OPTIONS preflight requests before cross-domain POST requests.
    // Must return correct CORS headers, otherwise browsers will block the actual request.
    // This handling must be completed before all other logic.
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,  // No Content
        headers: {
           'Access-Control-Allow-Origin': '*',              // Allow all domains
           'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',  // Allowed HTTP methods
           'Access-Control-Allow-Headers': '*',             // Allow all request headers
           'Access-Control-Max-Age': '86400',               // Preflight cache 24 hours (seconds)
        },
      });
    }

    // ================================================================
    // Step 2: Create independent config copy for current request
    // ================================================================
    // 🔑 This is the core step for solving concurrency crosstalk.
    // Does not modify any global variables; each request has its own dedicated config object.
    // env parameter is environment variables independently provided by Cloudflare for each request.
    var config = getRequestConfig(env);

    // Parse request URL and method
    var requestUrl = new URL(request.url);
    var path = requestUrl.pathname;
    var method = request.method;

    // ================================================================
    // Step 3: Rate limit check
    // ================================================================
    // Uses real client IP provided by Cloudflare (CF-Connecting-IP header)
    // If unavailable (non-CF proxy), uses default 0.0.0.0
    var clientIP = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
    if (!checkRateLimit(clientIP, config)) {
      log('Rate limit exceeded: ' + clientIP, 'WARN', config);
      return sendJSON({
        error: {
          message: '请求过于频繁，请稍后再试',
          type: 'rate_limit_exceeded',
        },
      }, 429);  // HTTP 429 Too Many Requests
    }

    // ================================================================
    // Step 4: API key verification
    // ================================================================
    // Only performs key verification on /v1 path requests
    // Public endpoints like /health do not require verification
    if (path.indexOf('/v1') === 0 && !checkApiKey(request, config)) {
      return sendJSON({
        error: { message: 'invalid api key' },
      }, 401);  // HTTP 401 Unauthorized
    }

    // ================================================================
    // Step 5: GET request handling
    // ================================================================
    if (method === 'GET') {
      // ---- Health check endpoint ----
      // Can be used to monitor whether Worker is running normally
      // Returns version number, model list, config status, etc.
      if (path === '/' || path === '/health') {
        return sendJSON({
          status: 'ok',
          version: '1.5.0-cf-multifingerprint',
          platform: 'Cloudflare Workers',
          models: Object.keys(MODELS),
          defaultModel: config.defaultModel,
        });
      }

      // ---- OpenAI format model list ----
      // Returns information about all available models
      // Clients (NextChat, Cherry Studio, etc.) call this endpoint to get the model list
      if (path === '/v1/models') {
        var modelList = [];
        var modelKeys = Object.keys(MODELS);
        for (var i = 0; i < modelKeys.length; i++) {
          var id = modelKeys[i];
          var cfg = MODELS[id];
          modelList.push({
            id: id,
            object: 'model',
            created: 1700000000,
            owned_by: 'google',
            description: cfg.desc,
          });
        }
        return sendJSON({ object: 'list', data: modelList });
      }

      // ---- Google native format model list ----
      // Used for model discovery by tools like Gemini CLI
      if (path === '/v1beta/models') {
        var googleModels = [];
        var gKeys = Object.keys(MODELS);
        for (var j = 0; j < gKeys.length; j++) {
          var name = gKeys[j];
          var gCfg = MODELS[name];
          googleModels.push({
            name: 'models/' + name,
            displayName: name,
            description: gCfg.desc,
            supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
          });
        }
        return sendJSON({ models: googleModels });
      }

      // Unmatched GET request
      return sendJSON({ error: { message: 'not found' } }, 404);
    }

    // ================================================================
    // Step 6: POST request handling
    // ================================================================
    if (method === 'POST') {
      var body;
      try {
        body = await request.json();
      } catch (e) {
        return sendJSON({ error: { message: 'invalid JSON' } }, 400);
      }

      // ---- OpenAI Chat Completions API ----
      // This is the most commonly used endpoint, handles chat completion requests
      if (path === '/v1/chat/completions') {
        return handleChatCompletions(request, body, config);
      }

      // ---- OpenAI Responses API (Codex CLI compatible) ----
      if (path === '/v1/responses') {
        return handleResponses(request, body, config);
      }

      // ---- Google native streamGenerateContent (streaming) ----
      if (path.indexOf(':streamGenerateContent') !== -1) {
        return handleGoogleAPI(request, body, true, config);
      }

      // ---- Google native generateContent (non-streaming) ----
      if (path.indexOf(':generateContent') !== -1) {
        return handleGoogleAPI(request, body, false, config);
      }

      // ---- Universal fallback route ----
      // All unmatched POST requests under /v1/ are automatically routed to chat handling
      // Compatible with path differences across various clients
      if (path.indexOf('/v1/') === 0) {
        return handleChatCompletions(request, body, config);
      }

      // Unmatched POST request
      return sendJSON({ error: { message: 'not found' } }, 404);
    }

    // ================================================================
    // Step 7: Unsupported HTTP method
    // ================================================================
    return sendJSON({ error: { message: 'method not allowed' } }, 405);
  },
};
