import React, { useCallback, useEffect, useRef, useState } from 'react';
import { connect, mapReadPretty } from '@formily/react';
import { Alert, Badge, Button, Image, Modal, Space, Spin, Tag, Tooltip, Typography, theme } from 'antd';
import {
  BulbOutlined,
  CameraOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  EnvironmentOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  ScanOutlined,
  StopOutlined,
  SwapOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { ImageCaptureReadPretty } from './ImageCaptureReadPretty';

const { Text, Paragraph } = Typography;

export interface CaptureMetadata {
  timestamp: string;
  userId: number;
  userName: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  barcode: string | null;
  deviceInfo: string;
  captureIndex: number;
  imageHash: string;
}

export interface CaptureRecord {
  id?: number;
  url?: string;
  filename?: string;
  title?: string;
  blob?: Blob;
  previewUrl?: string;
  meta?: CaptureMetadata;
}

function getImageUrl(record: any): string {
  if (!record) return '';
  if (record.url) return record.url;
  if (record.previewUrl) return record.previewUrl;
  if (record.preview) return record.preview;
  return '';
}

export async function computeSHA256(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

let jsQRModule: any = null;
let jsQRLoaded = false;

async function loadJsQR(): Promise<boolean> {
  if (jsQRLoaded) return !!jsQRModule;
  jsQRLoaded = true;
  try {
    const loadModule = new Function('return import("jsqr")');
    const mod = await loadModule();
    jsQRModule = mod.default || mod;
    return true;
  } catch {
    return false;
  }
}

interface Props {
  value?: any[];
  onChange?: (v: any[]) => void;
  disabled?: boolean;
  cameraOnly?: boolean;
  requireBarcode?: boolean;
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
    cameraOnly = true,
    requireBarcode = false,
    maxCaptures = 5,
    enableGeolocation = true,
    action,
    apiClient,
    currentUser,
    size,
  } = props;

  const { token } = theme.useToken();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [captures, setCaptures] = useState<CaptureRecord[]>(value || []);
  const [cameraOn, setCameraOn] = useState(false);
  const [preview, setPreview] = useState<CaptureRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [facing, setFacing] = useState<'user' | 'environment'>('environment');
  const [flash, setFlash] = useState(false);
  const [barcode, setBarcode] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [geo, setGeo] = useState<GeolocationPosition | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (value && JSON.stringify(value) !== JSON.stringify(captures)) setCaptures(value);
  }, [value, captures]);

  const stopCamera = useCallback(() => {
    if (scanRef.current) {
      clearInterval(scanRef.current);
      scanRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
    setScanning(false);
    setFlash(false);
  }, []);

  useEffect(
    () => () => {
      stopCamera();
    },
    [stopCamera],
  );

  useEffect(() => {
    if (!enableGeolocation || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setGeo(p),
      () => {},
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [enableGeolocation]);

  const startBarcodeScanning = useCallback(() => {
    if (!jsQRModule || !videoRef.current || !canvasRef.current) return;
    setScanning(true);
    scanRef.current = setInterval(() => {
      if (!videoRef.current || !canvasRef.current || !jsQRModule) return;
      const v = videoRef.current,
        c = canvasRef.current,
        ctx = c.getContext('2d');
      if (!ctx || v.readyState !== v.HAVE_ENOUGH_DATA) return;
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      ctx.drawImage(v, 0, 0);
      const img = ctx.getImageData(0, 0, c.width, c.height);
      const code = jsQRModule(img.data, img.width, img.height);
      if (code?.data) {
        setBarcode(code.data);
        setScanning(false);
        if (scanRef.current) {
          clearInterval(scanRef.current);
          scanRef.current = null;
        }
      }
    }, 300);
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);
    setBarcode(null);
    setPreview(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera not supported.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
      if (requireBarcode) {
        const ok = await loadJsQR();
        if (ok) startBarcodeScanning();
      }
    } catch (err: any) {
      setError(err.name === 'NotAllowedError' ? 'Camera access denied.' : 'Camera error: ' + err.message);
    }
  }, [facing, requireBarcode, startBarcodeScanning]);

  const switchCamera = useCallback(() => {
    stopCamera();
    setFacing((p) => (p === 'user' ? 'environment' : 'user'));
  }, [stopCamera]);

  const toggleFlash = useCallback(async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !flash } as any] });
      setFlash(!flash);
    } catch {
      // Flash not supported on this device
    }
  }, [flash]);

  const handleCapture = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || captures.length >= maxCaptures) return;
    setLoading(true);
    try {
      const v = videoRef.current,
        c = canvasRef.current,
        ctx = c.getContext('2d');
      if (!ctx) return;
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      ctx.drawImage(v, 0, 0);
      const blob: Blob = await new Promise((resolve) => c.toBlob((b) => resolve(b || new Blob()), 'image/jpeg', 0.92));
      const hash = await computeSHA256(await blob.arrayBuffer());
      const ts = new Date().toISOString();
      const idx = captures.length + 1;
      const meta: CaptureMetadata = {
        timestamp: ts,
        userId: currentUser?.id || 0,
        userName: currentUser?.nickname || currentUser?.username || 'Unknown',
        latitude: geo?.coords?.latitude ?? null,
        longitude: geo?.coords?.longitude ?? null,
        accuracy: geo?.coords?.accuracy ?? null,
        barcode,
        deviceInfo: navigator.userAgent,
        captureIndex: idx,
        imageHash: hash,
      };
      setPreview({ blob, previewUrl: URL.createObjectURL(blob), filename: 'capture_' + Date.now() + '_' + idx + '.jpg', meta });
    } finally {
      setLoading(false);
    }
  }, [captures, maxCaptures, currentUser, geo, barcode]);

  const handleAccept = useCallback(async () => {
    if (!preview?.blob) return;
    if (requireBarcode && !preview.meta?.barcode) return;
    setLoading(true);
    try {
      let rec: CaptureRecord;
      if (apiClient) {
        const fd = new FormData();
        fd.append('file', preview.blob, preview.filename);
        const res = await apiClient.request({ url: 'attachments:create', method: 'post', data: fd });
        const att = res?.data?.data;
        if (!att || !att.url) {
          setError('Upload failed: No attachment URL returned.');
          setLoading(false);
          return;
        }
        rec = {
          id: att.id,
          url: att.url,
          preview: att.preview || att.url,
          filename: att.filename,
          title: att.title,
          meta: preview.meta,
        } as any;
        try {
          await apiClient.request({
            url: 'imageCaptureAudit:create',
            method: 'post',
            data: {
              attachmentId: att.id,
              capturedAt: preview.meta?.timestamp,
              capturedById: preview.meta?.userId,
              capturedByName: preview.meta?.userName,
              latitude: preview.meta?.latitude,
              longitude: preview.meta?.longitude,
              accuracy: preview.meta?.accuracy,
              barcode: preview.meta?.barcode,
              deviceInfo: preview.meta?.deviceInfo,
              captureIndex: preview.meta?.captureIndex,
              imageHash: preview.meta?.imageHash,
              action: 'CAPTURE',
              metadata: preview.meta,
            },
          });
        } catch {
          // Server auto-audit is fallback
        }
      } else {
        rec = { ...preview };
      }
      const updated = [...captures, rec];
      setCaptures(updated);
      onChange?.(updated);
      setPreview(null);
      setBarcode(null);
      if (updated.length >= maxCaptures) stopCamera();
      else if (requireBarcode && jsQRModule && cameraOn) startBarcodeScanning();
    } catch (err: any) {
      setError('Upload failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [preview, requireBarcode, apiClient, captures, maxCaptures, onChange, stopCamera, cameraOn, startBarcodeScanning]);

  const handleRetake = useCallback(() => {
    if (preview?.previewUrl) URL.revokeObjectURL(preview.previewUrl);
    setPreview(null);
    setBarcode(null);
    if (requireBarcode && jsQRModule && cameraOn) startBarcodeScanning();
  }, [preview, requireBarcode, cameraOn, startBarcodeScanning]);

  const handleDelete = useCallback(
    (i: number) => {
      if (disabled) return;
      Modal.confirm({
        title: 'Delete',
        content: 'Are you sure? Audit record is preserved.',
        onOk: () => {
          const u = captures.filter((_, j) => j !== i);
          setCaptures(u);
          onChange?.(u);
        },
      });
    },
    [captures, disabled, onChange],
  );

  if (size === 'small') {
    return (
      <Space size={4}>
        {captures.map((c, i) => (
          <Image
            key={i}
            src={getImageUrl(c)}
            width={24}
            height={24}
            style={{ objectFit: 'cover', borderRadius: 2 }}
            preview={{ mask: false }}
          />
        ))}
        {captures.length === 0 && <Text type="secondary">—</Text>}
      </Space>
    );
  }

  const remaining = maxCaptures - captures.length;

  return (
    <div
      style={{
        border: '1px solid ' + token.colorBorder,
        borderRadius: token.borderRadius,
        padding: token.paddingSM,
        background: token.colorBgContainer,
      }}
    >
      <Alert
        message={
          <>
            <SafetyCertificateOutlined /> <Text strong>Image Capture</Text>
          </>
        }
        description="Images are immutable, timestamped, and audit-logged."
        type="info"
        showIcon={false}
        banner
        style={{ marginBottom: 12 }}
      />
      {error && (
        <Alert message={error} type="error" closable onClose={() => setError(null)} style={{ marginBottom: 12 }} />
      )}

      {captures.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Text strong>
            {captures.length}/{maxCaptures} capture(s)
          </Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            <Image.PreviewGroup>
              {captures.map((c, i) => (
                <Badge
                  key={i}
                  count={
                    !disabled ? (
                      <DeleteOutlined
                        style={{
                          color: token.colorError,
                          fontSize: 14,
                          cursor: 'pointer',
                          background: '#fff',
                          borderRadius: '50%',
                          padding: 2,
                        }}
                        onClick={() => handleDelete(i)}
                      />
                    ) : null
                  }
                >
                  <Tooltip
                    title={
                      <div style={{ fontSize: 11 }}>
                        <div>
                          <ClockCircleOutlined /> {c.meta?.timestamp || (c as any).createdAt || '\u2014'}
                        </div>
                        <div>
                          <UserOutlined /> {c.meta?.userName || c.title || '\u2014'}
                        </div>
                        {c.meta?.latitude != null && (
                          <div>
                            <EnvironmentOutlined /> {c.meta.latitude.toFixed(4)}, {c.meta.longitude?.toFixed(4)}
                          </div>
                        )}
                        {c.meta?.barcode && (
                          <div>
                            <ScanOutlined /> {c.meta.barcode}
                          </div>
                        )}
                        {c.meta?.imageHash && <div>SHA-256: {c.meta.imageHash.substring(0, 16)}\u2026</div>}
                      </div>
                    }
                  >
                    <Image
                      src={getImageUrl(c)}
                      width={80}
                      height={80}
                      style={{ objectFit: 'cover', borderRadius: 4, border: '2px solid ' + token.colorPrimary }}
                    />
                  </Tooltip>
                </Badge>
              ))}
            </Image.PreviewGroup>
          </div>
        </div>
      )}

      {!disabled && captures.length < maxCaptures && (
        <>
          {!cameraOn && !preview && (
            <Button
              type="primary"
              icon={<CameraOutlined />}
              onClick={startCamera}
              block
              size="large"
              style={{ marginBottom: 8 }}
            >
              Start Camera
            </Button>
          )}

          <div
            style={{
              display: cameraOn && !preview ? 'block' : 'none',
              position: 'relative',
              background: '#000',
              borderRadius: token.borderRadius,
              overflow: 'hidden',
              marginBottom: 8,
            }}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{ width: '100%', maxHeight: 400, display: 'block' }}
            />
            {requireBarcode && scanning && (
              <div
                style={{
                  position: 'absolute',
                  top: 8,
                  left: 8,
                  background: 'rgba(0,0,0,0.6)',
                  color: '#fff',
                  padding: '4px 8px',
                  borderRadius: 4,
                  fontSize: 12,
                }}
              >
                <ScanOutlined spin /> Scanning for barcode\u2026
              </div>
            )}
            {barcode && (
              <div
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  background: 'rgba(0,128,0,0.8)',
                  color: '#fff',
                  padding: '4px 8px',
                  borderRadius: 4,
                  fontSize: 12,
                }}
              >
                <CheckCircleOutlined /> {barcode}
              </div>
            )}
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                padding: 12,
                background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                display: 'flex',
                justifyContent: 'center',
                gap: 12,
              }}
            >
              <Button shape="circle" size="large" icon={<SwapOutlined />} onClick={switchCamera} />
              <Button
                shape="circle"
                size="large"
                icon={<BulbOutlined />}
                onClick={toggleFlash}
                type={flash ? 'primary' : 'default'}
              />
              <Button
                shape="circle"
                size="large"
                type="primary"
                icon={<CameraOutlined />}
                onClick={handleCapture}
                style={{ width: 64, height: 64, fontSize: 24 }}
                disabled={requireBarcode && !barcode && !!jsQRModule}
                loading={loading}
              />
              <Button shape="circle" size="large" danger icon={<StopOutlined />} onClick={stopCamera} />
            </div>
          </div>

          {preview && (
            <div style={{ marginBottom: 8, textAlign: 'center' }}>
              <Image
                src={preview.previewUrl}
                style={{
                  maxWidth: '100%',
                  maxHeight: 400,
                  borderRadius: token.borderRadius,
                  border: '2px solid ' + token.colorSuccess,
                }}
                preview={false}
              />
              <div
                style={{
                  marginTop: 8,
                  padding: 8,
                  background: token.colorBgLayout,
                  borderRadius: token.borderRadius,
                  fontSize: 12,
                  textAlign: 'left',
                }}
              >
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <Text>
                    <ClockCircleOutlined /> {preview.meta?.timestamp}
                  </Text>
                  <Text>
                    <UserOutlined /> {preview.meta?.userName} (ID: {preview.meta?.userId})
                  </Text>
                  {preview.meta?.latitude != null && (
                    <Text>
                      <EnvironmentOutlined /> {preview.meta.latitude.toFixed(5)}, {preview.meta.longitude?.toFixed(5)}
                    </Text>
                  )}
                  {preview.meta?.barcode && (
                    <Text>
                      <ScanOutlined /> {preview.meta.barcode}
                    </Text>
                  )}
                  {preview.meta?.imageHash && (
                    <Text copyable={{ text: preview.meta.imageHash }}>
                      SHA-256: {preview.meta.imageHash.substring(0, 20)}\u2026
                    </Text>
                  )}
                </Space>
              </div>
              {requireBarcode && !preview.meta?.barcode && (
                <Alert message="No barcode detected \u2014 required." type="warning" showIcon style={{ marginTop: 8 }} />
              )}
              <Space style={{ marginTop: 12 }}>
                <Button icon={<ReloadOutlined />} onClick={handleRetake}>
                  Retake
                </Button>
                <Button
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  onClick={handleAccept}
                  loading={loading}
                  disabled={requireBarcode && !preview.meta?.barcode}
                >
                  Accept & Save
                </Button>
              </Space>
            </div>
          )}
        </>
      )}

      {captures.length >= maxCaptures && !disabled && (
        <Alert message={'Maximum captures reached (' + maxCaptures + ')'} type="success" showIcon style={{ marginTop: 8 }} />
      )}
      {captures.length === 0 && !cameraOn && !preview && (
        <Paragraph type="secondary" style={{ textAlign: 'center', marginTop: 16 }}>
          <CameraOutlined style={{ fontSize: 24, display: 'block', marginBottom: 4 }} />
          No captures yet
        </Paragraph>
      )}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
};

export const ImageCaptureField = connect(Inner, mapReadPretty(ImageCaptureReadPretty));

// Register ReadPretty as static property so table/kanban views can find it
// via x-component: 'ImageCaptureField.ReadPretty'
(ImageCaptureField as any).ReadPretty = ImageCaptureReadPretty;
