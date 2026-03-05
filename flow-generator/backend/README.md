# FLOW Renderer (Backend)

1) Put your base trader video in `backend/assets/trader.mp4`

Run:
```bash
cd backend
npm install
npm start
```

POST `/render` (multipart form-data):
- `image` (overlay image)
- `intensity` (0..100, controls overlay opacity)
- optional: `overlayStart`, `overlayEnd` (seconds)
- optional: `zoomStart`, `zoomDuration`, `zoomAmount`

Returns MP4.

## New: automatic background removal
By default the backend will remove the background (server-side) if the uploaded image **does not already** have an alpha channel.

To disable it, send `removeBg=false` in the form-data.

This uses `@imgly/background-removal-node` (runs locally on your server; no external API).

**Note:** first run downloads the model (~tens of MB) and caches it.

## Note
This version is "quick & simple": it does a full-screen overlay with a time window.
There is no moving overlay or tracking.

1) Generate tracking keyframes (example workflow)
- Extract a template frame of the seal, crop a tight box around the seal, save it as `backend/assets/seal_template.png`.
- Run a tracker script (example below) to produce `backend/assets/seal_track.json`.

Tracker dependencies:
```bash
python3 -m pip install opencv-python
```

2) The backend will automatically pick up `seal_track.json` and use it instead of the hardcoded defaults.

## Output length
The output automatically matches the base video's duration (via ffprobe).
