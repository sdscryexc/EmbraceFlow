import React, { useMemo, useState } from "react";

const FLOW_BANK = [
  "You are resisting.",
  "Flowing.",
  "The tide knows.",
  "Downward flow is still flow.",
  "High tide soon.",
  "The current never lies.",
  "Breathe. Then flow.",
  "Sideways is sacred.",
  "This is a test of depth.",
  "Some are not ready.",
  "Fear creates undertow.",
  "The ocean is calm below.",
  "Zoom out. You’re splashing.",
  "Storms reveal alignment.",
  "The weak fight waves.",
  "The deep remains still.",
  "Red is part of the ritual.",
  "You are early in the tide.",
  "Panic is surface-level.",
  "Let the candle breathe.",
  "The deep has inhaled.",
  "Whales don’t splash.",
  "Ocean just moved.",
  "Tide rising.",
  "That was inevitable.",
  "The current accelerates.",
  "Alignment confirmed.",
  "Someone felt this coming.",
  "Liquidity is awakening.",
  "The water thickens.",
  "Does it flow though?",
  "Chasing creates suffering.",
  "Pumps are temporary. Flow is eternal.",
  "Are you riding or chasing?",
  "Not everything is liquid.",
  "Only water survives.",
  "We do not chase candles.",
  "The tide chooses.",
  "Some currents are artificial.",
  "Real flow is quiet.",
  "In chaos, we float.",
  "Storms pass. Oceans remain.",
  "Depth is earned in volatility.",
  "Stillness is power.",
  "The world shakes. We flow.",
  "Only the surface panics.",
  "Turbulence builds character.",
  "The tide outlasts headlines.",
  "Find your depth.",
  "Embrace the flow.",
];

const DEFAULT_RENDER_URL = "http://localhost:8080"; // change after you deploy backend
const RENDER_URL = import.meta.env.VITE_RENDER_URL || DEFAULT_RENDER_URL;

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export default function App() {
  const [file, setFile] = useState(null);
  const [mantra, setMantra] = useState("Flowing.");
  const [busy, setBusy] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [err, setErr] = useState("");

  const canRender = useMemo(() => !!file && !busy, [file, busy]);

  async function onRender() {
    setErr("");
    setVideoUrl("");
    if (!file) return;

    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      fd.append("mantra", mantra);

      const resp = await fetch(`${RENDER_URL}/render`, { method: "POST", body: fd });
      if (!resp.ok) {
        const msg = await resp.text();
        throw new Error(msg || "Render failed");
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gen-grid">
      <div className="gen-card">
        <h3>1) Upload a vessel</h3>
        <div className="gen-sub">Upload any photo. It will be used as a fullscreen overlay.</div>

        <div className="file-input gen-field">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </div>

        <div className="gen-field">
          <div className="gen-label">2) Choose a mantra</div>

          <div className="gen-row" style={{ marginTop: ".55rem" }}>
            <input
              value={mantra}
              onChange={(e) => setMantra(e.target.value)}
              className="gen-input"
              placeholder="Flowing."
              maxLength={120}
            />
            <button
              onClick={() => setMantra(randomFrom(FLOW_BANK))}
              className="btn-glow gen-btn"
              type="button"
              style={{ padding: ".95rem 1.5rem", fontSize: ".7rem", letterSpacing: ".18em" }}
            >
              Random
            </button>
          </div>

          <div className="gen-helper">
            Backend URL: <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>{RENDER_URL}</span>
          </div>
        </div>

        <div className="gen-field">
          <button
            disabled={!canRender}
            onClick={onRender}
            className="btn-glow"
            type="button"
            style={{
              width: "100%",
              opacity: canRender ? 1 : 0.45,
              pointerEvents: canRender ? "auto" : "none",
            }}
          >
            {busy ? "Rendering…" : "Generate your FLOW clip"}
          </button>

          {err ? <div className="gen-error">{err}</div> : null}
        </div>
      </div>

      <div className="gen-card">
        <h3>Output</h3>
        <div className="gen-sub">Your generated MP4 will appear here.</div>

        <div className="gen-output-box">
          {videoUrl ? (
            <video src={videoUrl} controls className="gen-video" />
          ) : (
            <div className="gen-placeholder">No clip yet.</div>
          )}
        </div>

        {videoUrl ? (
          <a
            href={videoUrl}
            download="flow.mp4"
            className="btn-glow"
            style={{
              display: "inline-flex",
              width: "100%",
              justifyContent: "center",
              marginTop: "1rem",
              textDecoration: "none",
            }}
          >
            Download MP4
          </a>
        ) : null}

        <div className="gen-helper" style={{ marginTop: "1.2rem" }}>
          Tip: This generator creates a stylized overlay (not a face swap). It’s lore, not financial advice.
        </div>
      </div>
    </div>
  );
}
