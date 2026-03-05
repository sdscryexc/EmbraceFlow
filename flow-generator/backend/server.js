import express from "express";
import cors from "cors";
import multer from "multer";
import { v4 as uuid } from "uuid";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobePath from "ffprobe-static";

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

// Put your base trader video in ./assets/trader.mp4
// Requirement: keep original video size (no crop/pad).
const BASE_VIDEO = path.join("assets", "trader.mp4");
// Requirement: output should have the same length as the base video.
const OUT_DIR = "out";
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve({ stdout, stderr });
    });
  });
}

async function probeVideo(filePath) {
  // ffprobe-static exports { path } in CommonJS and default export in ESM builds; normalize.
  const fp = (ffprobePath && (ffprobePath.path || ffprobePath)) || "ffprobe";
  const args = [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    filePath,
  ];
  const { stdout } = await run(fp, args);
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

// FFmpeg filtergraph gotcha (esp. on Windows): commas inside expressions must be escaped,
// otherwise they are interpreted as filter separators.
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
  try {
    if (!fs.existsSync(BASE_VIDEO)) {
      return res.status(400).json({ error: "Missing backend/assets/trader.mp4" });
    }

    // Overlay is always 100% opaque.
    const overlayAlpha = 1.0;

    // Overlay time window (seconds). Requirement: from 00:02:00 to 00:05:00.
    // Interpreted as 2s..5s for ~10s clips. Override by sending overlayStart/overlayEnd.
    const overlayStart = Number.isFinite(Number(req.body.overlayStart))
      ? Number(req.body.overlayStart)
      : 2;
    const overlayEnd = Number.isFinite(Number(req.body.overlayEnd))
      ? Number(req.body.overlayEnd)
      : 5;


    // Text overlay window (seconds). Requirement: from 00:05:00 until 00:09:28 (interpreted as 5.0s..9.28s).
    const textStart = Number.isFinite(Number(req.body.textStart))
      ? Number(req.body.textStart)
      : 5;
    const textEnd = Number.isFinite(Number(req.body.textEnd))
      ? Number(req.body.textEnd)
      : 9.28;

    // Cut final video at 00:09:28 (interpreted as 9.28s). Override by sending cutAt.
    const cutAt = Number.isFinite(Number(req.body.cutAt))
      ? Number(req.body.cutAt)
      : 9.85;

    // Mini zoom (applied to the BASE video only). Default: short zoom at end of overlay window.
    const zoomStart = Number.isFinite(Number(req.body.zoomStart))
      ? Number(req.body.zoomStart)
      : overlayEnd;
    const zoomDuration = Number.isFinite(Number(req.body.zoomDuration))
      ? Number(req.body.zoomDuration)
      : 0.4;
    const zoomAmount = Number.isFinite(Number(req.body.zoomAmount))
      ? Number(req.body.zoomAmount)
      : 0.02; // +2%

    const inputImg = req.file?.path;
    if (!inputImg) return res.status(400).json({ error: "Missing image upload" });

    const id = uuid();
    // No background removal (use uploaded image as-is).
    const overlayImg = inputImg;
    const outMp4 = path.join(OUT_DIR, `${id}.mp4`);

    const { width: W, height: H, duration: D } = await probeVideo(BASE_VIDEO);
    if (!W || !H) {
      return res.status(500).json({ error: "Could not read base video dimensions" });
    }
    const outSeconds = Number.isFinite(cutAt) ? Math.min(cutAt, (D && D > 0 ? D : cutAt)) : (D && D > 0 ? D : undefined);

    // Mini zoom "bump" (zoom in then back out). This matches a quick scene-switch punch.
    // z(t) = 1 + zoomAmount * sin(PI * clip((t-zoomStart)/zoomDuration, 0, 1))
    // (sin goes 0 -> 1 -> 0 over [0,1])
    const zs = zoomStart;
    const zExpr = escapeExpr(
      `1+(${zoomAmount})*sin(PI*clip((t-${zs})/${zoomDuration},0,1))`
    );

    // "Blue disco" flash overlay around the same switch moment.
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

    const enableExpr = `between(t,${overlayStart},${overlayEnd})`;

    const mantraText = escapeForFFmpeg(String(req.body.mantra || ""));

    // Fullscreen overlay (no motion). Overlay is enabled only for the requested time window.
    // Mini-zoom is applied to the base video around the scene switch.
    const filter = [
      // Base video: keep original size. Apply a quick "bump" zoom by scaling and center-cropping back.
      `[0:v]format=rgba,scale=w=${W}*${zExpr}:h=${H}*${zExpr}:eval=frame,` +
        `crop=${W}:${H}:(in_w-${W})/2:(in_h-${H})/2[b0];`,

      // Blue disco flash layer (procedural). Uses noise + strong saturation for a quick "club" look.
      // NOTE: Avoid color alpha syntax (@) on Windows builds; set alpha via colorchannelmixer.
      `color=c=blue:s=${W}x${H},format=rgba,noise=alls=40:allf=t+u,eq=saturation=2.2:contrast=1.15[disco];` +
        `[disco]colorchannelmixer=aa=${discoAlpha}[discoA];` +
        `[b0][discoA]overlay=0:0:enable='between(t,${discoStart},${discoEnd})'[base];`,

      // Fullscreen user image overlay (no motion).
      `[1:v]format=rgba,scale=${W}:${H}[ol];` +
        `[ol]colorchannelmixer=aa=${overlayAlpha}[ol2];` +
        `[base][ol2]overlay=0:0:enable='${enableExpr}'[v0];` +
        `[v0]drawtext=fontcolor=white:fontsize=round(h*0.05):text='${mantraText}':x=(w-text_w)/2:y=h-(text_h*1.8):enable='between(t,${textStart},${textEnd})'[vid]`,
    ].join("");

    const args = [
      "-y",
      "-i", BASE_VIDEO,
      "-loop", "1",
      "-i", overlayImg,
      // Match output length to the base clip
      ...(outSeconds ? ["-t", String(outSeconds)] : []),
      "-filter_complex", filter,
      // Explicit mapping: use filtered video, keep audio if present.
      "-map", "[vid]",
      "-map", "0:a?",
      // Keep original frame rate by default. If you prefer forced 30fps, set FORCE_FPS=30.
      ...(process.env.FORCE_FPS ? ["-r", String(process.env.FORCE_FPS)] : []),
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-c:a", "copy",
      "-movflags", "+faststart",
      outMp4
    ];

    await run(ffmpegPath, args);

    res.setHeader("Content-Type", "video/mp4");
    fs.createReadStream(outMp4).pipe(res);

    fs.unlink(inputImg, () => {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Renderer listening on", PORT));
