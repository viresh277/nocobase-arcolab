import React, { useCallback, useEffect, useRef, useState } from 'react';
import { connect, mapReadPretty } from '@formily/react';
import { useAPIClient } from '@nocobase/client';
import {
  Alert, Badge, Button, Image, Modal, Space, Tag, Tooltip, Typography, theme,
} from 'antd';
import {
  CameraOutlined, CheckCircleOutlined, ClockCircleOutlined,
  DeleteOutlined, DownloadOutlined, EnvironmentOutlined,
  PlayCircleOutlined, ReloadOutlined, StopOutlined,
  SwapOutlined, UserOutlined, VideoCameraOutlined,
} from '@ant-design/icons';
import { ImageCaptureReadPretty } from './ImageCaptureReadPretty';

const { Text, Paragraph } = Typography;

/* ── Types ──────────────────────────────────────────────────── */

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
  meta?: CaptureMetadata | Record<string, unknown>;
  /** Local-only: thumbnail data-URL captured from the canvas */
  _thumb?: string;
}

interface CanvasWithCaptureStream extends HTMLCanvasElement {
  captureStream(frameRate: number): MediaStream;
}

interface UserInfo {
  id?: number;
  nickname?: string;
  username?: string;
}

/* ── Helpers ────────────────────────────────────────────────── */

function getRawUrl(rec: CaptureRecord): string {
  return rec.url ?? rec.previewUrl ?? rec.preview ?? '';
}

/** Resolve relative URL → absolute, matching NocoBase toItem() */
function resolveUrl(raw: string): string {
  if (!raw) return '';
  if (/^(https?:|blob:|data:)/.test(raw)) return raw;
  return `${window.location.origin}/${raw.replace(/^\//, '')}`;
}

const VIDEO_EXT = /\.(webm|mp4|mov|avi|mkv|ogg)(\?|$)/i;

function isVideoRec(rec: CaptureRecord | null | undefined): boolean {
  if (!rec) return false;
  const m = rec.meta as CaptureMetadata | undefined;
  if (m?.mode === 'video') return true;
  const mt = (rec.mimeType || rec.mimetype || '').toLowerCase();
  if (mt.startsWith('video/')) return true;
  const hint = `${rec.extname || ''} ${rec.filename || ''} ${rec.url || ''}`;
  if (VIDEO_EXT.test(hint)) return true;
  if (rec.filename?.startsWith('video_')) return true;
  return false;
}

function baseMime(rec: CaptureRecord | null | undefined): string {
  return (rec?.mimeType || rec?.mimetype || '').split(';')[0].trim();
}

function getISTTimestamp(): string {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

async function computeSHA256(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function drawTimestamp(ctx: CanvasRenderingContext2D, w: number, h: number, ts: string) {
  const fs = Math.max(14, Math.floor(w * 0.022));
  ctx.font = `bold ${fs}px monospace`;
  const tw = ctx.measureText(ts).width;
  const pad = 10;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(w - tw - pad * 3, h - fs - pad * 2, tw + pad * 2, fs + pad);
  ctx.fillStyle = '#FADB14';
  ctx.fillText(ts, w - tw - pad * 2, h - pad * 2);
}

function getSupportedMime(): string {
  if (typeof MediaRecorder === 'undefined') return 'video/mp4';
  for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'])
    if (MediaRecorder.isTypeSupported(m)) return m;
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

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}:${sec.toString().padStart(2, '0')}` : `0:${sec.toString().padStart(2, '0')}`;
}

/* ── Props ──────────────────────────────────────────────────── */

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

/* ── Component ──────────────────────────────────────────────── */

const Inner: React.FC<Props> = ({
  value, onChange, disabled = false, mode = 'image',
  maxCaptures = 5, enableGeolocation = true,
  currentUser, size,
}) => {
  const { token } = theme.useToken();
  const api = useAPIClient();
  const getUrl = useCallback((rec: CaptureRecord) => resolveUrl(getRawUrl(rec)), []);

  /* ── Refs ── */
  const videoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef   = useRef<Blob[]>([]);
  const animRef     = useRef(0);
  const recStartRef = useRef(0);
  const recTsRef    = useRef('');
  const mountedRef  = useRef(true);
  const capturesRef = useRef<CaptureRecord[]>([]);
  const onChangeRef = useRef(onChange);
  const userRef     = useRef(currentUser);
  const geoRef      = useRef<GeolocationPosition | null>(null);
  /** Session-only thumbnails: serverUrl → dataURL */
  const thumbsRef   = useRef<Record<string, string>>({});

  useEffect(() => { onChangeRef.current = onChange; });
  useEffect(() => { userRef.current = currentUser; });

  /* ── State ── */
  const [captures, setCaptures]     = useState<CaptureRecord[]>(value ?? []);
  const [cameraOn, setCameraOn]     = useState(false);
  const [preview, setPreview]       = useState<CaptureRecord | null>(null);
  const [loading, setLoading]       = useState(false);
  const [facing, setFacing]         = useState<'user' | 'environment'>('environment');
  const [error, setError]           = useState<string | null>(null);
  const [recording, setRecording]   = useState(false);
  const [liveClock, setLiveClock]   = useState('');
  const [elapsed, setElapsed]       = useState(0);
  const [playback, setPlayback]     = useState<CaptureRecord | null>(null);

  useEffect(() => { capturesRef.current = captures; }, [captures]);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  /* Sync external value → local, skip if our own onChange just fired */
  useEffect(() => {
    const inc = value ?? [];
    const cur = capturesRef.current;
    if (inc.length !== cur.length || inc[0]?.id !== cur[0]?.id ||
        inc[inc.length - 1]?.id !== cur[cur.length - 1]?.id)
      setCaptures(inc);
  }, [value]);

  useEffect(() => {
    if (!enableGeolocation || !navigator.geolocation) return;
    let a = true;
    navigator.geolocation.getCurrentPosition(p => { if (a) geoRef.current = p; }, () => {}, { enableHighAccuracy: true, timeout: 10_000 });
    return () => { a = false; };
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

  /* ── Camera ── */

  const stopCamera = useCallback(() => {
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = 0; }
    const r = recorderRef.current;
    if (r && r.state !== 'inactive') try { r.stop(); } catch {}
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false); setRecording(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = useCallback(async () => {
    setError(null); setPreview(null);
    if (!navigator.mediaDevices?.getUserMedia) { setError('Camera not supported.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: mode === 'video',
      });
      if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setCameraOn(true);
    } catch (e: unknown) {
      if (!mountedRef.current) return;
      setError(e instanceof DOMException && e.name === 'NotAllowedError'
        ? 'Camera access denied.' : `Camera error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [facing, mode]);

  const flipCamera = useCallback(() => { stopCamera(); setFacing(f => f === 'user' ? 'environment' : 'user'); }, [stopCamera]);

  /* ── Image capture ── */

  const captureImage = useCallback(async () => {
    const cv = canvasRef.current, vd = videoRef.current;
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
        cv.toBlob(b => (b ? ok(b) : fail(new Error('toBlob failed'))), 'image/jpeg', 0.92));
      const hash = await computeSHA256(await blob.arrayBuffer());
      if (!mountedRef.current) return;
      const idx = capturesRef.current.length + 1;
      setPreview({
        blob, previewUrl: URL.createObjectURL(blob),
        filename: `capture_${Date.now()}_${idx}.jpg`, extname: '.jpg',
        mimeType: 'image/jpeg', mimetype: 'image/jpeg',
        meta: buildMeta('image', ts, idx, userRef.current, geoRef.current, { imageHash: hash }),
      });
    } catch (e: unknown) {
      if (mountedRef.current) setError(`Capture failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { if (mountedRef.current) setLoading(false); }
  }, [maxCaptures]);

  /* ── Video recording ── */

  const startRecording = useCallback(() => {
    const stream = streamRef.current, vd = videoRef.current;
    if (!stream || !vd || recording) return;
    chunksRef.current = [];
    recTsRef.current = getISTTimestamp();
    recStartRef.current = Date.now();
    const w = vd.videoWidth || 1280, h = vd.videoHeight || 720;
    const oc = document.createElement('canvas'); oc.width = w; oc.height = h;
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
      stream.getAudioTracks().forEach(t => recStream.addTrack(t));
    }
    const mime = getSupportedMime();
    let recorder: MediaRecorder;
    try { recorder = new MediaRecorder(recStream, { mimeType: mime }); }
    catch { recorder = new MediaRecorder(recStream); }
    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = 0; }
      if (!mountedRef.current) return;
      /* ── Capture thumbnail from the overlay canvas (last frame with timestamp) ── */
      let thumbData = '';
      try { thumbData = oc.toDataURL('image/jpeg', 0.65); } catch {}
      const actual = recorder.mimeType || mime;
      const ext = actual.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(chunksRef.current, { type: actual });
      const dur = recStartRef.current > 0 ? Date.now() - recStartRef.current : 0;
      const idx = capturesRef.current.length + 1;
      setPreview({
        blob, previewUrl: URL.createObjectURL(blob),
        filename: `video_${Date.now()}_${idx}.${ext}`, extname: `.${ext}`,
        mimeType: actual, mimetype: actual,
        _thumb: thumbData,
        meta: buildMeta('video', recTsRef.current, idx, userRef.current, geoRef.current, { durationMs: dur }),
      });
      setRecording(false);
    };
    recorder.onerror = () => { if (mountedRef.current) setError('Recording error.'); setRecording(false); };
    recorder.start(1_000);
    recorderRef.current = recorder;
    setRecording(true);
  }, [recording]);

  const stopRecording = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.state !== 'inactive') try { r.stop(); } catch {}
  }, []);

  /* ── Upload & save ── */

  const acceptCapture = useCallback(async () => {
    const p = preview;
    if (!p?.blob) return;
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', p.blob, p.filename ?? `capture_${Date.now()}.bin`);
      const { data: body } = await api.axios.post('attachments:create', fd);
      const att = body?.data;
      if (!att?.id) { setError('Upload failed.'); return; }
      const rawUrl = att.url ?? '';
      const fullUrl = rawUrl.startsWith('http') ? rawUrl : `${location.origin}/${rawUrl.replace(/^\//, '')}`;

      /* Store thumbnail for this session */
      if (p._thumb) thumbsRef.current[fullUrl] = p._thumb;

      const rec: CaptureRecord = {
        ...att, url: fullUrl,
        mimeType: att.mimetype ?? p.mimeType,
        mimetype: att.mimetype ?? p.mimetype,
        meta: p.meta,
      };
      api.axios.post('imageCaptureAudit:create', {
        attachmentId: att.id, capturedAt: (p.meta as CaptureMetadata)?.timestamp,
        capturedById: (p.meta as CaptureMetadata)?.userId,
        capturedByName: (p.meta as CaptureMetadata)?.userName,
        latitude: (p.meta as CaptureMetadata)?.latitude,
        longitude: (p.meta as CaptureMetadata)?.longitude,
        accuracy: (p.meta as CaptureMetadata)?.accuracy,
        deviceInfo: (p.meta as CaptureMetadata)?.deviceInfo,
        captureIndex: (p.meta as CaptureMetadata)?.captureIndex,
        imageHash: (p.meta as CaptureMetadata)?.imageHash,
        action: (p.meta as CaptureMetadata)?.mode === 'video' ? 'VIDEO_CAPTURE' : 'IMAGE_CAPTURE',
        metadata: p.meta,
      }).catch(() => {});
      if (!mountedRef.current) return;
      const next = [...capturesRef.current, rec];
      capturesRef.current = next;
      setCaptures(next);
      onChangeRef.current?.(next);
      if (p.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(p.previewUrl);
      setPreview(null);
      if (next.length >= maxCaptures) stopCamera();
    } catch (e: unknown) {
      if (mountedRef.current) setError(`Upload failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { if (mountedRef.current) setLoading(false); }
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
        capturesRef.current = next; setCaptures(next); onChangeRef.current?.(next);
      },
    });
  }, [disabled]);

  /* ── Render ── */

  const isVideoMode = mode === 'video';
  const ModeIcon = isVideoMode ? <VideoCameraOutlined /> : <CameraOutlined />;
  const label = isVideoMode ? 'Video' : 'Image';

  const openPlay = (c: CaptureRecord) => setPlayback(c);
  const closePlay = () => setPlayback(null);

  const playUrl = playback ? getUrl(playback) : '';
  const pbMeta = playback?.meta as CaptureMetadata | undefined;

  /* ── Video thumbnail component ── */
  const VideoThumb: React.FC<{ c: CaptureRecord; w: number; h: number }> = ({ c, w, h }) => {
    const url = getUrl(c);
    const thumb = thumbsRef.current[url];
    const dur = (c.meta as CaptureMetadata)?.durationMs;
    return (
      <div onClick={() => openPlay(c)} style={{
        position: 'relative', width: w, height: h, cursor: 'pointer',
        borderRadius: 6, overflow: 'hidden',
        background: thumb ? undefined : 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
        border: `2px solid ${token.colorPrimary}`,
      }}>
        {thumb ? (
          <img src={thumb} alt="" style={{ width: w, height: h, objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ width: w, height: h, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <VideoCameraOutlined style={{ fontSize: Math.max(16, w * 0.3), color: 'rgba(255,255,255,0.15)' }} />
          </div>
        )}
        {/* Play overlay */}
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: thumb ? 'rgba(0,0,0,0.2)' : 'transparent',
          transition: 'background 0.2s',
        }}>
          <div style={{
            width: Math.max(20, w * 0.35), height: Math.max(20, w * 0.35),
            borderRadius: '50%', background: 'rgba(255,255,255,0.9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          }}>
            <span style={{ fontSize: Math.max(10, w * 0.18), color: token.colorPrimary, marginLeft: 2 }}>▶</span>
          </div>
        </div>
        {/* Duration badge */}
        {dur != null && w >= 60 && (
          <div style={{
            position: 'absolute', bottom: 4, right: 4, fontSize: 10, fontWeight: 600,
            color: '#fff', background: 'rgba(0,0,0,0.7)',
            padding: '1px 5px', borderRadius: 3, letterSpacing: 0.5,
          }}>
            {fmtDuration(dur)}
          </div>
        )}
        {/* VIDEO label */}
        {w >= 60 && (
          <div style={{
            position: 'absolute', top: 4, left: 4, fontSize: 9, fontWeight: 700,
            color: '#fff', background: token.colorPrimary,
            padding: '1px 5px', borderRadius: 3, textTransform: 'uppercase', letterSpacing: 0.5,
          }}>Video</div>
        )}
      </div>
    );
  };

  /* ── Playback modal ── */
  const playbackModal = (
    <Modal open={!!playback} onCancel={closePlay} footer={null} width={760}
      title={<Space><VideoCameraOutlined style={{ color: token.colorPrimary }} /><Text strong>Video Playback</Text>
        {pbMeta?.timestamp && <Text type="secondary" style={{ fontSize: 12 }}><ClockCircleOutlined style={{ marginRight: 4 }} />{pbMeta.timestamp}</Text>}
        {pbMeta?.durationMs != null && <Tag color="purple">{fmtDuration(pbMeta.durationMs)}</Tag>}
      </Space>}
      destroyOnClose centered
    >
      {playback && (
        <>
          {/* ── VIDEO PLAYER: use src= directly (NO <source> — React error bubbling breaks it) ── */}
          <video
            src={playUrl}
            controls
            autoPlay
            playsInline
            style={{
              width: '100%', maxHeight: 500, display: 'block',
              borderRadius: token.borderRadius, background: '#000',
            }}
          />
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
              {pbMeta?.userName && <span><UserOutlined style={{ marginRight: 4 }} />{pbMeta.userName}</span>}
              {pbMeta?.latitude != null && (
                <span style={{ marginLeft: 12 }}><EnvironmentOutlined style={{ marginRight: 4 }} />{pbMeta.latitude.toFixed(4)}, {pbMeta.longitude?.toFixed(4)}</span>
              )}
            </div>
            <a href={playUrl} download style={{ fontSize: 12 }}><DownloadOutlined style={{ marginRight: 4 }} />Download</a>
          </div>
        </>
      )}
    </Modal>
  );

  /* ── Small view ── */
  if (size === 'small') {
    return (
      <>
        <Space size={4}>
          {captures.map((c, i) => isVideoRec(c)
            ? <Tooltip key={i} title={(c.meta as CaptureMetadata)?.timestamp ?? c.filename ?? 'Video'}><VideoThumb c={c} w={24} h={24} /></Tooltip>
            : <Image key={i} src={getUrl(c)} width={24} height={24} style={{ objectFit: 'cover', borderRadius: 2 }} preview={{ mask: false, src: getUrl(c) }} />
          )}
          {captures.length === 0 && <Text type="secondary">{EM_DASH}</Text>}
        </Space>
        {playbackModal}
      </>
    );
  }

  /* ── Full form view ── */
  return (
    <div style={{ border: `1px solid ${token.colorBorder}`, borderRadius: token.borderRadius, padding: token.paddingSM, background: token.colorBgContainer }}>
      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Tag icon={ModeIcon} color={isVideoMode ? 'purple' : 'blue'} style={{ margin: 0 }}>{label} Capture</Tag>
        <Text type="secondary" style={{ fontSize: 12 }}>{captures.length}/{maxCaptures}</Text>
      </div>

      {error && <Alert message={error} type="error" closable onClose={() => setError(null)} style={{ marginBottom: 10 }} />}

      {/* ── Saved captures gallery ── */}
      {captures.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <Image.PreviewGroup>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {captures.map((c, i) => (
                <Badge key={i} count={!disabled ? (
                  <DeleteOutlined style={{ color: token.colorError, fontSize: 14, cursor: 'pointer', background: '#fff', borderRadius: '50%', padding: 2 }}
                    onClick={() => deleteCapture(i)} />
                ) : null}>
                  <Tooltip title={<div style={{ fontSize: 11 }}>
                    <div><ClockCircleOutlined /> {(c.meta as CaptureMetadata)?.timestamp ?? EM_DASH}</div>
                    <div><UserOutlined /> {(c.meta as CaptureMetadata)?.userName ?? EM_DASH}</div>
                    {(c.meta as CaptureMetadata)?.latitude != null && <div><EnvironmentOutlined /> {(c.meta as CaptureMetadata)!.latitude!.toFixed(4)}, {(c.meta as CaptureMetadata)!.longitude?.toFixed(4)}</div>}
                    {(c.meta as CaptureMetadata)?.durationMs != null && <div>Duration: {fmtDuration((c.meta as CaptureMetadata).durationMs!)}</div>}
                  </div>}>
                    {isVideoRec(c)
                      ? <VideoThumb c={c} w={80} h={80} />
                      : <Image src={getUrl(c)} width={80} height={80}
                          style={{ objectFit: 'cover', borderRadius: 6, border: `2px solid ${token.colorPrimary}` }}
                          preview={{ src: getUrl(c) }} />
                    }
                  </Tooltip>
                </Badge>
              ))}
            </div>
          </Image.PreviewGroup>
        </div>
      )}

      {/* ── Camera & capture UI ── */}
      {!disabled && captures.length < maxCaptures && (
        <>
          {!cameraOn && !preview && (
            <Button type="primary" icon={ModeIcon} onClick={startCamera} block size="large" style={{ marginBottom: 8 }}>
              Start {label} Capture
            </Button>
          )}

          <div style={{ display: cameraOn && !preview ? 'block' : 'none', position: 'relative', background: '#000', borderRadius: token.borderRadius, overflow: 'hidden', marginBottom: 8 }}>
            <video ref={videoRef} autoPlay playsInline muted={!isVideoMode} style={{ width: '100%', maxHeight: 400, display: 'block' }} />
            {cameraOn && liveClock && (
              <div style={{ position: 'absolute', bottom: 72, left: 8, background: 'rgba(0,0,0,0.6)', color: '#FADB14', padding: '3px 8px', borderRadius: 4, fontSize: 12, fontFamily: 'monospace', pointerEvents: 'none' }}>
                <ClockCircleOutlined style={{ marginRight: 4 }} />{liveClock}
              </div>
            )}
            {recording && (
              <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(220,20,20,0.9)', color: '#fff', padding: '4px 10px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
                <span style={{ width: 8, height: 8, background: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'pulse 1s infinite' }} />
                REC {elapsed > 0 ? fmtDuration(elapsed * 1000) : ''}
              </div>
            )}
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12, background: 'linear-gradient(transparent, rgba(0,0,0,0.72))', display: 'flex', justifyContent: 'center', gap: 12, alignItems: 'center' }}>
              <Button shape="circle" size="large" icon={<SwapOutlined />} onClick={flipCamera} title="Flip" />
              {!isVideoMode ? (
                <Button shape="circle" size="large" type="primary" icon={<CameraOutlined />}
                  onClick={captureImage} loading={loading} style={{ width: 64, height: 64, fontSize: 24 }} title="Capture" />
              ) : !recording ? (
                <Button shape="circle" size="large" icon={<PlayCircleOutlined />}
                  onClick={startRecording}
                  style={{ width: 64, height: 64, fontSize: 24, background: '#dc3545', borderColor: '#dc3545', color: '#fff' }} title="Record" />
              ) : (
                <Button shape="circle" size="large" type="primary" icon={<StopOutlined />}
                  onClick={stopRecording} style={{ width: 64, height: 64, fontSize: 24 }} title="Stop" />
              )}
              <Button shape="circle" size="large" danger icon={<StopOutlined />} onClick={stopCamera} title="Close" />
            </div>
          </div>

          {/* ── Preview (before save) ── */}
          {preview && (
            <div style={{ marginTop: 8, textAlign: 'center' }}>
              {isVideoRec(preview) ? (
                /* Use src= directly — NOT <source>, which causes error bubbling in React */
                <video
                  src={preview.previewUrl}
                  controls playsInline
                  style={{ maxWidth: '100%', maxHeight: 360, display: 'block', margin: '0 auto', borderRadius: token.borderRadius, border: `2px solid ${token.colorSuccess}`, background: '#000' }}
                />
              ) : (
                <Image src={preview.previewUrl} preview={false}
                  style={{ maxWidth: '100%', maxHeight: 360, borderRadius: token.borderRadius, border: `2px solid ${token.colorSuccess}` }} />
              )}
              <div style={{ marginTop: 8, padding: '8px 12px', background: token.colorBgLayout, borderRadius: token.borderRadius, fontSize: 12, textAlign: 'left' }}>
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <Text><ClockCircleOutlined style={{ marginRight: 4, color: token.colorWarning }} /><Text strong>Captured: </Text>{(preview.meta as CaptureMetadata)?.timestamp}</Text>
                  <Text><UserOutlined style={{ marginRight: 4 }} />{(preview.meta as CaptureMetadata)?.userName} (ID: {(preview.meta as CaptureMetadata)?.userId})</Text>
                  {(preview.meta as CaptureMetadata)?.latitude != null && (
                    <Text><EnvironmentOutlined style={{ marginRight: 4 }} />{(preview.meta as CaptureMetadata)!.latitude!.toFixed(5)}, {(preview.meta as CaptureMetadata)!.longitude?.toFixed(5)}</Text>
                  )}
                  {(preview.meta as CaptureMetadata)?.durationMs != null && <Text>Duration: {fmtDuration((preview.meta as CaptureMetadata).durationMs!)}</Text>}
                  {(preview.meta as CaptureMetadata)?.imageHash && (
                    <Text copyable={{ text: (preview.meta as CaptureMetadata)!.imageHash! }}>SHA-256: {(preview.meta as CaptureMetadata)!.imageHash!.substring(0, 20)}…</Text>
                  )}
                </Space>
              </div>
              <Space style={{ marginTop: 12 }}>
                <Button icon={<ReloadOutlined />} onClick={retake}>Retake</Button>
                <Button type="primary" icon={<CheckCircleOutlined />} onClick={acceptCapture} loading={loading}>Save {label}</Button>
              </Space>
            </div>
          )}
        </>
      )}

      {captures.length >= maxCaptures && !disabled && (
        <Alert message={`Maximum ${maxCaptures} ${label.toLowerCase()} captures reached`} type="success" showIcon style={{ marginTop: 8 }} />
      )}

      {captures.length === 0 && !cameraOn && !preview && (
        <Paragraph type="secondary" style={{ textAlign: 'center', marginTop: 16 }}>
          {isVideoMode ? <VideoCameraOutlined style={{ fontSize: 28, display: 'block', marginBottom: 4 }} /> : <CameraOutlined style={{ fontSize: 28, display: 'block', marginBottom: 4 }} />}
          No {label.toLowerCase()} captures yet
        </Paragraph>
      )}

      <canvas ref={canvasRef} style={{ display: 'none' }} />
      {playbackModal}
    </div>
  );
};

export const ImageCaptureField = Object.assign(
  connect(Inner, mapReadPretty(ImageCaptureReadPretty)),
  { ReadPretty: ImageCaptureReadPretty },
);
