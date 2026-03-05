import express from "express";
import cors from "cors";
import multer from "multer";
import { v4 as uuid } from "uuid";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const app = express();

// If you want to lock CORS down later, set CORS_ORIGINS to a comma-separated list
// e.g. "http://localhost:5173,https://your-site.netlify.app"
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
  : null;

app.use(
  cors(
    CORS_ORIGINS
      ? { origin: CORS_ORIGINS, methods: ["GET", "POST", "OPTIONS"] }
      : undefined
  )
);
app.use(express.json());

// Prefer system ffmpeg/ffprobe when provided (Docker/Render)
const FFMPEG =
  process.env.FFMPEG_PATH ||
  (ffmpegStatic?.path || ffmpegStatic) ||
  "ffmpeg";

const FFPROBE =
  process.env.FFPROBE_PATH ||
  (ffprobeStatic?.path || ffprobeStatic) ||
  "ffprobe";

// Font for drawtext (installed via Dockerfile)
const FONTFILE =
  process.env.FONTFILE ||
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

// Ensure dirs exist
const UPLOAD_DIR = "uploads";
const OUT_DIR = "out";
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const upload = multer({ dest: `${UPLOAD_DIR}/` });

// Put your base trader video in ./assets/trader.mp4
const BASE_VIDEO = path.join("assets", "trader.mp4");

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve({ stdout, stderr });
    });
  });
}

async function probeVideo(filePath) {
  const args = [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    filePath,
  ];
  const { stdout } = await run(FFPROBE, args);
  const info = JSON.parse(stdout);
  const v = (info.streams || []).find((s) => s.codec_type === "video");
  const w = Number(v?.width);
  const h = Number(v?.height);
  const duration = Number(info.format?.duration);
  return {
    width: Number.isFinite(w) ? w : null,
    height: Number.isFinite(h) ? h : null,
    duration: Number.isFinite(duration) ? duration : null,
  };
}

// FFmpeg filtergraph gotcha: commas inside expressions must be escaped
function escapeExpr(expr) {
  return String(expr).replace(/,/g, "\\,");
}

function escapeForFFmpeg(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\n/g, " ");
}

app.get("/", (_, res) => res.send("FLOW renderer online"));

app.post("/render", upload.single("image"), async (req, res) => {
  const inputImg = req.file?.path;

  // Always try to clean up
  const safeUnlink = (p) => {
    if (!p) return;
    fs.unlink(p, () => {});
  };

  try {
    if (!fs.existsSync(BASE_VIDEO)) {
      safeUnlink(inputImg);
      return res.status(400).json({ error: "Missing backend/assets/trader.mp4" });
    }

    if (!inputImg) return res.status(400).json({ error: "Missing image upload" });

    // Overlay is always 100% opaque.
    const overlayAlpha = 1.0;

    // Overlay time window (seconds). Default 2..5
    const overlayStart = Number.isFinite(Number(req.body.overlayStart))
      ? Number(req.body.overlayStart)
      : 2;
    const overlayEnd = Number.isFinite(Number(req.body.overlayEnd))
      ? Number(req.body.overlayEnd)
      : 5;

    // Text overlay window (seconds). Default 5..9.28
    const textStart = Number.isFinite(Number(req.body.textStart))
      ? Number(req.body.textStart)
      : 5;
    const textEnd = Number.isFinite(Number(req.body.textEnd))
      ? Number(req.body.textEnd)
      : 9.28;

    // Cut final video (seconds). Default 9.85
    const cutAt = Number.isFinite(Number(req.body.cutAt))
      ? Number(req.body.cutAt)
      : 9.85;

    // Mini zoom bump (applied to base video only)
    const zoomStart = Number.isFinite(Number(req.body.zoomStart))
      ? Number(req.body.zoomStart)
      : overlayEnd;
    const zoomDuration = Number.isFinite(Number(req.body.zoomDuration))
      ? Number(req.body.zoomDuration)
      : 0.4;
    const zoomAmount = Number.isFinite(Number(req.body.zoomAmount))
      ? Number(req.body.zoomAmount)
      : 0.02;

    // Blue disco flash timing
    const discoStart = Number.isFinite(Number(req.body.discoStart))
      ? Number(req.body.discoStart)
      : zoomStart;
    const discoDuration = Number.isFinite(Number(req.body.discoDuration))
      ? Number(req.body.discoDuration)
      : 0.5;
    const discoEnd = discoStart + discoDuration;
    const discoAlpha = Number.isFinite(Number(req.body.discoAlpha))
      ? Number(req.body.discoAlpha)
      : 0.28;

    const { width: W, height: H, duration: D } = await probeVideo(BASE_VIDEO);
    if (!W || !H) {
      safeUnlink(inputImg);
      return res.status(500).json({ error: "Could not read base video dimensions" });
    }

    const outSeconds = Number.isFinite(cutAt)
      ? Math.min(cutAt, D && D > 0 ? D : cutAt)
      : D && D > 0
        ? D
        : undefined;

    // z(t) = 1 + zoomAmount * sin(PI * clip((t-zoomStart)/zoomDuration, 0, 1))
    const zExpr = escapeExpr(
      `1+(${zoomAmount})*sin(PI*clip((t-${zoomStart})/${zoomDuration},0,1))`
    );

    const enableExpr = `between(t,${overlayStart},${overlayEnd})`;
    const mantraText = escapeForFFmpeg(String(req.body.mantra || ""));

    const id = uuid();
    const outMp4 = path.join(OUT_DIR, `${id}.mp4`);

    // Build filter graph
    const filter = [
      // Base video: zoom bump via scale + center crop back to original size
      `[0:v]format=rgba,scale=w=${W}*${zExpr}:h=${H}*${zExpr}:eval=frame,` +
        `crop=${W}:${H}:(in_w-${W})/2:(in_h-${H})/2[b0];`,

      // Disco flash overlay (procedural)
      `color=c=blue:s=${W}x${H},format=rgba,noise=alls=40:allf=t+u,eq=saturation=2.2:contrast=1.15[disco];` +
        `[disco]colorchannelmixer=aa=${discoAlpha}[discoA];` +
        `[b0][discoA]overlay=0:0:enable='between(t,${discoStart},${discoEnd})'[base];`,

      // Fullscreen user image overlay
      `[1:v]format=rgba,scale=${W}:${H}[ol];` +
        `[ol]colorchannelmixer=aa=${overlayAlpha}[ol2];` +
        `[base][ol2]overlay=0:0:enable='${enableExpr}'[v0];` +

        // Text overlay (use explicit fontfile for Docker)
        `[v0]drawtext=fontfile=${escapeForFFmpeg(FONTFILE)}:` +
        `fontcolor=white:fontsize=round(h*0.05):` +
        `text='${mantraText}':x=(w-text_w)/2:y=h-(text_h*1.8):` +
        `enable='between(t,${textStart},${textEnd})'[vid]`,
    ].join("");

    const args = [
      "-y",
      "-i", BASE_VIDEO,
      "-loop", "1",
      "-i", inputImg,
      ...(outSeconds ? ["-t", String(outSeconds)] : []),
      "-filter_complex", filter,
      "-map", "[vid]",
      "-map", "0:a?",
      ...(process.env.FORCE_FPS ? ["-r", String(process.env.FORCE_FPS)] : []),
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-c:a", "copy",
      "-movflags", "+faststart",
      outMp4,
    ];

    await run(FFMPEG, args);

    res.setHeader("Content-Type", "video/mp4");
    const stream = fs.createReadStream(outMp4);
    stream.pipe(res);

    stream.on("close", () => {
      safeUnlink(inputImg);
      safeUnlink(outMp4);
    });
    stream.on("error", () => {
      safeUnlink(inputImg);
      safeUnlink(outMp4);
    });
  } catch (e) {
    safeUnlink(inputImg);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Renderer listening on", PORT));
