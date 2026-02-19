import React, { useCallback, useEffect, useRef, useState } from 'react';
import { connect, mapReadPretty } from '@formily/react';
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
  mimeType?: string;
  meta?: CaptureMetadata;
}

function getISTTimestamp(): string {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

function getMediaUrl(record: any): string {
  if (!record) return '';
  if (record.url) return record.url;
  if (record.previewUrl) return record.previewUrl;
  if (record.preview) return record.preview;
  return '';
}

async function computeSHA256(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function drawTimestampOnCtx(
  ctx: CanvasRenderingContext2D, w: number, h: number, ts: string,
): void {
  const fs = Math.max(14, Math.floor(w * 0.022));
  ctx.font = 'bold ' + fs + 'px monospace';
  const tw = ctx.measureText(ts).width;
  const pad = 10;
  const x = w - tw - pad * 2;
  const y = h - pad * 2;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x - pad, y - fs, tw + pad * 2, fs + pad);
  ctx.fillStyle = '#FADB14';
  ctx.fillText(ts, x, y);
}

interface Props {
  value?: any[];
  onChange?: (v: any[]) => void;
  disabled?: boolean;
  mode?: CaptureMode;
  maxCaptures?: number;
  enableGeolocation?: boolean;
  action?: string;
  apiClient?: any;
  currentUser?: any;
  size?: 'small' | 'default';
}

const Inner: React.FC<Props> = (props) => {
  const {
    value = [],
    onChange,
    disabled = false,
    mode = 'image',
    maxCaptures = 5,
    enableGeolocation = true,
    apiClient,
    currentUser,
    size,
  } = props;

  const { token } = theme.useToken();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const animFrameRef = useRef<number | null>(null);
  const recordStartRef = useRef<number | null>(null);
  const recordTsRef = useRef<string>('');

  const [captures, setCaptures] = useState<CaptureRecord[]>(value || []);
  const [cameraOn, setCameraOn] = useState(false);
  const [preview, setPreview] = useState<CaptureRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [facing, setFacing] = useState<'user' | 'environment'>('environment');
  const [error, setError] = useState<string | null>(null);
  const [geo, setGeo] = useState<GeolocationPosition | null>(null);
  const [recording, setRecording] = useState(false);
  const [liveTimestamp, setLiveTimestamp] = useState('');
  const [elapsedSecs, setElapsedSecs] = useState(0);

  useEffect(() => {
    if (value && JSON.stringify(value) !== JSON.stringify(captures)) setCaptures(value);
  }, [value]);

  useEffect(() => {
    if (!enableGeolocation || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setGeo(p), () => {},
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

  // Recording elapsed counter
  useEffect(() => {
    if (!recording) { setElapsedSecs(0); return; }
    const id = setInterval(() => {
      if (recordStartRef.current) setElapsedSecs(Math.floor((Date.now() - recordStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [recording]);

  const stopCamera = useCallback(() => {
    if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
    setRecording(false);
  }, []);

  useEffect(() => () => { stopCamera(); }, [stopCamera]);

  const startCamera = useCallback(async () => {
    setError(null);
    setPreview(null);
    if (!navigator.mediaDevices?.getUserMedia) { setError('Camera not supported.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: mode === 'video',
      });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setCameraOn(true);
    } catch (err: any) {
      setError(err.name === 'NotAllowedError' ? 'Camera/microphone access denied.' : 'Error: ' + err.message);
    }
  }, [facing, mode]);

  const switchCamera = useCallback(() => {
    stopCamera();
    setFacing((p) => (p === 'user' ? 'environment' : 'user'));
  }, [stopCamera]);

  // ── IMAGE CAPTURE: timestamp burned onto canvas ──
  const handleImageCapture = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || captures.length >= maxCaptures) return;
    setLoading(true);
    try {
      const ts = getISTTimestamp();
      const cv = canvasRef.current;
      const ctx = cv.getContext('2d')!;
      cv.width = videoRef.current.videoWidth;
      cv.height = videoRef.current.videoHeight;
      ctx.drawImage(videoRef.current, 0, 0);
      drawTimestampOnCtx(ctx, cv.width, cv.height, ts);
      const blob: Blob = await new Promise((r) =>
        cv.toBlob((b) => r(b || new Blob()), 'image/jpeg', 0.92),
      );
      const hash = await computeSHA256(await blob.arrayBuffer());
      const idx = captures.length + 1;
      setPreview({
        blob, previewUrl: URL.createObjectURL(blob),
        filename: 'capture_' + Date.now() + '_' + idx + '.jpg',
        mimeType: 'image/jpeg',
        meta: {
          mode: 'image', timestamp: ts,
          userId: currentUser?.id || 0,
          userName: currentUser?.nickname || currentUser?.username || 'Unknown',
          latitude: geo?.coords?.latitude ?? null,
          longitude: geo?.coords?.longitude ?? null,
          accuracy: geo?.coords?.accuracy ?? null,
          deviceInfo: navigator.userAgent,
          captureIndex: idx, imageHash: hash,
        },
      });
    } finally { setLoading(false); }
  }, [captures, maxCaptures, currentUser, geo]);

  // ── VIDEO RECORDING: canvas overlay stream with timestamp burn-in ──
  const handleStartRecording = useCallback(() => {
    if (!streamRef.current || !videoRef.current || recording) return;
    chunksRef.current = [];
    const ts = getISTTimestamp();
    recordTsRef.current = ts;
    recordStartRef.current = Date.now();
    const video = videoRef.current;
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;

    // Overlay canvas draws video frames + live timestamp every rAF tick
    const oc = document.createElement('canvas');
    oc.width = w; oc.height = h;
    const octx = oc.getContext('2d')!;
    const drawFrame = () => {
      if (!videoRef.current) return;
      octx.drawImage(videoRef.current, 0, 0, w, h);
      drawTimestampOnCtx(octx, w, h, getISTTimestamp());
      animFrameRef.current = requestAnimationFrame(drawFrame);
    };
    drawFrame();

    // Use canvas stream (timestamp burned-in) if supported, else raw stream
    let recStream: MediaStream = streamRef.current;
    if (typeof (oc as any).captureStream === 'function') {
      recStream = (oc as any).captureStream(30) as MediaStream;
      streamRef.current.getAudioTracks().forEach((t) => recStream.addTrack(t));
    }

    const mimeType =
      typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm')
          ? 'video/webm'
          : 'video/mp4';

    const recorder = new MediaRecorder(recStream, { mimeType });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const durationMs = recordStartRef.current ? Date.now() - recordStartRef.current : 0;
      const idx = captures.length + 1;
      setPreview({
        blob, previewUrl: URL.createObjectURL(blob),
        filename: 'video_' + Date.now() + '_' + idx + '.' + ext,
        mimeType,
        meta: {
          mode: 'video', timestamp: recordTsRef.current,
          userId: currentUser?.id || 0,
          userName: currentUser?.nickname || currentUser?.username || 'Unknown',
          latitude: geo?.coords?.latitude ?? null,
          longitude: geo?.coords?.longitude ?? null,
          accuracy: geo?.coords?.accuracy ?? null,
          deviceInfo: navigator.userAgent,
          captureIndex: idx, durationMs,
        },
      });
      setRecording(false);
    };
    recorder.start(1000);
    recorderRef.current = recorder;
    setRecording(true);
  }, [recording, captures, currentUser, geo]);

  const handleStopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
  }, []);

  // ── UPLOAD & SAVE ──
  const handleAccept = useCallback(async () => {
    if (!preview?.blob) return;
    setLoading(true);
    try {
      let rec: CaptureRecord;
      if (apiClient) {
        const fd = new FormData();
        fd.append('file', preview.blob, preview.filename);
        const res = await apiClient.request({ url: 'attachments:create', method: 'post', data: fd });
        const att = res?.data?.data;
        if (!att?.url) { setError('Upload failed: no URL returned.'); return; }
        rec = { id: att.id, url: att.url, filename: att.filename, title: att.title, mimeType: preview.mimeType, meta: preview.meta } as any;
        try {
          await apiClient.request({
            url: 'imageCaptureAudit:create', method: 'post',
            data: {
              attachmentId: att.id,
              capturedAt: preview.meta?.timestamp,
              capturedById: preview.meta?.userId,
              capturedByName: preview.meta?.userName,
              latitude: preview.meta?.latitude,
              longitude: preview.meta?.longitude,
              accuracy: preview.meta?.accuracy,
              deviceInfo: preview.meta?.deviceInfo,
              captureIndex: preview.meta?.captureIndex,
              imageHash: preview.meta?.imageHash,
              action: preview.meta?.mode === 'video' ? 'VIDEO_CAPTURE' : 'IMAGE_CAPTURE',
              metadata: preview.meta,
            },
          });
        } catch { /* server auto-audit fallback */ }
      } else {
        rec = { ...preview };
      }
      const updated = [...captures, rec];
      setCaptures(updated);
      onChange?.(updated);
      setPreview(null);
      if (updated.length >= maxCaptures) stopCamera();
    } catch (err: any) {
      setError('Upload failed: ' + err.message);
    } finally { setLoading(false); }
  }, [preview, apiClient, captures, maxCaptures, onChange, stopCamera]);

  const handleRetake = useCallback(() => {
    if (preview?.previewUrl) URL.revokeObjectURL(preview.previewUrl);
    setPreview(null);
  }, [preview]);

  const handleDelete = useCallback((i: number) => {
    if (disabled) return;
    Modal.confirm({
      title: 'Remove capture',
      content: 'Remove this capture? The audit record will be preserved.',
      onOk: () => { const u = captures.filter((_, j) => j !== i); setCaptures(u); onChange?.(u); },
    });
  }, [captures, disabled, onChange]);

  const isVideo = mode === 'video';
  const ModeIcon = isVideo ? <VideoCameraOutlined /> : <CameraOutlined />;
  const modeLabel = isVideo ? 'Video' : 'Image';

  const mimeOf = (c: any) => c.mimeType || c.mimetype || '';

  // ── SMALL (table cell) ──
  if (size === 'small') {
    return (
      <Space size={4}>
        {captures.map((c, i) =>
          mimeOf(c).startsWith('video/') ? (
            <Tag key={i} icon={<VideoCameraOutlined />} color="purple" style={{ margin: 0 }} />
          ) : (
            <Image key={i} src={getMediaUrl(c)} width={24} height={24}
              style={{ objectFit: 'cover', borderRadius: 2 }} preview={{ mask: false }} />
          ),
        )}
        {captures.length === 0 && <Text type="secondary">\u2014</Text>}
      </Space>
    );
  }

  // ── FULL ──
  return (
    <div style={{ border: '1px solid ' + token.colorBorder, borderRadius: token.borderRadius, padding: token.paddingSM, background: token.colorBgContainer }}>

      {/* Mode header */}
      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Tag icon={ModeIcon} color={isVideo ? 'purple' : 'blue'} style={{ margin: 0 }}>
          {modeLabel} Capture
        </Tag>
        <Text type="secondary" style={{ fontSize: 12 }}>{captures.length}/{maxCaptures}</Text>
      </div>

      {error && <Alert message={error} type="error" closable onClose={() => setError(null)} style={{ marginBottom: 10 }} />}

      {/* Thumbnails */}
      {captures.length > 0 && (
        <div style={{ marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Image.PreviewGroup>
            {captures.map((c, i) => (
              <Badge key={i}
                count={!disabled ? (
                  <DeleteOutlined
                    style={{ color: token.colorError, fontSize: 14, cursor: 'pointer', background: '#fff', borderRadius: '50%', padding: 2 }}
                    onClick={() => handleDelete(i)}
                  />
                ) : null}
              >
                <Tooltip title={
                  <div style={{ fontSize: 11 }}>
                    <div><ClockCircleOutlined /> {c.meta?.timestamp || '\u2014'}</div>
                    <div><UserOutlined /> {c.meta?.userName || '\u2014'}</div>
                    {c.meta?.latitude != null && <div><EnvironmentOutlined /> {c.meta.latitude.toFixed(4)}, {c.meta.longitude?.toFixed(4)}</div>}
                    {c.meta?.durationMs != null && <div>Duration: {(c.meta.durationMs / 1000).toFixed(1)}s</div>}
                  </div>
                }>
                  {mimeOf(c).startsWith('video/') ? (
                    <div style={{ width: 80, height: 80, background: token.colorBgLayout, borderRadius: 4, border: '2px solid ' + token.colorPrimary, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                      onClick={() => window.open(getMediaUrl(c), '_blank')}>
                      <VideoCameraOutlined style={{ fontSize: 24, color: token.colorPrimary }} />
                      <Text style={{ fontSize: 9 }}>Video</Text>
                    </div>
                  ) : (
                    <Image src={getMediaUrl(c)} width={80} height={80}
                      style={{ objectFit: 'cover', borderRadius: 4, border: '2px solid ' + token.colorPrimary }} />
                  )}
                </Tooltip>
              </Badge>
            ))}
          </Image.PreviewGroup>
        </div>
      )}

      {/* Camera controls */}
      {!disabled && captures.length < maxCaptures && (
        <>
          {!cameraOn && !preview && (
            <Button type="primary" icon={ModeIcon} onClick={startCamera} block size="large" style={{ marginBottom: 8 }}>
              Start {modeLabel} Capture
            </Button>
          )}

          {/* Live camera */}
          <div style={{ display: cameraOn && !preview ? 'block' : 'none', position: 'relative', background: '#000', borderRadius: token.borderRadius, overflow: 'hidden', marginBottom: 8 }}>
            <video ref={videoRef} autoPlay playsInline muted={!isVideo} style={{ width: '100%', maxHeight: 400, display: 'block' }} />

            {/* Live IST timestamp overlay */}
            {cameraOn && liveTimestamp && (
              <div style={{ position: 'absolute', bottom: 72, left: 8, background: 'rgba(0,0,0,0.6)', color: '#FADB14', padding: '3px 8px', borderRadius: 4, fontSize: 12, fontFamily: 'monospace', pointerEvents: 'none', letterSpacing: 0.3 }}>
                <ClockCircleOutlined style={{ marginRight: 4 }} />{liveTimestamp}
              </div>
            )}

            {/* REC indicator */}
            {recording && (
              <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(200,0,0,0.9)', color: '#fff', padding: '4px 10px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
                <span style={{ width: 8, height: 8, background: '#fff', borderRadius: '50%', display: 'inline-block' }} />
                REC {elapsedSecs > 0 && elapsedSecs + 's'}
              </div>
            )}

            {/* Action bar */}
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12, background: 'linear-gradient(transparent, rgba(0,0,0,0.72))', display: 'flex', justifyContent: 'center', gap: 12, alignItems: 'center' }}>
              <Button shape="circle" size="large" icon={<SwapOutlined />} onClick={switchCamera} title="Flip camera" />
              {!isVideo ? (
                <Button shape="circle" size="large" type="primary" icon={<CameraOutlined />}
                  onClick={handleImageCapture} loading={loading}
                  style={{ width: 64, height: 64, fontSize: 24 }} title="Capture image" />
              ) : !recording ? (
                <Button shape="circle" size="large" icon={<PlayCircleOutlined />}
                  onClick={handleStartRecording}
                  style={{ width: 64, height: 64, fontSize: 24, background: token.colorError, borderColor: token.colorError, color: '#fff' }} title="Start recording" />
              ) : (
                <Button shape="circle" size="large" type="primary" icon={<StopOutlined />}
                  onClick={handleStopRecording}
                  style={{ width: 64, height: 64, fontSize: 24 }} title="Stop recording" />
              )}
              <Button shape="circle" size="large" danger icon={<StopOutlined />} onClick={stopCamera} title="Close camera" />
            </div>
          </div>

          {/* Preview */}
          {preview && (
            <div style={{ marginTop: 8, textAlign: 'center' }}>
              {preview.mimeType?.startsWith('video/') ? (
                <video src={preview.previewUrl} controls
                  style={{ maxWidth: '100%', maxHeight: 360, borderRadius: token.borderRadius, border: '2px solid ' + token.colorSuccess }} />
              ) : (
                <Image src={preview.previewUrl} preview={false}
                  style={{ maxWidth: '100%', maxHeight: 360, borderRadius: token.borderRadius, border: '2px solid ' + token.colorSuccess }} />
              )}

              {/* Capture metadata */}
              <div style={{ marginTop: 8, padding: '8px 12px', background: token.colorBgLayout, borderRadius: token.borderRadius, fontSize: 12, textAlign: 'left' }}>
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <Text>
                    <ClockCircleOutlined style={{ marginRight: 4, color: token.colorWarning }} />
                    <Text strong>Captured: </Text>{preview.meta?.timestamp}
                  </Text>
                  <Text><UserOutlined style={{ marginRight: 4 }} />{preview.meta?.userName} (ID: {preview.meta?.userId})</Text>
                  {preview.meta?.latitude != null && (
                    <Text><EnvironmentOutlined style={{ marginRight: 4 }} />{preview.meta.latitude.toFixed(5)}, {preview.meta.longitude?.toFixed(5)}</Text>
                  )}
                  {preview.meta?.durationMs != null && (
                    <Text>Duration: {(preview.meta.durationMs / 1000).toFixed(1)}s</Text>
                  )}
                  {preview.meta?.imageHash && (
                    <Text copyable={{ text: preview.meta.imageHash }}>SHA-256: {preview.meta.imageHash.substring(0, 20)}\u2026</Text>
                  )}
                </Space>
              </div>

              <Space style={{ marginTop: 12 }}>
                <Button icon={<ReloadOutlined />} onClick={handleRetake}>Retake</Button>
                <Button type="primary" icon={<CheckCircleOutlined />} onClick={handleAccept} loading={loading}>
                  Save {modeLabel}
                </Button>
              </Space>
            </div>
          )}
        </>
      )}

      {captures.length >= maxCaptures && !disabled && (
        <Alert
          message={'Maximum ' + maxCaptures + ' ' + modeLabel.toLowerCase() + ' capture' + (maxCaptures !== 1 ? 's' : '') + ' reached'}
          type="success" showIcon style={{ marginTop: 8 }}
        />
      )}

      {captures.length === 0 && !cameraOn && !preview && (
        <Paragraph type="secondary" style={{ textAlign: 'center', marginTop: 16 }}>
          {isVideo
            ? <VideoCameraOutlined style={{ fontSize: 28, display: 'block', marginBottom: 4 }} />
            : <CameraOutlined style={{ fontSize: 28, display: 'block', marginBottom: 4 }} />}
          No {modeLabel.toLowerCase()} captures yet
        </Paragraph>
      )}

      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
};

export const ImageCaptureField = connect(Inner, mapReadPretty(ImageCaptureReadPretty));
(ImageCaptureField as any).ReadPretty = ImageCaptureReadPretty;
