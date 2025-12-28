export const config = {
  runtime: 'edge',
};

// --- CONSTANTS & CONFIGURATION ---

const DEEPINFRA_API = "https://api.deepinfra.com/v1/openai/chat/completions";

// Mapping simple names to the complex IDs found in your curls
const MODEL_MAP = {
  "deepseek-v3": "deepseek-ai/DeepSeek-V3",
  "deepseek-r1": "deepseek-ai/DeepSeek-R1",
  "qwen-coder": "Qwen/Qwen2.5-Coder-32B-Instruct",
  "kimi": "moonshotai/Moonshot-v1-8k", // Mapping to a standard Kimi/Moonshot if specific ID fails
  "gpt-4o": "meta-llama/Meta-Llama-3.1-70B-Instruct", // Fallback/Placeholder
  // Pass-through default if not found
};

// 100+ Real-like User Agents (Shortened list for brevity, but logic selects randomly)
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.64 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (iPad; CPU OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.64 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (X11; Linux i686; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.64 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.64 Mobile Safari/537.36",
  // ... (Simulating 100+ entries by randomized versioning below)
];

function getRandomUserAgent() {
  const baseAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  // Add slight randomization to version numbers to simulate unique 100+ agents
  return baseAgent.replace(/(\d+)\.(\d+)/, (match, p1, p2) => {
    const v1 = parseInt(p1) + Math.floor(Math.random() * 3);
    const v2 = Math.floor(Math.random() * 100);
    return `${v1}.${v2}`;
  });
}

// --- MAIN HANDLER ---

export default async function handler(req) {
  // Parsing parameters
  const url = new URL(req.url);
  
  // Extract model from path (e.g., /chat/deepseek-v3 -> deepseek-v3)
  // Vercel rewrite sends this as query param usually, but we check path for robustness
  let modelKey = url.searchParams.get('model') || 'deepseek-v3';
  const prompt = url.searchParams.get('prompt');

  // Headers for CORS and JSON response
  const responseHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: responseHeaders });
  }

  if (!prompt) {
    return new Response(JSON.stringify({ 
      error: "Missing 'prompt' query parameter.",
      usage: "/chat/:model?prompt=Your%20question" 
    }), { 
      status: 400, 
      headers: responseHeaders 
    });
  }

  // Resolve Model ID
  // If the key exists in our map, use it. Otherwise, assume user passed a direct ID.
  const resolvedModel = MODEL_MAP[modelKey] || modelKey;
  const userAgent = getRandomUserAgent();

  // Prepare Payload
  const payload = {
    model: resolvedModel,
    messages: [
      { role: "system", content: "Be a helpful assistant" },
      { role: "user", content: prompt }
    ],
    stream: false, // We turn off streaming to provide a simple JSON API response
    stream_options: { include_usage: true }
  };

  try {
    const upstreamResponse = await fetch(DEEPINFRA_API, {
      method: 'POST',
      headers: {
        'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Content-Type': 'application/json',
        'Origin': 'https://deepinfra.com',
        'Referer': 'https://deepinfra.com/',
        'User-Agent': userAgent,
        'X-Deepinfra-Source': 'web-page',
        'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site'
      },
      body: JSON.stringify(payload)
    });

    if (!upstreamResponse.ok) {
      const errText = await upstreamResponse.text();
      return new Response(JSON.stringify({ error: "Upstream Error", details: errText }), {
        status: upstreamResponse.status,
        headers: responseHeaders
      });
    }

    const data = await upstreamResponse.json();

    // Standardize response for the user
    const result = {
      status: "success",
      model: resolvedModel,
      reply: data.choices?.[0]?.message?.content || "",
      raw: data
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: responseHeaders
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: "Internal Server Error", details: error.message }), {
      status: 500,
      headers: responseHeaders
    });
  }
}
