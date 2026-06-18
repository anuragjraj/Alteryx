import Groq from "groq-sdk"

const MODEL = "llama-3.3-70b-versatile"
const SYS = "You are a senior Alteryx engineer. Respond only with valid json. No markdown, no backticks, no asterisks, plain words only."

export default async function handler(req, res) {
  // Health check: open /api/explain-alteryx in your browser.
  // Should return { ok: true, hasKey: true }. If hasKey is false, the env var isn't set/redeployed.
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, hasKey: Boolean(process.env.GROQ_API_KEY), model: MODEL })
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: "GROQ_API_KEY is missing. Add it in Vercel - Settings - Environment Variables, then redeploy." })
  }

  // Body can arrive as an object or a raw string depending on the runtime.
  let body = req.body
  if (typeof body === "string") { try { body = JSON.parse(body) } catch { body = {} } }
  const brief = body && body.brief
  if (!brief) return res.status(400).json({ error: "Missing 'brief' in request body" })

  const prompt = `${brief}

Return ONLY this json shape (plain words, no symbols):
{"title":"","outcome":"one clear sentence naming the concrete real-world result this workflow produces","overview":"4 to 6 sentences in business terms: what goes in, the main thing it figures out, and what comes out","purpose":"one short line","inputs":[],"outputs":[],"parts":[{"name":"","emoji":"one emoji","summary":"2 short sentences on what this phase achieves and why it matters","steps":[{"tool":"","action":""}]}],"takeaways":[]}

Work out the real goal from the tools, do not just list them:
- Create Points turns latitude/longitude into map points. Buffer or Trade Area draws a zone of a set distance around something. Spatial Match or Point In Polygon keeps only the records that fall inside that zone (for example, buildings inside a buffer). Find Nearest pairs each record with its closest neighbour by distance.
- Join, Fuzzy Match or Find Replace on name or address fields means matching records between two lists (for example, address matching).
- Summarize produces counts or totals per group.
Say plainly what we end up with. Group the tools into 4 to 6 logical phases (aim for 5), in order. Keep every value concise and free of symbols.`

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
  const messages = [
    { role: "system", content: SYS },
    { role: "user", content: prompt },
  ]

  try {
    const r = await groq.chat.completions.create({
      model: MODEL, temperature: 0.3, max_tokens: 2048,
      response_format: { type: "json_object" }, messages,
    })
    return res.status(200).json({ content: r.choices?.[0]?.message?.content || "" })
  } catch (e) {
    console.error("Groq error:", e?.status, e?.message)
    // Retry once without JSON mode, in case the model/account rejects response_format.
    try {
      const r2 = await groq.chat.completions.create({
        model: MODEL, temperature: 0.3, max_tokens: 2048, messages,
      })
      return res.status(200).json({ content: r2.choices?.[0]?.message?.content || "" })
    } catch (e2) {
      console.error("Groq retry error:", e2?.status, e2?.message)
      return res.status(500).json({
        error: e2?.message || e?.message || "Groq request failed",
        status: e2?.status || e?.status || null,
      })
    }
  }
}