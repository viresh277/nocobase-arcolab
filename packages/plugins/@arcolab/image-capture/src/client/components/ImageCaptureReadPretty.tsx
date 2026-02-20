import React, { useCallback, useState } from 'react';
import { Image, Modal, Space, Tag, Tooltip, Typography, Empty, theme } from 'antd';
import {
  ClockCircleOutlined, UserOutlined, EnvironmentOutlined,
  VideoCameraOutlined, PlayCircleOutlined,
} from '@ant-design/icons';

const { Text } = Typography;
const EM_DASH = '\u2014';

interface CaptureRecord {
  url?: string;
  preview?: string;
  previewUrl?: string;
  filename?: string;
  title?: string;
  name?: string;
  mimeType?: string;
  mimetype?: string;
  extname?: string;
  createdAt?: string;
  meta?: {
    mode?: string;
    timestamp?: string;
    userName?: string;
    latitude?: number;
    longitude?: number;
    durationMs?: number;
  } | Record<string, unknown>;
}

function getRawUrl(rec: CaptureRecord): string {
  return rec.url ?? rec.preview ?? rec.previewUrl ?? '';
}

/**
 * Resolve a storage-relative URL to a full URL.
 * Matches NocoBase core toItem() pattern: always use location.origin.
 */
function resolveUrl(raw: string): string {
  if (!raw) return '';
  if (/^(https?:|blob:|data:)/.test(raw)) return raw;
  return `${window.location.origin}/${raw.replace(/^\//, '')}`;
}

const VIDEO_EXT_RE = /\.(webm|mp4|mov|avi|mkv|ogg)(\?|$)/i;

/**
 * Ultra-robust video detection. Checks every possible signal.
 */
function isVideo(rec: CaptureRecord | null | undefined): boolean {
  if (!rec) return false;
  // 1. Our custom meta field
  if ((rec.meta as any)?.mode === 'video') return true;
  // 2. Direct MIME type fields
  const mt = (rec.mimeType || rec.mimetype || '').toLowerCase();
  if (mt.startsWith('video/')) return true;
  // 3. Extension in extname / filename / url
  const hint = `${rec.extname || ''} ${rec.filename || ''} ${rec.url || ''}`.toLowerCase();
  if (VIDEO_EXT_RE.test(hint)) return true;
  // 4. Our filename convention
  if (rec.filename && rec.filename.startsWith('video_')) return true;
  return false;
}

/** Strip codec params so the type attr is clean: "video/webm;codecs=vp9" → "video/webm" */
function baseMime(rec: CaptureRecord | null | undefined): string {
  const mt = (rec?.mimeType || rec?.mimetype || '');
  return mt.split(';')[0].trim();
}

// Exported so ImageCaptureField's declaration build can name this type (TS4023)
export interface Props {
  value?: CaptureRecord[];
  size?: 'small' | 'default';
}

export const ImageCaptureReadPretty: React.FC<Props> = ({ value, size }) => {
  const { token } = theme.useToken();
  const [modal, setModal] = useState<CaptureRecord | null>(null);
  const [videoError, setVideoError] = useState(false);

  const getUrl = useCallback(
    (rec: CaptureRecord) => resolveUrl(getRawUrl(rec)), [],
  );

  const captures = value ?? [];

  if (captures.length === 0) {
    return size === 'small'
      ? <Text type="secondary">{EM_DASH}</Text>
      : <Empty description="No captures" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  const openVideoModal = (c: CaptureRecord) => {
    setVideoError(false);
    setModal(c);
  };
  const closeModal = () => { setModal(null); setVideoError(false); };

  const modalUrl = modal ? getUrl(modal) : '';
  const modalMime = baseMime(modal);
  const modalMeta = modal?.meta as any;
  const modalTs = modalMeta?.timestamp ?? '';
  const modalDur = modalMeta?.durationMs != null
    ? `${(modalMeta.durationMs / 1000).toFixed(1)}s` : null;

  const videoModal = (
    <Modal
      open={!!modal}
      onCancel={closeModal}
      footer={null}
      width={720}
      title={
        <Space>
          <VideoCameraOutlined style={{ color: token.colorPrimary }} />
          <Text strong>Video Playback</Text>
          {modalTs && <Text type="secondary" style={{ fontSize: 12 }}><ClockCircleOutlined style={{ marginRight: 4 }} />{modalTs}</Text>}
          {modalDur && <Tag color="purple">{modalDur}</Tag>}
        </Space>
      }
      destroyOnClose
      centered
    >
      {modal && !videoError && (
        <>
          <video
            key={modalUrl}
            controls autoPlay playsInline
            onError={() => setVideoError(true)}
            style={{ width: '100%', maxHeight: 500, display: 'block', borderRadius: token.borderRadius, background: '#000' }}
          >
            <source src={modalUrl} type={modalMime || 'video/webm'} />
            <source src={modalUrl} />
            Your browser does not support video playback.
          </video>
          <div style={{ marginTop: 10, fontSize: 12, color: token.colorTextSecondary }}>
            {modalMeta?.userName && <div><UserOutlined style={{ marginRight: 4 }} />{modalMeta.userName}</div>}
            {modalMeta?.latitude != null && (
              <div><EnvironmentOutlined style={{ marginRight: 4 }} />{modalMeta.latitude.toFixed(4)}, {modalMeta.longitude?.toFixed(4)}</div>
            )}
          </div>
        </>
      )}
      {modal && videoError && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <VideoCameraOutlined style={{ fontSize: 48, color: token.colorTextDisabled }} />
          <div style={{ marginTop: 12, color: token.colorTextSecondary }}>
            Unable to play this video in the browser.
          </div>
          <a href={modalUrl} download style={{ marginTop: 8, display: 'inline-block' }}>
            Download video file
          </a>
        </div>
      )}
    </Modal>
  );

  /** Icon-based video thumbnail — always visible, clickable */
  const videoThumb = (c: CaptureRecord, w: number, h: number) => (
    <div
      onClick={() => openVideoModal(c)}
      style={{
        position: 'relative', width: w, height: h,
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        borderRadius: 4, border: `1px solid ${token.colorBorder}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', overflow: 'hidden',
      }}
    >
      <VideoCameraOutlined style={{ fontSize: Math.max(10, w * 0.35), color: 'rgba(255,255,255,0.3)' }} />
      <PlayCircleOutlined style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%,-50%)',
        fontSize: Math.max(10, w * 0.28), color: 'rgba(255,255,255,0.9)',
      }} />
      {(c.meta as any)?.durationMs != null && w >= 80 && (
        <div style={{
          position: 'absolute', bottom: 2, right: 4,
          fontSize: 9, color: '#fff', background: 'rgba(0,0,0,0.6)',
          padding: '0 3px', borderRadius: 2,
        }}>
          {((c.meta as any).durationMs / 1000).toFixed(1)}s
        </div>
      )}
    </div>
  );

  if (size === 'small') {
    return (
      <>
        <Space size={4}>
          {captures.map((c, i) => {
            const url = getUrl(c);
            return isVideo(c) ? (
              <Tooltip key={i} title={(c.meta as any)?.timestamp ?? c.filename ?? 'Video'}>
                {videoThumb(c, 24, 24)}
              </Tooltip>
            ) : (
              <Image key={i} src={url} width={24} height={24}
                style={{ objectFit: 'cover', borderRadius: 2 }} preview={{ src: url }} />
            );
          })}
        </Space>
        {videoModal}
      </>
    );
  }

  return (
    <>
      <div style={{
        border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadius,
        padding: token.paddingSM, background: token.colorBgContainer,
      }}>
        <div style={{ marginBottom: 8 }}>
          <Tag color="blue">{captures.length} capture{captures.length !== 1 ? 's' : ''}</Tag>
        </div>
        <Image.PreviewGroup>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {captures.map((c, i) => {
              const vid = isVideo(c);
              const url = getUrl(c);
              return (
                <div key={i} style={{
                  border: `1px solid ${token.colorBorder}`, borderRadius: token.borderRadius,
                  overflow: 'hidden', width: 200, background: token.colorBgLayout,
                }}>
                  {vid ? (
                    /* Icon-based video card — always visible, click to play */
                    <div
                      style={{
                        position: 'relative', width: 200, height: 150, cursor: 'pointer',
                        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                      onClick={() => openVideoModal(c)}
                    >
                      <VideoCameraOutlined style={{ fontSize: 48, color: 'rgba(255,255,255,0.2)' }} />
                      <div style={{
                        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        <PlayCircleOutlined style={{ fontSize: 42, color: 'rgba(255,255,255,0.9)' }} />
                      </div>
                      {(c.meta as any)?.durationMs != null && (
                        <div style={{
                          position: 'absolute', bottom: 6, right: 8,
                          fontSize: 11, color: '#fff', background: 'rgba(0,0,0,0.65)',
                          padding: '1px 6px', borderRadius: 3,
                        }}>
                          {((c.meta as any).durationMs / 1000).toFixed(1)}s
                        </div>
                      )}
                    </div>
                  ) : (
                    <Image src={url} width={200} height={150}
                      style={{ objectFit: 'cover', display: 'block' }} preview={{ src: url }} />
                  )}
                  <div style={{ padding: '6px 8px', fontSize: 11, lineHeight: 1.6 }}>
                    <div>
                      <ClockCircleOutlined style={{ marginRight: 4, color: token.colorWarning }} />
                      {(c.meta as any)?.timestamp ?? (c.createdAt
                        ? new Date(c.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
                        : EM_DASH)}
                    </div>
                    <div><UserOutlined style={{ marginRight: 4 }} />{(c.meta as any)?.userName ?? c.title ?? c.filename ?? EM_DASH}</div>
                    {(c.meta as any)?.latitude != null && (
                      <div><EnvironmentOutlined style={{ marginRight: 4 }} />{(c.meta as any).latitude.toFixed(4)}, {(c.meta as any).longitude?.toFixed(4)}</div>
                    )}
                    {vid && (c.meta as any)?.durationMs != null && (
                      <div><PlayCircleOutlined style={{ marginRight: 4 }} />{((c.meta as any).durationMs / 1000).toFixed(1)}s</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Image.PreviewGroup>
      </div>
      {videoModal}
    </>
  );
};
