# @arcolab/image-capture

Camera capture field for NocoBase with automatic IST timestamp overlay.
Supports both image (JPEG with SHA-256) and video (WebM/MP4 with duration) modes.

## Install

```bash
cd /path/to/nocobase
yarn pm add @arcolab/image-capture
yarn pm enable @arcolab/image-capture
yarn dev
```

## Usage

1. Go to any Collection > Add Field > Media > **Image / Video Capture**
2. Configure mode (Image or Video), max captures, and geolocation toggle
3. Open a form, click the capture field, grant camera permission, and capture

## Features

- Image capture with IST timestamp burned into pixels
- Video recording with live timestamp overlay via canvas captureStream
- SHA-256 hash for image integrity verification
- GPS geolocation metadata (optional)
- Immutable audit trail (server-side logging)
- Thumbnail grid with delete confirmation
- Small view for table/kanban cells
- Full view for form editing
- Read-only view with inline video modal
