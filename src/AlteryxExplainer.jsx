import { useState, useRef, useEffect, useCallback } from "react"

/* ══════════════════════════════════════════════════════════════
   ALTERYX WORKFLOW EXPLAINER
   Upload a .yxmd / .yxmc file → plain-English notes of what it does.
   Design matches the BrainSpark "Notes" document look.
   ══════════════════════════════════════════════════════════════ */

// ── Friendly names for the common Alteryx tools ──────────────────
const TOOL_MAP = {
  DbFileInput: "Input Data", DbFileOutput: "Output Data", TextInput: "Text Input",
  Filter: "Filter", Formula: "Formula", Join: "Join", JoinMultiple: "Join Multiple",
  Union: "Union", AppendFields: "Append Fields", AlteryxSelect: "Select", Sort: "Sort",
  Summarize: "Summarize", Sample: "Sample", Unique: "Unique", RecordID: "Record ID",
  Transpose: "Transpose", CrossTab: "Cross Tab", MultiFieldFormula: "Multi-Field Formula",
  MultiRowFormula: "Multi-Row Formula", TextToColumns: "Text To Columns",
  FindReplace: "Find Replace", DateTime: "DateTime", BrowseV2: "Browse", Browse: "Browse",
  DynamicRename: "Dynamic Rename", GenerateRows: "Generate Rows", RunningTotal: "Running Total",
  ToolContainer: "Container", TextBox: "Comment", LockInInput: "Input Data",
  LockInOutput: "Output Data", DataCleansing: "Data Cleansing", Tile: "Tile",
  RandomRecords: "Random Records", FuzzyMatch: "Fuzzy Match", BlockUntilDone: "Block Until Done",
  // spatial tools
  Buffer: "Buffer", SpatialMatch: "Spatial Match", CreatePoints: "Create Points",
  TradeArea: "Trade Area", FindNearest: "Find Nearest", Distance: "Distance",
  PolyBuild: "Poly Build", PointInPoly: "Point In Polygon", SpatialInfo: "Spatial Info",
  Generalize: "Generalize", Heatmap: "Heat Map", Smooth: "Smooth",
}

// Which "phase" a tool belongs to (used for the local fallback grouping)
const PHASE_OF = {
  "Input Data": "input", "Text Input": "input",
  "Select": "prep", "Filter": "prep", "Sample": "prep", "Unique": "prep", "Sort": "prep",
  "Data Cleansing": "prep", "Dynamic Rename": "prep", "Random Records": "prep", "Tile": "prep",
  "Formula": "transform", "Multi-Field Formula": "transform", "Multi-Row Formula": "transform",
  "Text To Columns": "transform", "Transpose": "transform", "Cross Tab": "transform",
  "Find Replace": "transform", "DateTime": "transform", "Generate Rows": "transform",
  "Record ID": "transform", "Running Total": "transform",
  "Join": "combine", "Join Multiple": "combine", "Union": "combine", "Append Fields": "combine",
  "Fuzzy Match": "combine", "Spatial Match": "combine", "Find Nearest": "combine", "Point In Polygon": "combine",
  "Create Points": "transform", "Buffer": "transform", "Trade Area": "transform",
  "Distance": "transform", "Poly Build": "transform", "Generalize": "transform",
  "Summarize": "aggregate",
  "Output Data": "output", "Browse": "output",
}

const NOISE = new Set(["Container", "Comment", "Block Until Done"])

// ── Helpers ──────────────────────────────────────────────────────
const prettify = s => (s || "").replace(/([a-z])([A-Z])/g, "$1 $2").trim()
const baseName = p => (p || "").split(/[\\/]/).pop().split("?")[0] || p
const clean = s => String(s == null ? "" : s)
  .replace(/\*\*/g, "").replace(/[*#`_~]/g, "")
  .replace(/\s+/g, " ").trim()

function txt(el, sel) {
  const n = el && el.querySelector(sel)
  return n ? n.textContent.trim() : ""
}

// ── Parse the Alteryx XML into tools + connections ───────────────
function parseAlteryx(xmlString) {
  const doc = new DOMParser().parseFromString(xmlString, "text/xml")
  if (doc.querySelector("parsererror") || !doc.querySelector("AlteryxDocument")) {
    throw new Error("This doesn't look like a workflow file. Upload the .yxmd or .yxmc XML (a .yxzp is a zipped package — unzip it first).")
  }

  const tools = {}
  doc.querySelectorAll("Node").forEach(node => {
    const id = node.getAttribute("ToolID")
    if (!id) return
    const gui = node.querySelector(":scope > GuiSettings") || node.querySelector("GuiSettings")
    const plugin = gui ? (gui.getAttribute("Plugin") || "") : ""
    const engine = node.querySelector("EngineSettings")
    const macro = engine ? engine.getAttribute("Macro") : ""

    let type
    if (plugin) {
      const last = plugin.split(".").pop()
      type = TOOL_MAP[last] || prettify(last)
    } else if (macro) {
      type = "Macro: " + baseName(macro).replace(/\.yxmc$/i, "")
    } else {
      type = "Tool"
    }

    const cfg = node.querySelector("Properties > Configuration") || node.querySelector("Configuration")
    const annotation = clean(
      txt(node, "Annotation AnnotationText") || txt(node, "Annotation DefaultAnnotationText")
    )
    tools[id] = { id, type, plugin, annotation, detail: extractDetail(type, cfg) }
  })

  const connections = []
  doc.querySelectorAll("Connection").forEach(c => {
    const o = c.querySelector("Origin"), d = c.querySelector("Destination")
    if (o && d) connections.push({ from: o.getAttribute("ToolID"), to: d.getAttribute("ToolID") })
  })

  return { tools, connections }
}

// Pull the one or two config bits that explain what a tool is set to do
function extractDetail(type, cfg) {
  if (!cfg) return ""
  const get = sel => txt(cfg, sel)
  try {
    if (type === "Input Data" || type === "Output Data")
      return baseName(get("File"))
    if (type === "Filter")
      return clean(get("Expression")) || clean(get("Simple Field") + " " + get("Simple Operator") + " " + get("Simple Operands StringValue")) || "row condition"
    if (type === "Formula") {
      const f = [...cfg.querySelectorAll("FormulaField")].map(e =>
        `${e.getAttribute("field")} = ${e.getAttribute("expression")}`)
      return clean(f.slice(0, 4).join("; "))
    }
    if (type === "Summarize") {
      const f = [...cfg.querySelectorAll("SummarizeField")].map(e =>
        `${e.getAttribute("action")} ${e.getAttribute("field")}`)
      return clean(f.slice(0, 6).join(", "))
    }
    if (type === "Join" || type === "Join Multiple") {
      const f = [...cfg.querySelectorAll("JoinInfo Field")].map(e => e.getAttribute("field"))
      return clean([...new Set(f)].slice(0, 4).join(", "))
    }
    if (type === "Sort") {
      const f = [...cfg.querySelectorAll("SortInfo Field")].map(e =>
        `${e.getAttribute("field")} ${e.getAttribute("order")}`)
      return clean(f.slice(0, 4).join(", "))
    }
    if (type === "Select") {
      const fields = [...cfg.querySelectorAll("SelectField")]
      const renamed = fields.filter(e => e.getAttribute("rename")).length
      const dropped = fields.filter(e => e.getAttribute("selected") === "False").length
      const bits = []
      if (dropped) bits.push(`${dropped} field${dropped > 1 ? "s" : ""} removed`)
      if (renamed) bits.push(`${renamed} renamed`)
      return bits.join(", ")
    }
  } catch { /* ignore */ }
  // generic fallback
  const t = clean(cfg.textContent).slice(0, 160)
  return t
}

// Sort tools into execution order (sources → outputs)
function executionOrder({ tools, connections }) {
  const ids = Object.keys(tools)
  const indeg = {}, adj = {}
  ids.forEach(id => { indeg[id] = 0; adj[id] = [] })
  connections.forEach(({ from, to }) => {
    if (adj[from] && to in indeg) { adj[from].push(to); indeg[to]++ }
  })
  const queue = ids.filter(id => indeg[id] === 0).sort((a, b) => +a - +b)
  const ordered = [], seen = new Set()
  while (queue.length) {
    const id = queue.shift()
    if (seen.has(id)) continue
    seen.add(id); ordered.push(id)
    adj[id].sort((a, b) => +a - +b).forEach(n => { if (--indeg[n] === 0) queue.push(n) })
  }
  ids.forEach(id => { if (!seen.has(id)) ordered.push(id) }) // any leftovers
  return ordered.map(id => tools[id]).filter(t => !NOISE.has(t.type))
}

// Build the compact brief we hand to the model
function buildBrief(parsed, ordered) {
  const lines = ordered.map((t, i) => {
    let s = `${i + 1}. ${t.type}`
    if (t.annotation) s += ` — labelled "${t.annotation}"`
    if (t.detail) s += ` [${t.detail}]`
    return s
  })
  return `An Alteryx workflow with ${ordered.length} active tools, in execution order:\n${lines.join("\n")}`
}

// ── Model call → your Groq backend (api/explain-alteryx.js) ──
async function callLLM(brief) {
  const r = await fetch("/api/explain-alteryx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brief }),
  }).then(res => res.json())
  if (r.error) throw new Error(r.error)
  return safeParse(r.content)
}

function safeParse(text) {
  let s = String(text || "").replace(/```[\w]*\n?/gi, "").trim()
  try { return JSON.parse(s) } catch { /* try to recover a truncated tail */ }
  const start = s.indexOf("{")
  if (start > -1) {
    for (let end = s.length; end > start; end--) {
      try { return JSON.parse(s.slice(start, end)) } catch { /* keep trimming */ }
    }
  }
  return null
}

// ── Offline fallback: build the same shape from the parsed tools ──
function localExplain(parsed, ordered) {
  const buckets = { input: [], prep: [], transform: [], combine: [], aggregate: [], output: [] }
  ordered.forEach(t => (buckets[PHASE_OF[t.type] || "transform"]).push(t))
  const META = {
    input: ["📥", "Bring In the Data", "Connects to the source files and pulls records into the workflow."],
    prep: ["🧹", "Clean and Prepare", "Trims the data to the rows and columns that matter."],
    transform: ["⚙️", "Transform and Calculate", "Creates new fields and reshapes values."],
    combine: ["🔗", "Combine the Streams", "Brings separate data streams together."],
    aggregate: ["📊", "Summarise", "Rolls the records up into totals and groups."],
    output: ["📤", "Deliver the Result", "Writes out or displays the finished data."],
  }
  const parts = Object.entries(buckets).filter(([, v]) => v.length).map(([k, v]) => {
    const [emoji, name, summary] = META[k]
    return {
      emoji, name, summary,
      steps: v.map(t => ({
        tool: t.type,
        action: t.annotation || (t.detail ? `${t.type} — ${t.detail}` : `Applies a ${t.type} step.`),
      })),
    }
  })
  const inputs = ordered.filter(t => t.type === "Input Data" && t.detail).map(t => t.detail)
  const outputs = ordered.filter(t => t.type === "Output Data" && t.detail).map(t => t.detail)
  const spatial = ordered.some(t => /Buffer|Spatial|Trade Area|Point In|Find Nearest|Create Points/.test(t.type))
  const matching = ordered.some(t => /Join|Fuzzy/.test(t.type))
  let outcome = `A processed data set built from ${inputs.length || "the"} source${inputs.length === 1 ? "" : "s"}.`
  if (spatial) outcome = "A set of records filtered by location — the rows that fall inside the geographic zone the workflow builds."
  else if (matching) outcome = "Two data sets matched together on shared key or address fields."
  return {
    title: "Alteryx Workflow",
    outcome,
    overview: `This workflow runs ${ordered.length} tools. It reads the source data, prepares and transforms it${spatial ? ", works out which records fall inside a geographic area" : ""}${matching ? ", matches records across data sets" : ""}, and writes out the result. The notes below walk through it in execution order.`,
    purpose: "Automates a data preparation and reporting task.",
    inputs: inputs.length ? inputs : ["Source data"],
    outputs: outputs.length ? outputs : ["Processed output"],
    parts,
    takeaways: ["Generated offline from the workflow structure — connect a model for richer explanations."],
  }
}

// ══════════════════════════════════════════════════════════════
//  UI tokens (matched to the BrainSpark notes look)
// ══════════════════════════════════════════════════════════════
const C = {
  parchment: "#f0efe9", paper: "#ffffff", ink: "#1a1a2e", body: "#374151",
  muted: "#64748b", accent: "#3730a3", accent2: "#6366F1", line: "#e2e8f0",
}
const STAT = [
  { key: "tools", label: "Tools", color: "#6366F1" },
  { key: "inputs", label: "Inputs", color: "#10B981" },
  { key: "outputs", label: "Outputs", color: "#EF4444" },
  { key: "joins", label: "Joins", color: "#A855F7" },
  { key: "formulas", label: "Formulas", color: "#F59E0B" },
  { key: "filters", label: "Filters", color: "#06b6d4" },
]

function Spinner({ size = 16, c = "#fff" }) {
  return <span style={{ width: size, height: size, display: "inline-block", border: `2px solid rgba(0,0,0,.12)`, borderTopColor: c, borderRadius: "50%", animation: "axspin .7s linear infinite" }} />
}

export default function App() {
  const [stage, setStage] = useState("upload") // upload | ready | loading | done
  const [parsed, setParsed] = useState(null)
  const [ordered, setOrdered] = useState([])
  const [fileName, setFileName] = useState("")
  const [result, setResult] = useState(null)
  const [usedLocal, setUsedLocal] = useState(false)
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const [drag, setDrag] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (document.getElementById("ax-fonts")) return
    const l = document.createElement("link")
    l.id = "ax-fonts"; l.rel = "stylesheet"
    l.href = "https://fonts.googleapis.com/css2?family=Lora:wght@400;600;700&family=Source+Sans+3:wght@400;600;700&family=Sora:wght@700;800;900&display=swap"
    document.head.appendChild(l)
    const s = document.createElement("style")
    s.textContent = "@keyframes axspin{to{transform:rotate(360deg)}}@keyframes axup{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}"
    document.head.appendChild(s)
  }, [])

  const stats = parsed ? {
    tools: ordered.length,
    inputs: ordered.filter(t => t.type === "Input Data").length,
    outputs: ordered.filter(t => t.type === "Output Data").length,
    joins: ordered.filter(t => /Join|Union|Append/.test(t.type)).length,
    formulas: ordered.filter(t => /Formula/.test(t.type)).length,
    filters: ordered.filter(t => t.type === "Filter").length,
  } : {}

  const handleFile = useCallback(file => {
    if (!file) return
    setError(""); setResult(null)
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const p = parseAlteryx(e.target.result)
        const ord = executionOrder(p)
        if (!ord.length) throw new Error("No active tools found in this workflow.")
        setParsed(p); setOrdered(ord); setFileName(file.name); setStage("ready")
      } catch (err) { setError(err.message); setStage("upload") }
    }
    reader.onerror = () => setError("Could not read that file.")
    reader.readAsText(file)
  }, [])

  async function analyse() {
    setStage("loading"); setError(""); setUsedLocal(false)
    setStatus("Reading the tools and connections…")
    const brief = buildBrief(parsed, ordered)
    try {
      setStatus("Working out what each phase does…")
      const r = await callLLM(brief)
      if (r && r.parts && r.parts.length) { setResult(r); setStage("done"); return }
      throw new Error("empty")
    } catch {
      setResult(localExplain(parsed, ordered)); setUsedLocal(true); setStage("done")
    }
  }

  function reset() {
    setStage("upload"); setParsed(null); setOrdered([]); setResult(null)
    setFileName(""); setError(""); setUsedLocal(false)
    if (inputRef.current) inputRef.current.value = ""
  }

  function plainText() {
    if (!result) return ""
    const L = [clean(result.title), "",
      "WHAT YOU GET: " + clean(result.outcome), "",
      clean(result.overview), "",
      "Purpose: " + clean(result.purpose), "",
      "Inputs: " + (result.inputs || []).map(clean).join(", "),
      "Outputs: " + (result.outputs || []).map(clean).join(", "), ""]
    ;(result.parts || []).forEach((p, i) => {
      L.push(`Part ${i + 1} — ${clean(p.name)}`)
      L.push(clean(p.summary))
      ;(p.steps || []).forEach(s => L.push(`  • ${clean(s.tool)}: ${clean(s.action)}`))
      L.push("")
    })
    if (result.takeaways) { L.push("Key takeaways:"); result.takeaways.forEach(t => L.push("  • " + clean(t))) }
    return L.join("\n")
  }

  function downloadHTML() {
    const r = result
    const esc = s => clean(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    const parts = (r.parts || []).map((p, i) => `
      <section><h2>${i + 1}. ${esc(p.name)}</h2><p class="sum">${esc(p.summary)}</p>
      ${(p.steps || []).map(s => `<div class="step"><b>${esc(s.tool)}</b> — ${esc(s.action)}</div>`).join("")}</section>`).join("")
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(r.title)}</title>
      <style>body{font-family:'Source Sans 3',Georgia,sans-serif;max-width:780px;margin:40px auto;color:#374151;line-height:1.8;padding:0 24px}
      h1{font-family:'Lora',serif;color:#1a1a2e;border-bottom:3px solid #3730a3;padding-bottom:14px}
      h2{font-family:'Lora',serif;color:#3730a3;margin-top:32px}
      .sum{color:#64748b;font-style:italic}.step{padding:8px 0;border-bottom:1px solid #eee}
      .chip{display:inline-block;background:#eef;border:1px solid #ccd;border-radius:20px;padding:2px 10px;margin:2px;font-size:13px}
      .outcome{background:#312e81;color:#fff;border-radius:12px;padding:18px 22px;margin:18px 0}
      .outcome .lbl{font-size:11px;letter-spacing:.8px;color:#c7d2fe;font-weight:700}
      .outcome .big{font-family:'Lora',serif;font-size:20px;font-weight:700;line-height:1.45;margin-top:6px}
      @media print{body{margin:0}}</style></head><body>
      <h1>${esc(r.title)}</h1>
      <div class="outcome"><div class="lbl">WHAT YOU GET OUT OF THIS WORKFLOW</div><div class="big">${esc(r.outcome)}</div></div>
      <p>${esc(r.overview)}</p>
      <p><b>Purpose:</b> ${esc(r.purpose)}</p>
      <p><b>Inputs:</b> ${(r.inputs || []).map(x => `<span class="chip">${esc(x)}</span>`).join("")}<br>
      <b>Outputs:</b> ${(r.outputs || []).map(x => `<span class="chip">${esc(x)}</span>`).join("")}</p>
      ${parts}${(r.takeaways || []).length ? `<h2>Key takeaways</h2>${r.takeaways.map(t => `<div class="step">${esc(t)}</div>`).join("")}` : ""}
      </body></html>`
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }))
    a.download = clean(r.title).replace(/\s+/g, "-") + ".html"; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  return (
    <div style={{ minHeight: "100vh", background: C.parchment, fontFamily: "'Source Sans 3',system-ui,sans-serif", color: C.body }}>
      {/* header */}
      <div style={{ borderBottom: "1px solid rgba(15,23,42,.08)", background: "rgba(255,255,255,.8)", backdropFilter: "blur(10px)", padding: "14px 5%", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: `linear-gradient(135deg,${C.accent2},#8B5CF6)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🧭</div>
          <span style={{ fontFamily: "'Sora',sans-serif", fontWeight: 900, fontSize: 17, color: C.ink }}>Alteryx <span style={{ color: C.accent2 }}>Explainer</span></span>
        </div>
        {stage !== "upload" && <button onClick={reset} style={ghost}>↺ New file</button>}
      </div>

      <div style={{ maxWidth: 880, margin: "0 auto", padding: "28px 20px 60px" }}>

        {/* ── Upload ── */}
        {stage === "upload" && (
          <div style={{ animation: "axup .25s ease" }}>
            <h1 style={{ fontFamily: "'Sora',sans-serif", fontWeight: 900, fontSize: "clamp(22px,4vw,34px)", color: C.ink, margin: "10px 0 6px", lineHeight: 1.15 }}>
              Understand any Alteryx workflow in seconds
            </h1>
            <p style={{ color: C.muted, fontSize: 15, marginBottom: 26 }}>Drop a workflow file and get a clean, plain-English summary — the whole flow first, then five steps explaining how it works.</p>

            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDrag(true) }}
              onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]) }}
              style={{ border: `2px dashed ${drag ? C.accent2 : "rgba(15,23,42,.18)"}`, background: drag ? "rgba(99,102,241,.06)" : C.paper, borderRadius: 16, padding: "48px 24px", textAlign: "center", cursor: "pointer", transition: "all .15s", boxShadow: "0 1px 10px rgba(15,23,42,.05)" }}>
              <div style={{ fontSize: 42, marginBottom: 10 }}>📂</div>
              <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, color: C.ink, fontSize: 16 }}>Drop your workflow here</div>
              <div style={{ color: C.muted, fontSize: 13, marginTop: 6 }}>or click to browse — accepts <b>.yxmd</b>, <b>.yxmc</b>, <b>.yxwz</b></div>
              <input ref={inputRef} type="file" accept=".yxmd,.yxmc,.yxwz,.xml" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
            </div>
            {error && <Err msg={error} />}
          </div>
        )}

        {/* ── Ready (parsed, awaiting analysis) ── */}
        {stage === "ready" && (
          <div style={{ animation: "axup .25s ease" }}>
            <div style={{ ...card, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: C.accent2, textTransform: "uppercase", letterSpacing: ".6px" }}>File loaded</div>
                  <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 16, color: C.ink, marginTop: 3 }}>{fileName}</div>
                </div>
                <button onClick={analyse} style={primary}>✨ Explain this workflow</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 10, marginTop: 18 }}>
                {STAT.map(s => (
                  <div key={s.key} style={{ background: `${s.color}14`, border: `1px solid ${s.color}25`, borderRadius: 12, padding: "12px 8px", textAlign: "center" }}>
                    <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 900, fontSize: 22, color: s.color }}>{stats[s.key]}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ ...card, maxHeight: 320, overflowY: "auto" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>Tools detected, in execution order</div>
              {ordered.map((t, i) => (
                <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "5px 0", borderBottom: "1px solid #f1f1ee" }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: C.accent2, minWidth: 22 }}>{i + 1}.</span>
                  <span style={{ fontWeight: 700, color: C.ink, fontSize: 14 }}>{t.type}</span>
                  {t.annotation && <span style={{ fontSize: 12.5, color: C.muted, fontStyle: "italic" }}>“{t.annotation}”</span>}
                  {!t.annotation && t.detail && <span style={{ fontSize: 12.5, color: C.muted }}>— {t.detail}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Loading ── */}
        {stage === "loading" && (
          <div style={{ ...card, textAlign: "center", padding: 50 }}>
            <Spinner size={34} c={C.accent2} />
            <div style={{ marginTop: 16, fontFamily: "'Sora',sans-serif", fontWeight: 700, color: C.ink, fontSize: 16 }}>Writing your notes…</div>
            <div style={{ color: C.muted, fontSize: 13, marginTop: 6 }}>{status}</div>
          </div>
        )}

        {/* ── Done: the notes document ── */}
        {stage === "done" && result && (
          <div style={{ animation: "axup .3s ease" }}>
            {/* toolbar */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {["#ef4444", "#f59e0b", "#22c55e"].map(c => <span key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c }} />)}
                <span style={{ fontSize: 12, color: C.muted, marginLeft: 4 }}>{fileName}</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { navigator.clipboard?.writeText(plainText()); setCopied(true); setTimeout(() => setCopied(false), 1500) }} style={ghost}>{copied ? "✓ Copied" : "⧉ Copy"}</button>
                <button onClick={downloadHTML} style={primary}>⬇ Download</button>
              </div>
            </div>

            {usedLocal && <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 10, padding: "9px 14px", marginBottom: 14, fontSize: 13, color: "#9a3412" }}>Generated from the workflow structure (the model wasn't reachable). Connect your Groq/OpenAI backend for richer explanations.</div>}

            {/* the white paper */}
            <div style={{ background: C.paper, borderRadius: 12, padding: "clamp(26px,5vw,56px) clamp(20px,6vw,64px)", boxShadow: "0 4px 24px rgba(0,0,0,.10)" }}>
              {/* header */}
              <div style={{ borderBottom: `3px solid ${C.accent}`, paddingBottom: 18, marginBottom: 26 }}>
                <h1 style={{ fontFamily: "'Lora',Georgia,serif", fontWeight: 700, fontSize: "clamp(22px,4vw,30px)", color: C.ink, margin: "0 0 8px", lineHeight: 1.25 }}>{clean(result.title)}</h1>
                <div style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}><span style={{ color: C.accent }}>Workflow Summary</span> · Alteryx</div>
              </div>

              {/* the headline outcome — what you actually get */}
              {result.outcome && (
                <div style={{ background: "linear-gradient(135deg,#312e81,#4338ca)", borderRadius: 14, padding: "20px 24px", marginBottom: 24 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "#c7d2fe", letterSpacing: ".8px", marginBottom: 7 }}>WHAT YOU GET OUT OF THIS WORKFLOW</div>
                  <div style={{ fontFamily: "'Lora',Georgia,serif", fontWeight: 700, fontSize: "clamp(17px,2.6vw,23px)", color: "#fff", lineHeight: 1.45 }}>{clean(result.outcome)}</div>
                </div>
              )}

              {/* overview */}
              <h2 style={hLora}>What this workflow does</h2>
              <p style={para}>{clean(result.overview)}</p>

              {/* purpose */}
              {result.purpose && (
                <div style={{ background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 10, padding: "10px 16px", margin: "14px 0", fontSize: 14, color: C.accent, fontWeight: 600 }}>
                  🎯 {clean(result.purpose)}
                </div>
              )}

              {/* inputs / outputs */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16, margin: "18px 0 6px" }}>
                <ChipBox title="Data in" emoji="📥" items={result.inputs} color="#10B981" />
                <ChipBox title="Data out" emoji="📤" items={result.outputs} color="#EF4444" />
              </div>

              <hr style={{ border: "none", borderTop: `1px solid ${C.line}`, margin: "26px 0" }} />

              {/* the parts */}
              <h2 style={hLora}>Step by step</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 10 }}>
                {(result.parts || []).map((p, i) => (
                  <div key={i} style={{ borderRadius: 14, border: "1px solid #e8e6f5", overflow: "hidden", background: "#fafaff" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", background: "linear-gradient(135deg,#eef2ff,#f6f4ff)", borderBottom: "1px solid #e8e6f5" }}>
                      <div style={{ width: 38, height: 38, borderRadius: 11, background: C.paper, border: "1px solid #ddd", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, flexShrink: 0 }}>{clean(p.emoji) || (i + 1)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: C.accent2, letterSpacing: ".5px" }}>PART {i + 1}</div>
                        <div style={{ fontFamily: "'Lora',serif", fontWeight: 700, fontSize: 17, color: C.ink, marginTop: 1 }}>{clean(p.name)}</div>
                      </div>
                    </div>
                    <div style={{ padding: "14px 18px 16px" }}>
                      {p.summary && <p style={{ ...para, color: C.muted, fontStyle: "italic", marginBottom: 12 }}>{clean(p.summary)}</p>}
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {(p.steps || []).map((s, j) => (
                          <div key={j} style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                            <span style={{ background: C.accent, color: "#fff", borderRadius: 8, padding: "2px 9px", fontSize: 11.5, fontWeight: 700, flexShrink: 0, marginTop: 2 }}>{clean(s.tool)}</span>
                            <span style={{ fontSize: 14, color: C.body, lineHeight: 1.7 }}>{clean(s.action)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* takeaways */}
              {(result.takeaways || []).length > 0 && (
                <>
                  <hr style={{ border: "none", borderTop: `1px solid ${C.line}`, margin: "26px 0" }} />
                  <h2 style={hLora}>Key takeaways</h2>
                  {result.takeaways.map((t, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, marginBottom: 6 }}>
                      <span style={{ color: C.accent2, fontWeight: 800 }}>★</span>
                      <span style={{ fontSize: 14, color: C.body, lineHeight: 1.7 }}>{clean(t)}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── small bits ───────────────────────────────────────────────────
function ChipBox({ title, emoji, items, color }) {
  return (
    <div style={{ background: `${color}0d`, border: `1px solid ${color}26`, borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, color, marginBottom: 8 }}>{emoji} {title.toUpperCase()}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {(items || []).length ? items.map((x, i) => (
          <span key={i} style={{ background: "#fff", border: `1px solid ${color}33`, color: C.ink, borderRadius: 20, padding: "3px 11px", fontSize: 12.5, fontWeight: 600 }}>{clean(x)}</span>
        )) : <span style={{ fontSize: 12.5, color: C.muted }}>—</span>}
      </div>
    </div>
  )
}
function Err({ msg }) {
  return <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "11px 15px", marginTop: 14, fontSize: 13.5, color: "#b91c1c", fontWeight: 600 }}>⚠ {msg}</div>
}

const card = { background: C.paper, border: "1px solid rgba(15,23,42,.08)", borderRadius: 14, padding: 20, boxShadow: "0 1px 10px rgba(15,23,42,.05)" }
const primary = { background: `linear-gradient(135deg,${C.accent},#6366F1)`, color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "'Source Sans 3',sans-serif" }
const ghost = { background: "rgba(15,23,42,.04)", color: C.body, border: "1px solid rgba(15,23,42,.12)", borderRadius: 9, padding: "8px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "'Source Sans 3',sans-serif" }
const hLora = { fontFamily: "'Lora',Georgia,serif", fontWeight: 700, fontSize: "clamp(18px,2.5vw,22px)", color: C.ink, margin: "10px 0 8px" }
const para = { color: C.body, fontSize: 15, lineHeight: 1.85, margin: 0 }
