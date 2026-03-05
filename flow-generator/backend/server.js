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
app.use(cors());
app.use(express.json());

// Limit upload size to avoid OOM on small instances
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Put your base trader video in ./assets/trader.mp4
const BASE_VIDEO = path.join("assets", "trader.mp4");

const OUT_DIR = "out";
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads", { recursive: true });

// Use ffmpeg-static by default; can be overridden with env vars if you later switch
const FFMPEG =
  process.env.FFMPEG_PATH ||
  (ffmpegStatic?.path || ffmpegStatic) ||
  "ffmpeg";
const FFPROBE =
  process.env.FFPROBE_PATH ||
  (ffprobeStatic?.path || ffprobeStatic) ||
  "ffprobe";

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

app.get("/", (_, res) => res.send("FLOW renderer online"));

app.post("/render", upload.single("image"), async (req, res) => {
  const inputImg = req.file?.path;

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

    // Overlay time window (seconds). Default 2..5
    const overlayStart = Number.isFinite(Number(req.body.overlayStart))
      ? Number(req.body.overlayStart)
      : 2;
    const overlayEnd = Number.isFinite(Number(req.body.overlayEnd))
      ? Number(req.body.overlayEnd)
      : 5;

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
      : 0.02; // +2%

    const overlayAlpha = 1.0;
    const enableExpr = `between(t,${overlayStart},${overlayEnd})`;

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

    const id = uuid();
    const outMp4 = path.join(OUT_DIR, `${id}.mp4`);

    // Filter graph: base zoom bump + fullscreen image overlay (NO disco, NO text)
    const filter = [
      `[0:v]format=rgba,scale=w=${W}*${zExpr}:h=${H}*${zExpr}:eval=frame,` +
        `crop=${W}:${H}:(in_w-${W})/2:(in_h-${H})/2[base];`,

      `[1:v]format=rgba,scale=${W}:${H}[ol];` +
        `[ol]colorchannelmixer=aa=${overlayAlpha}[ol2];` +
        `[base][ol2]overlay=0:0:enable='${enableExpr}'[vid]`,
    ].join("");

    const args = [
      "-y",
      "-i",
      BASE_VIDEO,
      "-loop",
      "1",
      "-i",
      inputImg,
      ...(outSeconds ? ["-t", String(outSeconds)] : []),
      "-filter_complex",
      filter,
      "-map",
      "[vid]",
      "-map",
      "0:a?",
      ...(process.env.FORCE_FPS ? ["-r", String(process.env.FORCE_FPS)] : []),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
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
