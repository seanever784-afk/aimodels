const { getRandomUserAgent } = require('../userAgents');
const crypto = require('crypto');

// Helper to generate a random 32-character hex string (like a fingerprint/session ID)
const randomID = () => crypto.randomBytes(16).toString('hex');

export const config = {
  runtime: 'edge', // Use Edge Runtime for better streaming performance
};

export default async function handler(req) {
  // 1. Handle CORS (Allow all origins for now, strict in production)
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    
    // 2. Validate Body
    if (!body.messages || !Array.isArray(body.messages)) {
      throw new Error('Messages array is required');
    }

    // 3. Select Random User Agent and IDs
    const userAgent = getRandomUserAgent();
    // Some basic device info emulation based on the UA could go here, 
    // but usually just the UA is enough for this specific endpoint.
    
    // 4. Construct Upstream Headers
    // The "Referer" and "Origin" are the most critical parts for deepinfra.
    const upstreamHeaders = {
      'Accept': 'text/event-stream',
      'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
      'Content-Type': 'application/json',
      'Origin': 'https://deepinfra.com',
      'Referer': 'https://deepinfra.com/',
      'User-Agent': userAgent,
      'X-Deepinfra-Source': 'web-page', // The magic key
      'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"', // Generic modern chrome
      'sec-ch-ua-mobile': userAgent.includes('Mobile') ? '?1' : '?0',
      'sec-ch-ua-platform': userAgent.includes('Android') ? '"Android"' : '"Windows"', // simplistic matching
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
    };

    // 5. Default Model Fallback
    const model = body.model || 'deepseek-ai/DeepSeek-V3.1';

    // 6. Make the Upstream Call
    const upstreamResponse = await fetch('https://api.deepinfra.com/v1/openai/chat/completions', {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify({
        model: model,
        messages: body.messages,
        stream: true, // Always force stream for this proxy
      }),
    });

    if (!upstreamResponse.ok) {
      const errorText = await upstreamResponse.text();
      return new Response(JSON.stringify({ error: 'Upstream Error', details: errorText }), {
        status: upstreamResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 7. Proxy the Stream back to the client
    // We simply pipe the upstream body to the response
    return new Response(upstreamResponse.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
    });
  }
}
