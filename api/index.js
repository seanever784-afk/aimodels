import { getRandomUserAgent } from '../utils/userAgents.js';

export default async function handler(req, res) {
    // 1. Enable CORS for browser usage
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // 2. Parse Inputs (Support both Query Params and JSON Body)
    let model = '';
    let messages = [];

    // Handle GET /chat/:model/:prompt via Vercel Rewrites
    if (req.method === 'GET') {
        const { model: queryModel, prompt: queryPrompt } = req.query;
        
        if (!queryModel || !queryPrompt) {
             return res.status(400).json({ 
                error: 'Missing parameters', 
                usage: '/chat/deepseek-ai/DeepSeek-V3.1/Hello' 
            });
        }

        // URL decode the model (in case of slashes encoded as %2F)
        model = decodeURIComponent(queryModel);
        
        // Construct standard OpenAI message format
        messages = [
            { role: "system", content: "Be a helpful assistant" },
            { role: "user", content: decodeURIComponent(queryPrompt) }
        ];
    } 
    // Handle POST (Standard JSON body)
    else if (req.method === 'POST') {
        try {
            const body = req.body;
            model = body.model;
            messages = body.messages;
            
            if (!model || !messages) {
                return res.status(400).json({ error: 'Missing "model" or "messages" in body' });
            }
        } catch (e) {
            return res.status(400).json({ error: 'Invalid JSON body' });
        }
    } else {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // 3. Prepare Upstream Request to DeepInfra
    const url = 'https://api.deepinfra.com/v1/openai/chat/completions';
    const randomUA = getRandomUserAgent();

    const headers = {
        'Accept': 'text/event-stream', // We request stream but might buffer it for GET
        'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Content-Type': 'application/json',
        'Origin': 'https://deepinfra.com', // CRITICAL: Mimic origin
        'Referer': 'https://deepinfra.com/', // CRITICAL: Mimic referer
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
        'User-Agent': randomUA, // Random UA
        'X-Deepinfra-Source': 'web-page', // CRITICAL: Mimic source
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"'
    };

    const payload = {
        model: model,
        messages: messages,
        stream: true // We always request stream as per curl, but will process differently
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error("Upstream Error:", response.status, errText);
            return res.status(response.status).json({ error: 'Provider Error', details: errText });
        }

        // 4. Handle Response
        // DeepInfra returns a stream. 
        // For GET requests (browser testing), we want a simple JSON response.
        // For POST requests, we can pipe the stream or return JSON.
        
        // Simplified Logic: Read the stream, assemble the text, and return a clean JSON.
        // This ensures the user gets a clean answer without handling SSE on their end for the GET endpoint.
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let fullText = "";
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            
            // Process buffer for "data: " lines
            const lines = buffer.split('\n');
            // Keep the last line if it's incomplete
            buffer = lines.pop(); 

            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith("data: ") && trimmed !== "data: [DONE]") {
                    try {
                        const jsonStr = trimmed.substring(6); // Remove "data: "
                        const json = JSON.parse(jsonStr);
                        if (json.choices && json.choices[0].delta.content) {
                            fullText += json.choices[0].delta.content;
                        }
                    } catch (e) {
                        // Ignore parse errors for keep-alive or malformed chunks
                    }
                }
            }
        }

        // 5. Final Response Construction
        // We do NOT send the User-Agent back in the headers
        res.status(200).json({
            status: "success",
            model: model,
            content: fullText,
            // Add metadata to show it's working
            meta: {
                provider: "DeepInfra (Proxied)",
                user_agent_used: "Hidden" 
            }
        });

    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
}
