import React, { useCallback, useState } from 'react';
import { Image, Modal, Space, Tag, Tooltip, Typography, Empty, theme } from 'antd';
import {
  ClockCircleOutlined, DownloadOutlined, EnvironmentOutlined,
  PlayCircleOutlined, UserOutlined, VideoCameraOutlined,
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
  meta?: Record<string, unknown>;
}

function getRawUrl(r: CaptureRecord): string { return r.url ?? r.preview ?? r.previewUrl ?? ''; }

function resolveUrl(raw: string): string {
  if (!raw) return '';
  if (/^(https?:|blob:|data:)/.test(raw)) return raw;
  return `${window.location.origin}/${raw.replace(/^\//, '')}`;
}

const VIDEO_EXT = /\.(webm|mp4|mov|avi|mkv|ogg)(\?|$)/i;

function isVideo(r: CaptureRecord | null | undefined): boolean {
  if (!r) return false;
  if ((r.meta as any)?.mode === 'video') return true;
  const mt = (r.mimeType || r.mimetype || '').toLowerCase();
  if (mt.startsWith('video/')) return true;
  const h = `${r.extname || ''} ${r.filename || ''} ${r.url || ''}`;
  if (VIDEO_EXT.test(h)) return true;
  if (r.filename?.startsWith('video_')) return true;
  return false;
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}:${sec.toString().padStart(2, '0')}` : `0:${sec.toString().padStart(2, '0')}`;
}

export interface Props {
  value?: CaptureRecord[];
  size?: 'small' | 'default';
}

export const ImageCaptureReadPretty: React.FC<Props> = ({ value, size }) => {
  const { token } = theme.useToken();
  const [modal, setModal] = useState<CaptureRecord | null>(null);
  const getUrl = useCallback((r: CaptureRecord) => resolveUrl(getRawUrl(r)), []);

  const captures = value ?? [];
  if (captures.length === 0) {
    return size === 'small'
      ? <Text type="secondary">{EM_DASH}</Text>
      : <Empty description="No captures" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  const openPlay = (c: CaptureRecord) => setModal(c);
  const closePlay = () => setModal(null);
  const mUrl = modal ? getUrl(modal) : '';
  const mMeta = modal?.meta as any;

  /* ── VideoThumb: attempts real frame, falls back to styled icon ── */
  const VideoThumb: React.FC<{ c: CaptureRecord; w: number; h: number }> = ({ c, w, h }) => {
    const url = getUrl(c);
    const dur = (c.meta as any)?.durationMs as number | undefined;
    const [frameOk, setFrameOk] = useState(false);
    const [frameFail, setFrameFail] = useState(false);

    return (
      <div onClick={() => openPlay(c)} style={{
        position: 'relative', width: w, height: h, cursor: 'pointer',
        borderRadius: 6, overflow: 'hidden',
        background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
        border: `1px solid ${token.colorBorder}`,
      }}>
        {/* Try to load actual first frame */}
        {!frameFail && (
          <video
            src={url}
            preload="metadata"
            muted playsInline
            onLoadedData={(e) => {
              try { e.currentTarget.currentTime = 0.5; } catch {}
              setFrameOk(true);
            }}
            onError={() => setFrameFail(true)}
            style={{ width: w, height: h, objectFit: 'cover', display: frameOk ? 'block' : 'none' }}
          />
        )}
        {/* Fallback icon if video frame didn't load */}
        {!frameOk && (
          <div style={{ width: w, height: h, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <VideoCameraOutlined style={{ fontSize: Math.max(12, w * 0.3), color: 'rgba(255,255,255,0.15)' }} />
          </div>
        )}
        {/* Play button overlay */}
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: frameOk ? 'rgba(0,0,0,0.15)' : 'transparent',
        }}>
          <div style={{
            width: Math.max(18, w * 0.32), height: Math.max(18, w * 0.32),
            borderRadius: '50%', background: 'rgba(255,255,255,0.9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          }}>
            <span style={{ fontSize: Math.max(8, w * 0.16), color: '#6366f1', marginLeft: 1 }}>▶</span>
          </div>
        </div>
        {dur != null && w >= 60 && (
          <div style={{
            position: 'absolute', bottom: 4, right: 4, fontSize: 10, fontWeight: 600,
            color: '#fff', background: 'rgba(0,0,0,0.7)',
            padding: '1px 5px', borderRadius: 3,
          }}>{fmtDuration(dur)}</div>
        )}
        {w >= 60 && (
          <div style={{
            position: 'absolute', top: 4, left: 4, fontSize: 9, fontWeight: 700,
            color: '#fff', background: '#6366f1',
            padding: '1px 5px', borderRadius: 3, textTransform: 'uppercase', letterSpacing: 0.5,
          }}>Video</div>
        )}
      </div>
    );
  };

  /* ── Playback modal — video src= directly (NO <source>) ── */
  const videoModal = (
    <Modal open={!!modal} onCancel={closePlay} footer={null} width={720}
      title={<Space>
        <VideoCameraOutlined style={{ color: token.colorPrimary }} />
        <Text strong>Video Playback</Text>
        {mMeta?.timestamp && <Text type="secondary" style={{ fontSize: 12 }}><ClockCircleOutlined style={{ marginRight: 4 }} />{mMeta.timestamp}</Text>}
        {mMeta?.durationMs != null && <Tag color="purple">{fmtDuration(mMeta.durationMs)}</Tag>}
      </Space>}
      destroyOnClose centered
    >
      {modal && (
        <>
          <video
            src={mUrl}
            controls autoPlay playsInline
            style={{ width: '100%', maxHeight: 500, display: 'block', borderRadius: token.borderRadius, background: '#000' }}
          />
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
              {mMeta?.userName && <span><UserOutlined style={{ marginRight: 4 }} />{mMeta.userName}</span>}
              {mMeta?.latitude != null && <span style={{ marginLeft: 12 }}><EnvironmentOutlined style={{ marginRight: 4 }} />{mMeta.latitude.toFixed(4)}, {mMeta.longitude?.toFixed(4)}</span>}
            </div>
            <a href={mUrl} download style={{ fontSize: 12 }}><DownloadOutlined style={{ marginRight: 4 }} />Download</a>
          </div>
        </>
      )}
    </Modal>
  );

  /* ── Small (table cell) ── */
  if (size === 'small') {
    return (
      <>
        <Space size={4}>
          {captures.map((c, i) => isVideo(c)
            ? <Tooltip key={i} title={(c.meta as any)?.timestamp ?? c.filename ?? 'Video'}><VideoThumb c={c} w={24} h={24} /></Tooltip>
            : <Image key={i} src={getUrl(c)} width={24} height={24} style={{ objectFit: 'cover', borderRadius: 2 }} preview={{ src: getUrl(c) }} />
          )}
        </Space>
        {videoModal}
      </>
    );
  }

  /* ── Full read-only view ── */
  return (
    <>
      <div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadius, padding: token.paddingSM, background: token.colorBgContainer }}>
        <div style={{ marginBottom: 8 }}>
          <Tag color="blue">{captures.length} capture{captures.length !== 1 ? 's' : ''}</Tag>
        </div>
        <Image.PreviewGroup>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {captures.map((c, i) => {
              const vid = isVideo(c);
              const url = getUrl(c);
              return (
                <div key={i} style={{ border: `1px solid ${token.colorBorder}`, borderRadius: token.borderRadius, overflow: 'hidden', width: 200, background: token.colorBgLayout }}>
                  {vid
                    ? <VideoThumb c={c} w={200} h={150} />
                    : <Image src={url} width={200} height={150} style={{ objectFit: 'cover', display: 'block' }} preview={{ src: url }} />
                  }
                  <div style={{ padding: '6px 8px', fontSize: 11, lineHeight: 1.6 }}>
                    <div><ClockCircleOutlined style={{ marginRight: 4, color: token.colorWarning }} />{(c.meta as any)?.timestamp ?? (c.createdAt ? new Date(c.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : EM_DASH)}</div>
                    <div><UserOutlined style={{ marginRight: 4 }} />{(c.meta as any)?.userName ?? c.title ?? c.filename ?? EM_DASH}</div>
                    {(c.meta as any)?.latitude != null && <div><EnvironmentOutlined style={{ marginRight: 4 }} />{(c.meta as any).latitude.toFixed(4)}, {(c.meta as any).longitude?.toFixed(4)}</div>}
                    {vid && (c.meta as any)?.durationMs != null && <div><PlayCircleOutlined style={{ marginRight: 4 }} />{fmtDuration((c.meta as any).durationMs)}</div>}
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
