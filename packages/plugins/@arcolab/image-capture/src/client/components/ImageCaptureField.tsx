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

// ── Types ──────────────────────────────────────────────────────────

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
  extname?: string;
  size?: number;
  path?: string;
  blob?: Blob;
  previewUrl?: string;
  preview?: string;
  mimeType?: string;
  mimetype?: string;
  meta?: CaptureMetadata;
}

interface CanvasWithCaptureStream extends HTMLCanvasElement {
  captureStream(frameRate: number): MediaStream;
}

interface UserInfo {
  id?: number;
  nickname?: string;
  username?: string;
}

// ── Helpers ────────────────────────────────────────────────────────

function getRawUrl(rec: CaptureRecord): string {
  return rec.url ?? rec.previewUrl ?? rec.preview ?? '';
}

/**
 * Resolve a storage-relative URL to a full URL.
 * Matches NocoBase core toItem() pattern – always use location.origin.
 */
function resolveUrl(raw: string): string {
  if (!raw) return '';
  if (/^(https?:|blob:|data:)/.test(raw)) return raw;
  return `${window.location.origin}/${raw.replace(/^\//, '')}`;
}

/**
 * Detect MIME type from the record. Checks direct mimetype fields first,
 * then falls back to extension-based detection from extname / filename / url.
 */
function mimeOf(rec: CaptureRecord | null | undefined): string {
  const direct = rec?.mimeType ?? rec?.mimetype ?? '';
  if (direct) return direct;
  const hint = (rec?.extname ?? rec?.filename ?? rec?.url ?? '').toLowerCase();
  if (/\.webm/i.test(hint)) return 'video/webm';
  if (/\.mp4/i.test(hint)) return 'video/mp4';
  if (/\.mov/i.test(hint)) return 'video/quicktime';
  if (/\.avi/i.test(hint)) return 'video/x-msvideo';
  if (/\.mkv/i.test(hint)) return 'video/x-matroska';
  if (/\.ogg/i.test(hint)) return 'video/ogg';
  if (/\.jpe?g/i.test(hint)) return 'image/jpeg';
  if (/\.png/i.test(hint)) return 'image/png';
  if (/\.gif/i.test(hint)) return 'image/gif';
  if (/\.webp/i.test(hint)) return 'image/webp';
  return '';
}

/** Strip codec params: "video/webm;codecs=vp9" → "video/webm" */
function baseMime(m: string): string {
  return m.split(';')[0].trim();
}

function isVideoRec(rec: CaptureRecord | null | undefined): boolean {
  return mimeOf(rec).startsWith('video/');
}

function getISTTimestamp(): string {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

async function computeSHA256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function drawTimestamp(
  ctx: CanvasRenderingContext2D, w: number, h: number, ts: string,
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

function getSupportedVideoMime(): string {
  if (typeof MediaRecorder === 'undefined') return 'video/mp4';
  for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return 'video/mp4';
}

function buildMeta(
  mode: CaptureMode, ts: string, idx: number,
  user: UserInfo | undefined, geo: GeolocationPosition | null,
  extra?: Partial<Pick<CaptureMetadata, 'imageHash' | 'durationMs'>>,
): CaptureMetadata {
  return {
    mode, timestamp: ts, captureIndex: idx,
    userId: user?.id ?? 0,
    userName: user?.nickname ?? user?.username ?? 'Unknown',
    latitude: geo?.coords.latitude ?? null,
    longitude: geo?.coords.longitude ?? null,
    accuracy: geo?.coords.accuracy ?? null,
    deviceInfo: navigator.userAgent,
    ...extra,
  };
}

const EM_DASH = '\u2014';

// ── Props ──────────────────────────────────────────────────────────

interface Props {
  value?: CaptureRecord[];
  onChange?: (v: CaptureRecord[]) => void;
  disabled?: boolean;
  mode?: CaptureMode;
  maxCaptures?: number;
  enableGeolocation?: boolean;
  currentUser?: UserInfo;
  size?: 'small' | 'default';
}

// ── Component ──────────────────────────────────────────────────────

const Inner: React.FC<Props> = ({
  value, onChange, disabled = false, mode = 'image',
  maxCaptures = 5, enableGeolocation = true,
  currentUser, size,
}) => {
  const { token } = theme.useToken();
  const api = useAPIClient();
  const getUrl = useCallback(
    (rec: CaptureRecord) => resolveUrl(getRawUrl(rec)), [],
  );

  // ── Refs ──
  const videoRef       = useRef<HTMLVideoElement>(null);
  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const streamRef      = useRef<MediaStream | null>(null);
  const recorderRef    = useRef<MediaRecorder | null>(null);
  const chunksRef      = useRef<Blob[]>([]);
  const animRef        = useRef(0);
  const recStartRef    = useRef(0);
  const recTsRef       = useRef('');
  const mountedRef     = useRef(true);
  const capturesRef    = useRef<CaptureRecord[]>([]);
  const onChangeRef    = useRef(onChange);
  const userRef        = useRef(currentUser);
  const geoRef         = useRef<GeolocationPosition | null>(null);

  useEffect(() => { onChangeRef.current = onChange; });
  useEffect(() => { userRef.current = currentUser; });

  // ── State ──
  const [captures, setCaptures]   = useState<CaptureRecord[]>(value ?? []);
  const [cameraOn, setCameraOn]   = useState(false);
  const [preview, setPreview]     = useState<CaptureRecord | null>(null);
  const [loading, setLoading]     = useState(false);
  const [facing, setFacing]       = useState<'user' | 'environment'>('environment');
  const [error, setError]         = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [liveClock, setLiveClock] = useState('');
  const [elapsed, setElapsed]     = useState(0);

  // Keep ref in sync so callbacks always see latest captures
  useEffect(() => { capturesRef.current = captures; }, [captures]);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // Sync external value changes (e.g. from DB reload) into local state.
  // We skip the sync if capturesRef already matches (avoids resetting after our own onChange).
  useEffect(() => {
    const incoming = value ?? [];
    // Only overwrite local state if the incoming value is genuinely different.
    // Compare by length + first/last id as a cheap heuristic.
    const cur = capturesRef.current;
    if (
      incoming.length !== cur.length ||
      incoming[0]?.id !== cur[0]?.id ||
      incoming[incoming.length - 1]?.id !== cur[cur.length - 1]?.id
    ) {
      setCaptures(incoming);
    }
  }, [value]);

  useEffect(() => {
    if (!enableGeolocation || !navigator.geolocation) return;
    let active = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => { if (active) geoRef.current = pos; },
      () => {},
      { enableHighAccuracy: true, timeout: 10_000 },
    );
    return () => { active = false; };
  }, [enableGeolocation]);

  useEffect(() => {
    if (!cameraOn) { setLiveClock(''); return; }
    setLiveClock(getISTTimestamp());
    const id = setInterval(() => setLiveClock(getISTTimestamp()), 1_000);
    return () => clearInterval(id);
  }, [cameraOn]);

  useEffect(() => {
    if (!recording) { setElapsed(0); return; }
    const id = setInterval(() => {
      if (recStartRef.current > 0) setElapsed(Math.floor((Date.now() - recStartRef.current) / 1_000));
    }, 1_000);
    return () => clearInterval(id);
  }, [recording]);

  // ── Camera lifecycle ──

  const stopCamera = useCallback(() => {
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = 0; }
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') try { rec.stop(); } catch { /* already stopped */ }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
    setRecording(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = useCallback(async () => {
    setError(null);
    setPreview(null);
    if (!navigator.mediaDevices?.getUserMedia) { setError('Camera not supported.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: mode === 'video',
      });
      if (!mountedRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setCameraOn(true);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const denied = err instanceof DOMException && err.name === 'NotAllowedError';
      setError(denied ? 'Camera access denied.' : `Camera error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [facing, mode]);

  const flipCamera = useCallback(() => {
    stopCamera();
    setFacing((f) => (f === 'user' ? 'environment' : 'user'));
  }, [stopCamera]);

  // ── Image capture ──

  const captureImage = useCallback(async () => {
    const cv = canvasRef.current;
    const vd = videoRef.current;
    if (!cv || !vd || capturesRef.current.length >= maxCaptures) return;
    const ctx = cv.getContext('2d');
    if (!ctx) { setError('Canvas unavailable.'); return; }
    setLoading(true);
    try {
      const ts = getISTTimestamp();
      cv.width = vd.videoWidth; cv.height = vd.videoHeight;
      ctx.drawImage(vd, 0, 0);
      drawTimestamp(ctx, cv.width, cv.height, ts);
      const blob = await new Promise<Blob>((ok, fail) =>
        cv.toBlob((b) => (b ? ok(b) : fail(new Error('toBlob failed'))), 'image/jpeg', 0.92),
      );
      const hash = await computeSHA256(await blob.arrayBuffer());
      if (!mountedRef.current) return;
      const idx = capturesRef.current.length + 1;
      setPreview({
        blob, previewUrl: URL.createObjectURL(blob),
        filename: `capture_${Date.now()}_${idx}.jpg`,
        extname: '.jpg',
        mimeType: 'image/jpeg', mimetype: 'image/jpeg',
        meta: buildMeta('image', ts, idx, userRef.current, geoRef.current, { imageHash: hash }),
      });
    } catch (err: unknown) {
      if (mountedRef.current) setError(`Capture failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [maxCaptures]);

  // ── Video recording ──

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    const vd = videoRef.current;
    if (!stream || !vd || recording) return;
    chunksRef.current = [];
    recTsRef.current = getISTTimestamp();
    recStartRef.current = Date.now();
    const w = vd.videoWidth || 1280, h = vd.videoHeight || 720;
    const oc = document.createElement('canvas');
    oc.width = w; oc.height = h;
    const octx = oc.getContext('2d');
    if (!octx) { setError('Canvas unavailable.'); return; }
    const draw = () => {
      if (!videoRef.current || !mountedRef.current) return;
      octx.drawImage(videoRef.current, 0, 0, w, h);
      drawTimestamp(octx, w, h, getISTTimestamp());
      animRef.current = requestAnimationFrame(draw);
    };
    draw();
    let recStream: MediaStream = stream;
    const cs = oc as unknown as CanvasWithCaptureStream;
    if (typeof cs.captureStream === 'function') {
      recStream = cs.captureStream(30);
      stream.getAudioTracks().forEach((t) => recStream.addTrack(t));
    }
    const mime = getSupportedVideoMime();
    let recorder: MediaRecorder;
    try { recorder = new MediaRecorder(recStream, { mimeType: mime }); }
    catch { recorder = new MediaRecorder(recStream); }
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = 0; }
      if (!mountedRef.current) return;
      const actual = recorder.mimeType || mime;
      const ext = actual.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(chunksRef.current, { type: actual });
      const dur = recStartRef.current > 0 ? Date.now() - recStartRef.current : 0;
      const idx = capturesRef.current.length + 1;
      setPreview({
        blob, previewUrl: URL.createObjectURL(blob),
        filename: `video_${Date.now()}_${idx}.${ext}`,
        extname: `.${ext}`,
        mimeType: actual, mimetype: actual,
        meta: buildMeta('video', recTsRef.current, idx, userRef.current, geoRef.current, { durationMs: dur }),
      });
      setRecording(false);
    };
    recorder.onerror = () => {
      if (mountedRef.current) setError('Recording error.');
      setRecording(false);
    };
    recorder.start(1_000);
    recorderRef.current = recorder;
    setRecording(true);
  }, [recording]);

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') try { rec.stop(); } catch { /* ok */ }
  }, []);

  // ── Upload & save ──

  const acceptCapture = useCallback(async () => {
    const p = preview;
    if (!p?.blob) return;
    setLoading(true);
    try {
      // Upload using NocoBase's exact pattern (api.axios.post with FormData)
      const fd = new FormData();
      fd.append('file', p.blob, p.filename ?? `capture_${Date.now()}.bin`);
      const { data: responseBody } = await api.axios.post('attachments:create', fd);
      const att = responseBody?.data;
      if (!att?.id) {
        setError('Upload failed: server did not return an attachment record.');
        return;
      }

      // Resolve URL using NocoBase toItem() pattern
      const rawUrl = att.url ?? '';
      const resolvedUrl = rawUrl.startsWith('http') ? rawUrl : `${location.origin}/${rawUrl.replace(/^\//, '')}`;

      // Build record — spread ALL server fields so the shape matches NocoBase attachments exactly
      const rec: CaptureRecord = {
        ...att,            // id, filename, title, extname, mimetype, size, path, url, etc.
        url: resolvedUrl,  // override with fully resolved URL
        mimeType: att.mimetype ?? p.mimeType,
        mimetype: att.mimetype ?? p.mimetype,
        meta: p.meta,
      };

      // Fire-and-forget audit log
      api.axios.post('imageCaptureAudit:create', {
        attachmentId: att.id, capturedAt: p.meta?.timestamp,
        capturedById: p.meta?.userId, capturedByName: p.meta?.userName,
        latitude: p.meta?.latitude, longitude: p.meta?.longitude,
        accuracy: p.meta?.accuracy, deviceInfo: p.meta?.deviceInfo,
        captureIndex: p.meta?.captureIndex, imageHash: p.meta?.imageHash,
        action: p.meta?.mode === 'video' ? 'VIDEO_CAPTURE' : 'IMAGE_CAPTURE',
        metadata: p.meta,
      }).catch(() => {});

      if (!mountedRef.current) return;

      // Update state — IMPORTANT: update ref, setState, and onChange SEPARATELY
      // (no side effects inside setState callbacks)
      const next = [...capturesRef.current, rec];
      capturesRef.current = next;
      setCaptures(next);
      onChangeRef.current?.(next);

      if (p.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(p.previewUrl);
      setPreview(null);
      if (next.length >= maxCaptures) stopCamera();
    } catch (err: unknown) {
      if (mountedRef.current) setError(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [preview, api, maxCaptures, stopCamera]);

  const retake = useCallback(() => {
    if (preview?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(preview.previewUrl);
    setPreview(null);
  }, [preview]);

  const deleteCapture = useCallback((i: number) => {
    if (disabled) return;
    Modal.confirm({
      title: 'Remove capture',
      content: 'This capture will be removed. The audit record is preserved.',
      onOk: () => {
        const next = capturesRef.current.filter((_, j) => j !== i);
        capturesRef.current = next;
        setCaptures(next);
        onChangeRef.current?.(next);
      },
    });
  }, [disabled]);

  // ── Render ──

  const isVideoMode = mode === 'video';
  const ModeIcon = isVideoMode ? <VideoCameraOutlined /> : <CameraOutlined />;
  const label = isVideoMode ? 'Video' : 'Image';

  // ── Small view (table / kanban cell) ──
  if (size === 'small') {
    return (
      <Space size={4}>
        {captures.map((c, i) =>
          isVideoRec(c) ? (
            <Tooltip key={i} title={c.meta?.timestamp ?? c.filename ?? 'Video'}>
              <div style={{
                width: 24, height: 24, background: '#1a1a2e', borderRadius: 2,
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                border: `1px solid ${token.colorBorder}`,
              }}>
                <VideoCameraOutlined style={{ fontSize: 11, color: token.colorPrimary }} />
              </div>
            </Tooltip>
          ) : (
            <Image key={i} src={getUrl(c)} width={24} height={24}
              style={{ objectFit: 'cover', borderRadius: 2 }}
              preview={{ mask: false, src: getUrl(c) }} />
          ),
        )}
        {captures.length === 0 && <Text type="secondary">{EM_DASH}</Text>}
      </Space>
    );
  }

  // ── Full form view ──
  return (
    <div style={{
      border: `1px solid ${token.colorBorder}`, borderRadius: token.borderRadius,
      padding: token.paddingSM, background: token.colorBgContainer,
    }}>
      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Tag icon={ModeIcon} color={isVideoMode ? 'purple' : 'blue'} style={{ margin: 0 }}>
          {label} Capture
        </Tag>
        <Text type="secondary" style={{ fontSize: 12 }}>{captures.length}/{maxCaptures}</Text>
      </div>

      {error && <Alert message={error} type="error" closable onClose={() => setError(null)} style={{ marginBottom: 10 }} />}

      {captures.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <Image.PreviewGroup>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {captures.map((c, i) => (
                <Badge key={i} count={!disabled ? (
                  <DeleteOutlined style={{
                    color: token.colorError, fontSize: 14, cursor: 'pointer',
                    background: '#fff', borderRadius: '50%', padding: 2,
                  }} onClick={() => deleteCapture(i)} />
                ) : null}>
                  <Tooltip title={
                    <div style={{ fontSize: 11 }}>
                      <div><ClockCircleOutlined /> {c.meta?.timestamp ?? EM_DASH}</div>
                      <div><UserOutlined /> {c.meta?.userName ?? EM_DASH}</div>
                      {c.meta?.latitude != null && (
                        <div><EnvironmentOutlined /> {c.meta.latitude.toFixed(4)}, {c.meta.longitude?.toFixed(4)}</div>
                      )}
                      {c.meta?.durationMs != null && <div>Duration: {(c.meta.durationMs / 1000).toFixed(1)}s</div>}
                    </div>
                  }>
                    {isVideoRec(c) ? (
                      /* Icon-based video thumbnail — reliable, always visible */
                      <div style={{
                        position: 'relative', width: 80, height: 80,
                        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
                        borderRadius: 4, border: `2px solid ${token.colorPrimary}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', overflow: 'hidden',
                      }}>
                        <VideoCameraOutlined style={{ fontSize: 28, color: 'rgba(255,255,255,0.5)' }} />
                        <PlayCircleOutlined style={{
                          position: 'absolute', top: '50%', left: '50%',
                          transform: 'translate(-50%,-50%)',
                          fontSize: 22, color: 'rgba(255,255,255,0.9)',
                        }} />
                        {c.meta?.durationMs != null && (
                          <div style={{
                            position: 'absolute', bottom: 2, right: 4,
                            fontSize: 9, color: '#fff', background: 'rgba(0,0,0,0.6)',
                            padding: '0 3px', borderRadius: 2,
                          }}>
                            {(c.meta.durationMs / 1000).toFixed(0)}s
                          </div>
                        )}
                      </div>
                    ) : (
                      <Image src={getUrl(c)} width={80} height={80}
                        style={{ objectFit: 'cover', borderRadius: 4, border: `2px solid ${token.colorPrimary}` }}
                        preview={{ src: getUrl(c) }} />
                    )}
                  </Tooltip>
                </Badge>
              ))}
            </div>
          </Image.PreviewGroup>
        </div>
      )}

      {!disabled && captures.length < maxCaptures && (
        <>
          {!cameraOn && !preview && (
            <Button type="primary" icon={ModeIcon} onClick={startCamera}
              block size="large" style={{ marginBottom: 8 }}>
              Start {label} Capture
            </Button>
          )}

          <div style={{
            display: cameraOn && !preview ? 'block' : 'none',
            position: 'relative', background: '#000', borderRadius: token.borderRadius,
            overflow: 'hidden', marginBottom: 8,
          }}>
            <video ref={videoRef} autoPlay playsInline muted={!isVideoMode}
              style={{ width: '100%', maxHeight: 400, display: 'block' }} />

            {cameraOn && liveClock && (
              <div style={{
                position: 'absolute', bottom: 72, left: 8, background: 'rgba(0,0,0,0.6)',
                color: '#FADB14', padding: '3px 8px', borderRadius: 4, fontSize: 12,
                fontFamily: 'monospace', pointerEvents: 'none',
              }}>
                <ClockCircleOutlined style={{ marginRight: 4 }} />{liveClock}
              </div>
            )}

            {recording && (
              <div style={{
                position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 6,
                background: 'rgba(200,0,0,0.9)', color: '#fff', padding: '4px 10px', borderRadius: 4,
                fontSize: 12, fontWeight: 600,
              }}>
                <span style={{ width: 8, height: 8, background: '#fff', borderRadius: '50%', display: 'inline-block' }} />
                REC{elapsed > 0 ? ` ${elapsed}s` : ''}
              </div>
            )}

            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12,
              background: 'linear-gradient(transparent, rgba(0,0,0,0.72))',
              display: 'flex', justifyContent: 'center', gap: 12, alignItems: 'center',
            }}>
              <Button shape="circle" size="large" icon={<SwapOutlined />} onClick={flipCamera} title="Flip" />
              {!isVideoMode ? (
                <Button shape="circle" size="large" type="primary" icon={<CameraOutlined />}
                  onClick={captureImage} loading={loading}
                  style={{ width: 64, height: 64, fontSize: 24 }} title="Capture" />
              ) : !recording ? (
                <Button shape="circle" size="large" icon={<PlayCircleOutlined />}
                  onClick={startRecording}
                  style={{ width: 64, height: 64, fontSize: 24, background: token.colorError, borderColor: token.colorError, color: '#fff' }}
                  title="Record" />
              ) : (
                <Button shape="circle" size="large" type="primary" icon={<StopOutlined />}
                  onClick={stopRecording} style={{ width: 64, height: 64, fontSize: 24 }} title="Stop" />
              )}
              <Button shape="circle" size="large" danger icon={<StopOutlined />} onClick={stopCamera} title="Close" />
            </div>
          </div>

          {preview && (
            <div style={{ marginTop: 8, textAlign: 'center' }}>
              {isVideoRec(preview) ? (
                <video controls playsInline
                  style={{ maxWidth: '100%', maxHeight: 360, display: 'block', margin: '0 auto',
                    borderRadius: token.borderRadius, border: `2px solid ${token.colorSuccess}`, background: '#000' }}>
                  <source src={preview.previewUrl} type={baseMime(mimeOf(preview)) || 'video/webm'} />
                  <source src={preview.previewUrl} />
                </video>
              ) : (
                <Image src={preview.previewUrl} preview={false}
                  style={{ maxWidth: '100%', maxHeight: 360, borderRadius: token.borderRadius,
                    border: `2px solid ${token.colorSuccess}` }} />
              )}

              <div style={{
                marginTop: 8, padding: '8px 12px', background: token.colorBgLayout,
                borderRadius: token.borderRadius, fontSize: 12, textAlign: 'left',
              }}>
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <Text>
                    <ClockCircleOutlined style={{ marginRight: 4, color: token.colorWarning }} />
                    <Text strong>Captured: </Text>{preview.meta?.timestamp}
                  </Text>
                  <Text><UserOutlined style={{ marginRight: 4 }} />{preview.meta?.userName} (ID: {preview.meta?.userId})</Text>
                  {preview.meta?.latitude != null && (
                    <Text><EnvironmentOutlined style={{ marginRight: 4 }} />{preview.meta.latitude.toFixed(5)}, {preview.meta.longitude?.toFixed(5)}</Text>
                  )}
                  {preview.meta?.durationMs != null && <Text>Duration: {(preview.meta.durationMs / 1000).toFixed(1)}s</Text>}
                  {preview.meta?.imageHash && (
                    <Text copyable={{ text: preview.meta.imageHash }}>SHA-256: {preview.meta.imageHash.substring(0, 20)}...</Text>
                  )}
                </Space>
              </div>

              <Space style={{ marginTop: 12 }}>
                <Button icon={<ReloadOutlined />} onClick={retake}>Retake</Button>
                <Button type="primary" icon={<CheckCircleOutlined />} onClick={acceptCapture} loading={loading}>
                  Save {label}
                </Button>
              </Space>
            </div>
          )}
        </>
      )}

      {captures.length >= maxCaptures && !disabled && (
        <Alert message={`Maximum ${maxCaptures} ${label.toLowerCase()} captures reached`}
          type="success" showIcon style={{ marginTop: 8 }} />
      )}

      {captures.length === 0 && !cameraOn && !preview && (
        <Paragraph type="secondary" style={{ textAlign: 'center', marginTop: 16 }}>
          {isVideoMode
            ? <VideoCameraOutlined style={{ fontSize: 28, display: 'block', marginBottom: 4 }} />
            : <CameraOutlined style={{ fontSize: 28, display: 'block', marginBottom: 4 }} />}
          No {label.toLowerCase()} captures yet
        </Paragraph>
      )}

      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
};

export const ImageCaptureField = Object.assign(
  connect(Inner, mapReadPretty(ImageCaptureReadPretty)),
  { ReadPretty: ImageCaptureReadPretty },
);
