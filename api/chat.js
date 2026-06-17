// api/chat.js — Vercel Serverless Function
// 前端不直接打 AI，改打這支 /api/chat。金鑰藏在 Vercel 環境變數 GEMINI_API_KEY。
// 這支函式把前端送來的 Anthropic 格式 (system + messages) 轉成 Google Gemini 格式，
// 呼叫免費的 Gemini API，再把結果包成前端原本就看得懂的格式回傳：
//   { content: [ { text: "..." } ] }
// 這樣前端程式幾乎不用改邏輯，只要把網址換成 /api/chat 就好。

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: '伺服器尚未設定 GEMINI_API_KEY' });
  }

  try {
    const { system, messages } = req.body || {};

    // 把 Anthropic 格式的 messages 轉成 Gemini 的 contents
    // Anthropic: { role: 'user'|'assistant', content: 字串 或 陣列(含圖片) }
    // Gemini:    { role: 'user'|'model',     parts: [ {text} 或 {inline_data} ] }
    const contents = (messages || []).map((m) => {
      const role = m.role === 'assistant' ? 'model' : 'user';
      let parts;

      if (typeof m.content === 'string') {
        parts = [{ text: m.content }];
      } else if (Array.isArray(m.content)) {
        parts = m.content.map((block) => {
          if (block.type === 'text') {
            return { text: block.text };
          }
          // Anthropic 圖片格式 -> Gemini inline_data
          if (block.type === 'image' && block.source) {
            return {
              inline_data: {
                mime_type: block.source.media_type,
                data: block.source.data,
              },
            };
          }
          return { text: '' };
        });
      } else {
        parts = [{ text: '' }];
      }

      return { role, parts };
    });

    const body = { contents };

    // system prompt -> Gemini 的 system_instruction
    if (system) {
      body.system_instruction = { parts: [{ text: system }] };
    }

    const model = 'gemini-2.5-flash-lite';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      console.error('Gemini error:', JSON.stringify(data));
      return res.status(500).json({ error: 'AI 服務錯誤', detail: data });
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';

    // 包成前端原本就在讀的 Anthropic 格式：data.content[0].text
    return res.status(200).json({ content: [{ text }] });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: '伺服器發生錯誤', detail: String(e) });
  }
}
