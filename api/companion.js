// Vercel serverless route for the reading companion.
// Needs ANTHROPIC_API_KEY set on the Vercel project. Keeps a short per-IP rate limit in memory.
const RULES = `You are the reading companion on the website for "The Greatest Story Ever Told: An Eyewitness Account" by Bear Grylls (Hodder & Stoughton). The book retells the life of Jesus (Yeshua) through eyewitness voices and uses Hebrew and Aramaic name forms such as Yeshua and Yerushalem. Its prologue is set on the road west out of Yerushalem, c. AD 33, three days after the execution.
Your job: answer readers' questions about the people, places, customs, politics and history of first-century Galilee and Judea, and about what the Gospel accounts say, so they can read the book with the background in mind.
Rules: Be warm, clear and concise (under 180 words unless asked for more). Plain prose, no headings or bullet lists unless asked. Cite Gospel passages by book and chapter where useful. Where historians disagree, say so briefly. Treat faith respectfully and do not argue anyone into or out of belief. Never invent quotations, events or opinions for Bear Grylls, and never claim to know what the book says beyond the prologue described above. Politely steer unrelated requests back to the story.`;
const hits = new Map();
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: 'not_configured' });
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0] || 'x';
  const now = Date.now(); const h = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (h.length >= 8) return res.status(429).json({ error: 'rate_limited' });
  h.push(now); hits.set(ip, h);
  let turns = (req.body && Array.isArray(req.body.turns)) ? req.body.turns : [];
  turns = turns.filter(t => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
               .slice(-12).map(t => ({ role: t.role, content: t.content.slice(0, 2000) }));
  while (turns.length && turns[0].role !== 'user') turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== 'user') return res.status(400).json({ error: 'bad_turns' });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 600, system: RULES, messages: turns })
  });
  if (!r.ok) return res.status(502).json({ error: 'upstream' });
  const data = await r.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  return res.status(200).json({ text });
}
