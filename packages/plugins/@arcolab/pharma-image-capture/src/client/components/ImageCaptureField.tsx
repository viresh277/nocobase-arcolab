import React, { useCallback, useEffect, useRef, useState } from 'react';
import { connect, mapReadPretty } from '@formily/react';
import { useAPIClient } from '@nocobase/client';
import {
  Alert, Badge, Button, Image, Modal, Space, Tag, Tooltip, Typography, theme,
} from 'antd';
import {
  CameraOutlined, CheckCircleOutlined, ClockCircleOutlined,
  DeleteOutlined, EnvironmentOutlined, PlayCircleOutlined,
  ReloadOutlined, StopOutlined, SwapOutlined,
  UserOutlined, VideoCameraOutlined,
} from '@ant-design/icons';
import { ImageCaptureReadPretty } from './ImageCaptureReadPretty';

const { Text, Paragraph } = Typography;

export type CaptureMode = 'image' | 'video';

export interface CaptureMetadata {
  mode: CaptureMode;
  timestamp: string;
  userId: number;
  userName: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  deviceInfo: string;
  captureIndex: number;
  imageHash?: string;
  durationMs?: number;
}

export interface CaptureRecord {
  id?: number;
  url?: string;
  filename?: string;
  title?: string;
  blob?: Blob;
  previewUrl?: string;
  /** camelCase — set by us on upload */
  mimeType?: string;
  /** lowercase — returned by NocoBase DB on reload */
  mimetype?: string;
  meta?: CaptureMetadata;
}

function getRawUrl(record: CaptureRecord): string {
  return record.url ?? record.previewUrl ?? (record as any).preview ?? '';
}

function mimeOf(record: CaptureRecord | null | undefined): string {
  if (!record) return '';
  return record.mimeType ?? record.mimetype ?? '';
}

function getISTTimestamp(): string {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

async function computeSHA256(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function drawTimestampOnCtx(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  ts: string,
): void {
  const fs = Math.max(14, Math.floor(w * 0.022));
  ctx.font = `bold ${fs}px monospace`;
  const tw = ctx.measureText(ts).width;
  const pad = 10;
  const x = w - tw - pad * 2;
  const y = h - pad * 2;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x - pad, y - fs, tw + pad * 2, fs + pad);
  ctx.fillStyle = '#FADB14';
  ctx.fillText(ts, x, y);
}

/** Picks the best supported MIME type for MediaRecorder */
function getSupportedVideoMime(): string {
  if (typeof MediaRecorder === 'undefined') return 'video/mp4';
  if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) return 'video/webm;codecs=vp9';
  if (MediaRecorder.isTypeSupported('video/webm')) return 'video/webm';
  return 'video/mp4';
}

interface Props {
  value?: CaptureRecord[];
  onChange?: (v: CaptureRecord[]) => void;
  disabled?: boolean;
  mode?: CaptureMode;
  maxCaptures?: number;
  enableGeolocation?: boolean;
  /** Kept for API compatibility but resolved internally via useAPIClient hook */
  apiClient?: any;
  currentUser?: { id?: number; nickname?: string; username?: string };
  size?: 'small' | 'default';
}

const Inner: React.FC<Props> = ({
  value,
  onChange,
  disabled = false,
  mode = 'image',
  maxCaptures = 5,
  enableGeolocation = true,
  apiClient: apiClientProp,
  currentUser,
  size,
}) => {
  const { token } = theme.useToken();
  const apiHook = useAPIClient();
  // Prefer prop (passed by Formily useComponentProps), fall back to hook
  const apiClient = apiClientProp ?? apiHook;

  /**
   * Converts a potentially-relative attachment URL to absolute.
   * NocoBase frontend (:13000) and API server (:13001) differ —
   * strip "/api/" from axios.defaults.baseURL to get the file-server root.
   */
  const resolveUrl = useCallback(
    (record: CaptureRecord): string => {
      const raw = getRawUrl(record);
      if (!raw) return '';
      if (
        raw.startsWith('http://') ||
        raw.startsWith('https://') ||
        raw.startsWith('blob:') ||
        raw.startsWith('data:')
      ) {
        return raw;
      }
      const base = (
        (apiClient as any)?.axios?.defaults?.baseURL ?? window.location.origin
      )
        .replace(/\/api\/?$/, '')
        .replace(/\/$/, '');
      return base + (raw.startsWith('/') ? raw : `/${raw}`);
    },
    [apiClient],
  );

  // —— Refs ——
  const videoRef       = useRef<HTMLVideoElement>(null);
  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const streamRef      = useRef<MediaStream | null>(null);
  const recorderRef    = useRef<MediaRecorder | null>(null);
  const chunksRef      = useRef<Blob[]>([]);
  const animFrameRef   = useRef<number | null>(null);
  const recordStartRef = useRef<number | null>(null);
  const recordTsRef    = useRef<string>('');
  /**
   * Stable mirror of captures state.
   * Used inside recorder.onstop callback to avoid stale-closure bugs:
   * captures.length at onstop time equals capturesRef.current.length,
   * not the frozen value from when handleStartRecording was called.
   */
  const capturesRef = useRef<CaptureRecord[]>([]);

  // —— State ——
  const [captures, setCaptures]           = useState<CaptureRecord[]>(value ?? []);
  const [cameraOn, setCameraOn]           = useState(false);
  const [preview, setPreview]             = useState<CaptureRecord | null>(null);
  const [loading, setLoading]             = useState(false);
  const [facing, setFacing]               = useState<'user' | 'environment'>('environment');
  const [error, setError]                 = useState<string | null>(null);
  const [geo, setGeo]                     = useState<GeolocationPosition | null>(null);
  const [recording, setRecording]         = useState(false);
  const [liveTimestamp, setLiveTimestamp] = useState('');
  const [elapsedSecs, setElapsedSecs]     = useState(0);

  // Keep capturesRef in sync so async callbacks always read current length
  useEffect(() => { capturesRef.current = captures; }, [captures]);

  // Sync external value → internal state (controlled field)
  useEffect(() => {
    setCaptures(value ?? []);
  }, [value]);

  useEffect(() => {
    if (!enableGeolocation || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setGeo(p),
      () => {},
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [enableGeolocation]);

  // Live IST clock shown in viewfinder
  useEffect(() => {
    if (!cameraOn) { setLiveTimestamp(''); return; }
    setLiveTimestamp(getISTTimestamp());
    const id = setInterval(() => setLiveTimestamp(getISTTimestamp()), 1000);
    return () => clearInterval(id);
  }, [cameraOn]);

  // Recording elapsed-time counter
  useEffect(() => {
    if (!recording) { setElapsedSecs(0); return; }
    const id = setInterval(() => {
      if (recordStartRef.current != null) {
        setElapsedSecs(Math.floor((Date.now() - recordStartRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [recording]);

  const stopCamera = useCallback(() => {
    if (animFrameRef.current != null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
    setRecording(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = useCallback(async () => {
    setError(null);
    setPreview(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: mode === 'video',
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch (err: unknown) {
      const e = err as DOMException;
      setError(
        e.name === 'NotAllowedError'
          ? 'Camera/microphone access denied.'
          : `Camera error: ${e.message}`,
      );
    }
  }, [facing, mode]);

  const switchCamera = useCallback(() => {
    stopCamera();
    setFacing((p) => (p === 'user' ? 'environment' : 'user'));
  }, [stopCamera]);

  // —— IMAGE CAPTURE: timestamp burned onto canvas pixels ——
  const handleImageCapture = useCallback(async () => {
    const cv = canvasRef.current;
    const vd = videoRef.current;
    if (!cv || !vd || captures.length >= maxCaptures) return;

    const ctx = cv.getContext('2d');
    if (!ctx) { setError('Canvas 2D context unavailable.'); return; }

    setLoading(true);
    try {
      const ts = getISTTimestamp();
      cv.width  = vd.videoWidth;
      cv.height = vd.videoHeight;
      ctx.drawImage(vd, 0, 0);
      drawTimestampOnCtx(ctx, cv.width, cv.height, ts);

      const blob = await new Promise<Blob>((resolve, reject) =>
        cv.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))),
          'image/jpeg',
          0.92,
        ),
      );
      const hash = await computeSHA256(await blob.arrayBuffer());
      const idx  = captures.length + 1;

      setPreview({
        blob,
        previewUrl: URL.createObjectURL(blob),
        filename:   `capture_${Date.now()}_${idx}.jpg`,
        mimeType:   'image/jpeg',
        mimetype:   'image/jpeg',
        meta: {
          mode:         'image',
          timestamp:    ts,
          userId:       currentUser?.id       ?? 0,
          userName:     currentUser?.nickname ?? currentUser?.username ?? 'Unknown',
          latitude:     geo?.coords.latitude  ?? null,
          longitude:    geo?.coords.longitude ?? null,
          accuracy:     geo?.coords.accuracy  ?? null,
          deviceInfo:   navigator.userAgent,
          captureIndex: idx,
          imageHash:    hash,
        },
      });
    } finally {
      setLoading(false);
    }
  }, [captures.length, maxCaptures, currentUser, geo]);

  // —— VIDEO RECORDING: canvas overlay with live timestamp burn-in ——
  const handleStartRecording = useCallback(() => {
    const stream = streamRef.current;
    const vd     = videoRef.current;
    if (!stream || !vd || recording) return;

    chunksRef.current      = [];
    recordTsRef.current    = getISTTimestamp();
    recordStartRef.current = Date.now();

    const w = vd.videoWidth  || 1280;
    const h = vd.videoHeight || 720;

    // Off-screen canvas for per-frame timestamp burn-in
    const oc   = document.createElement('canvas');
    oc.width   = w;
    oc.height  = h;
    const octx = oc.getContext('2d');
    if (!octx) { setError('Canvas 2D context unavailable.'); return; }

    const drawFrame = () => {
      if (!videoRef.current) return;
      octx.drawImage(videoRef.current, 0, 0, w, h);
      drawTimestampOnCtx(octx, w, h, getISTTimestamp());
      animFrameRef.current = requestAnimationFrame(drawFrame);
    };
    drawFrame();

    // Use canvas stream (timestamp overlaid) when supported; else raw stream
    let recStream: MediaStream = stream;
    if (typeof (oc as any).captureStream === 'function') {
      recStream = (oc as any).captureStream(30) as MediaStream;
      stream.getAudioTracks().forEach((t) => recStream.addTrack(t));
    }

    const mimeType = getSupportedVideoMime();
    const recorder = new MediaRecorder(recStream, { mimeType });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      if (animFrameRef.current != null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      const ext        = mimeType.includes('mp4') ? 'mp4' : 'webm';
      const blob       = new Blob(chunksRef.current, { type: mimeType });
      const durationMs = recordStartRef.current != null
        ? Date.now() - recordStartRef.current
        : 0;
      // Use capturesRef — not the stale captures closure — to get current length
      const idx = capturesRef.current.length + 1;

      setPreview({
        blob,
        previewUrl: URL.createObjectURL(blob),
        filename:   `video_${Date.now()}_${idx}.${ext}`,
        mimeType,
        mimetype:   mimeType,
        meta: {
          mode:         'video',
          timestamp:    recordTsRef.current,
          userId:       currentUser?.id       ?? 0,
          userName:     currentUser?.nickname ?? currentUser?.username ?? 'Unknown',
          latitude:     geo?.coords.latitude  ?? null,
          longitude:    geo?.coords.longitude ?? null,
          accuracy:     geo?.coords.accuracy  ?? null,
          deviceInfo:   navigator.userAgent,
          captureIndex: idx,
          durationMs,
        },
      });
      setRecording(false);
    };

    recorder.start(1000);
    recorderRef.current = recorder;
    setRecording(true);
  }, [recording, currentUser, geo]);

  const handleStopRecording = useCallback(() => {
    if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop();
  }, []);

  // —— UPLOAD & SAVE ——
  const handleAccept = useCallback(async () => {
    if (!preview?.blob) return;
    const p = preview; // stable reference for the async scope
    setLoading(true);
    try {
      let rec: CaptureRecord;

      if (apiClient) {
        const fd = new FormData();
        fd.append('file', p.blob!, p.filename);
        const res = await (apiClient as any).request({
          url:    'attachments:create',
          method: 'post',
          data:   fd,
        });
        const att = res?.data?.data as
          | { id: number; url: string; filename: string; title: string }
          | undefined;
        if (!att?.url) {
          setError('Upload failed: no URL returned from server.');
          return;
        }
        rec = {
          id:       att.id,
          url:      att.url,
          filename: att.filename,
          title:    att.title,
          mimeType: p.mimeType,
          mimetype: p.mimeType,
          meta:     p.meta,
        };
        // Fire-and-forget audit (server auto-audit is the fallback)
        void (apiClient as any)
          .request({
            url:    'imageCaptureAudit:create',
            method: 'post',
            data: {
              attachmentId:   att.id,
              capturedAt:     p.meta?.timestamp,
              capturedById:   p.meta?.userId,
              capturedByName: p.meta?.userName,
              latitude:       p.meta?.latitude,
              longitude:      p.meta?.longitude,
              accuracy:       p.meta?.accuracy,
              deviceInfo:     p.meta?.deviceInfo,
              captureIndex:   p.meta?.captureIndex,
              imageHash:      p.meta?.imageHash,
              action:         p.meta?.mode === 'video' ? 'VIDEO_CAPTURE' : 'IMAGE_CAPTURE',
              metadata:       p.meta,
            },
          })
          .catch(() => { /* server auto-audit handles this */ });
      } else {
        // Offline / test: store without blob to avoid memory leak in state
        const { blob: _blob, previewUrl: _previewUrl, ...rest } = p;
        rec = rest;
      }

      const updated = [...captures, rec];
      setCaptures(updated);
      onChange?.(updated);

      // Free blob URL memory
      if (p.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(p.previewUrl);
      setPreview(null);
      if (updated.length >= maxCaptures) stopCamera();
    } catch (err: unknown) {
      setError(`Upload failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [preview, apiClient, captures, maxCaptures, onChange, stopCamera]);

  const handleRetake = useCallback(() => {
    if (preview?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(preview.previewUrl);
    setPreview(null);
  }, [preview]);

  const handleDelete = useCallback(
    (i: number) => {
      if (disabled) return;
      Modal.confirm({
        title:   'Remove capture',
        content: 'Remove this capture? The audit record will be preserved.',
        onOk: () => {
          const u = captures.filter((_, j) => j !== i);
          setCaptures(u);
          onChange?.(u);
        },
      });
    },
    [captures, disabled, onChange],
  );

  const isVideo   = mode === 'video';
  const ModeIcon  = isVideo ? <VideoCameraOutlined /> : <CameraOutlined />;
  const modeLabel = isVideo ? 'Video' : 'Image';

  // —— SMALL (table / kanban cell) ——
  if (size === 'small') {
    return (
      <Space size={4}>
        {captures.map((c, i) =>
          mimeOf(c).startsWith('video/') ? (
            <Tooltip key={i} title={c.meta?.timestamp ?? c.filename ?? 'Video'}>
              <div
                style={{
                  width:          24,
                  height:         24,
                  background:     token.colorFillSecondary,
                  borderRadius:   2,
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'center',
                  cursor:         'pointer',
                }}
              >
                <VideoCameraOutlined style={{ fontSize: 12, color: token.colorPrimary }} />
              </div>
            </Tooltip>
          ) : (
            <Image
              key={i}
              src={resolveUrl(c)}
              width={24}
              height={24}
              style={{ objectFit: 'cover', borderRadius: 2 }}
              preview={{ mask: false, src: resolveUrl(c) }}
            />
          ),
        )}
        {captures.length === 0 && <Text type="secondary">—</Text>}
      </Space>
    );
  }

  // —— FULL FORM VIEW ——
  return (
    <div
      style={{
        border:       `1px solid ${token.colorBorder}`,
        borderRadius: token.borderRadius,
        padding:      token.paddingSM,
        background:   token.colorBgContainer,
      }}
    >
      {/* Mode header */}
      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Tag icon={ModeIcon} color={isVideo ? 'purple' : 'blue'} style={{ margin: 0 }}>
          {modeLabel} Capture
        </Tag>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {captures.length}/{maxCaptures}
        </Text>
      </div>

      {error && (
        <Alert
          message={error}
          type="error"
          closable
          onClose={() => setError(null)}
          style={{ marginBottom: 10 }}
        />
      )}

      {/* Saved capture thumbnails */}
      {captures.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <Image.PreviewGroup>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {captures.map((c, i) => (
                <Badge
                  key={i}
                  count={
                    !disabled ? (
                      <DeleteOutlined
                        style={{
                          color:        token.colorError,
                          fontSize:     14,
                          cursor:       'pointer',
                          background:   '#fff',
                          borderRadius: '50%',
                          padding:      2,
                        }}
                        onClick={() => handleDelete(i)}
                      />
                    ) : null
                  }
                >
                  <Tooltip
                    title={
                      <div style={{ fontSize: 11 }}>
                        <div><ClockCircleOutlined /> {c.meta?.timestamp ?? '—'}</div>
                        <div><UserOutlined /> {c.meta?.userName ?? '—'}</div>
                        {c.meta?.latitude != null && (
                          <div>
                            <EnvironmentOutlined />{' '}
                            {c.meta.latitude.toFixed(4)}, {c.meta.longitude?.toFixed(4)}
                          </div>
                        )}
                        {c.meta?.durationMs != null && (
                          <div>Duration: {(c.meta.durationMs / 1000).toFixed(1)}s</div>
                        )}
                      </div>
                    }
                  >
                    {mimeOf(c).startsWith('video/') ? (
                      // Inline video thumbnail — click to play / pause
                      <div style={{ position: 'relative', width: 80, height: 80 }}>
                        <video
                          src={resolveUrl(c)}
                          preload="metadata"
                          muted
                          playsInline
                          style={{
                            width:        80,
                            height:       80,
                            objectFit:    'cover',
                            borderRadius: 4,
                            border:       `2px solid ${token.colorPrimary}`,
                            cursor:       'pointer',
                            display:      'block',
                          }}
                          onClick={(e) => {
                            const v = e.currentTarget;
                            // play() returns a Promise — void to suppress floating-promise warning
                            v.paused ? void v.play() : v.pause();
                          }}
                        />
                        <PlayCircleOutlined
                          style={{
                            position:  'absolute',
                            top:       '50%',
                            left:      '50%',
                            transform: 'translate(-50%,-50%)',
                            fontSize:  22,
                            color:     'rgba(255,255,255,0.85)',
                            pointerEvents: 'none',
                          }}
                        />
                      </div>
                    ) : (
                      <Image
                        src={resolveUrl(c)}
                        width={80}
                        height={80}
                        style={{
                          objectFit:    'cover',
                          borderRadius: 4,
                          border:       `2px solid ${token.colorPrimary}`,
                        }}
                        preview={{ src: resolveUrl(c) }}
                      />
                    )}
                  </Tooltip>
                </Badge>
              ))}
            </div>
          </Image.PreviewGroup>
        </div>
      )}

      {/* Camera controls */}
      {!disabled && captures.length < maxCaptures && (
        <>
          {!cameraOn && !preview && (
            <Button
              type="primary"
              icon={ModeIcon}
              onClick={startCamera}
              block
              size="large"
              style={{ marginBottom: 8 }}
            >
              Start {modeLabel} Capture
            </Button>
          )}

          {/* Live camera viewfinder */}
          <div
            style={{
              display:      cameraOn && !preview ? 'block' : 'none',
              position:     'relative',
              background:   '#000',
              borderRadius: token.borderRadius,
              overflow:     'hidden',
              marginBottom: 8,
            }}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted={!isVideo}
              style={{ width: '100%', maxHeight: 400, display: 'block' }}
            />

            {/* Live IST timestamp overlay */}
            {cameraOn && liveTimestamp && (
              <div
                style={{
                  position:      'absolute',
                  bottom:        72,
                  left:          8,
                  background:    'rgba(0,0,0,0.6)',
                  color:         '#FADB14',
                  padding:       '3px 8px',
                  borderRadius:  4,
                  fontSize:      12,
                  fontFamily:    'monospace',
                  pointerEvents: 'none',
                  letterSpacing: 0.3,
                }}
              >
                <ClockCircleOutlined style={{ marginRight: 4 }} />{liveTimestamp}
              </div>
            )}

            {/* REC indicator with elapsed time */}
            {recording && (
              <div
                style={{
                  position:   'absolute',
                  top:        8,
                  left:       8,
                  display:    'flex',
                  alignItems: 'center',
                  gap:        6,
                  background: 'rgba(200,0,0,0.9)',
                  color:      '#fff',
                  padding:    '4px 10px',
                  borderRadius: 4,
                  fontSize:   12,
                  fontWeight: 600,
                }}
              >
                <span
                  style={{
                    width:        8,
                    height:       8,
                    background:   '#fff',
                    borderRadius: '50%',
                    display:      'inline-block',
                  }}
                />
                REC{elapsedSecs > 0 ? ` ${elapsedSecs}s` : ''}
              </div>
            )}

            {/* Action buttons */}
            <div
              style={{
                position:       'absolute',
                bottom:         0,
                left:           0,
                right:          0,
                padding:        12,
                background:     'linear-gradient(transparent, rgba(0,0,0,0.72))',
                display:        'flex',
                justifyContent: 'center',
                gap:            12,
                alignItems:     'center',
              }}
            >
              <Button
                shape="circle" size="large"
                icon={<SwapOutlined />}
                onClick={switchCamera}
                title="Flip camera"
              />
              {!isVideo ? (
                <Button
                  shape="circle" size="large" type="primary"
                  icon={<CameraOutlined />}
                  onClick={handleImageCapture}
                  loading={loading}
                  style={{ width: 64, height: 64, fontSize: 24 }}
                  title="Capture image"
                />
              ) : !recording ? (
                <Button
                  shape="circle" size="large"
                  icon={<PlayCircleOutlined />}
                  onClick={handleStartRecording}
                  style={{
                    width:       64,
                    height:      64,
                    fontSize:    24,
                    background:  token.colorError,
                    borderColor: token.colorError,
                    color:       '#fff',
                  }}
                  title="Start recording"
                />
              ) : (
                <Button
                  shape="circle" size="large" type="primary"
                  icon={<StopOutlined />}
                  onClick={handleStopRecording}
                  style={{ width: 64, height: 64, fontSize: 24 }}
                  title="Stop recording"
                />
              )}
              <Button
                shape="circle" size="large" danger
                icon={<StopOutlined />}
                onClick={stopCamera}
                title="Close camera"
              />
            </div>
          </div>

          {/* Preview after capture — before saving */}
          {preview && (
            <div style={{ marginTop: 8, textAlign: 'center' }}>
              {mimeOf(preview).startsWith('video/') ? (
                <video
                  src={preview.previewUrl}
                  controls
                  playsInline
                  style={{
                    maxWidth:     '100%',
                    maxHeight:    360,
                    display:      'block',
                    margin:       '0 auto',
                    borderRadius: token.borderRadius,
                    border:       `2px solid ${token.colorSuccess}`,
                    background:   '#000',
                  }}
                />
              ) : (
                <Image
                  src={preview.previewUrl}
                  preview={false}
                  style={{
                    maxWidth:     '100%',
                    maxHeight:    360,
                    borderRadius: token.borderRadius,
                    border:       `2px solid ${token.colorSuccess}`,
                  }}
                />
              )}

              {/* Capture metadata strip */}
              <div
                style={{
                  marginTop:    8,
                  padding:      '8px 12px',
                  background:   token.colorBgLayout,
                  borderRadius: token.borderRadius,
                  fontSize:     12,
                  textAlign:    'left',
                }}
              >
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <Text>
                    <ClockCircleOutlined style={{ marginRight: 4, color: token.colorWarning }} />
                    <Text strong>Captured: </Text>
                    {preview.meta?.timestamp}
                  </Text>
                  <Text>
                    <UserOutlined style={{ marginRight: 4 }} />
                    {preview.meta?.userName} (ID: {preview.meta?.userId})
                  </Text>
                  {preview.meta?.latitude != null && (
                    <Text>
                      <EnvironmentOutlined style={{ marginRight: 4 }} />
                      {preview.meta.latitude.toFixed(5)}, {preview.meta.longitude?.toFixed(5)}
                    </Text>
                  )}
                  {preview.meta?.durationMs != null && (
                    <Text>Duration: {(preview.meta.durationMs / 1000).toFixed(1)}s</Text>
                  )}
                  {preview.meta?.imageHash && (
                    <Text copyable={{ text: preview.meta.imageHash }}>
                      SHA-256: {preview.meta.imageHash.substring(0, 20)}…
                    </Text>
                  )}
                </Space>
              </div>

              <Space style={{ marginTop: 12 }}>
                <Button icon={<ReloadOutlined />} onClick={handleRetake}>
                  Retake
                </Button>
                <Button
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  onClick={handleAccept}
                  loading={loading}
                >
                  Save {modeLabel}
                </Button>
              </Space>
            </div>
          )}
        </>
      )}

      {captures.length >= maxCaptures && !disabled && (
        <Alert
          message={`Maximum ${maxCaptures} ${modeLabel.toLowerCase()} capture${maxCaptures !== 1 ? 's' : ''} reached`}
          type="success"
          showIcon
          style={{ marginTop: 8 }}
        />
      )}

      {captures.length === 0 && !cameraOn && !preview && (
        <Paragraph type="secondary" style={{ textAlign: 'center', marginTop: 16 }}>
          {isVideo
            ? <VideoCameraOutlined style={{ fontSize: 28, display: 'block', marginBottom: 4 }} />
            : <CameraOutlined     style={{ fontSize: 28, display: 'block', marginBottom: 4 }} />}
          No {modeLabel.toLowerCase()} captures yet
        </Paragraph>
      )}

      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
};

export const ImageCaptureField = connect(Inner, mapReadPretty(ImageCaptureReadPretty));
// Static property so x-component: 'ImageCaptureField.ReadPretty' resolves in table/kanban views
(ImageCaptureField as any).ReadPretty = ImageCaptureReadPretty;
