import React, { useCallback, useState } from 'react';
import { APIClient, useAPIClient } from '@nocobase/client';
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
  mimeType?: string;
  mimetype?: string;
  extname?: string;
  createdAt?: string;
  meta?: {
    timestamp?: string;
    userName?: string;
    latitude?: number;
    longitude?: number;
    durationMs?: number;
  };
}

function getRawUrl(rec: CaptureRecord): string {
  return rec.url ?? rec.preview ?? rec.previewUrl ?? '';
}

function mimeOf(rec: CaptureRecord | null | undefined): string {
  const direct = rec?.mimeType ?? rec?.mimetype ?? '';
  if (direct) return direct;
  const hint = (rec?.extname ?? rec?.filename ?? rec?.url ?? '').toLowerCase();
  if (/\.webm/.test(hint)) return 'video/webm';
  if (/\.mp4/.test(hint)) return 'video/mp4';
  if (/\.mov/.test(hint)) return 'video/quicktime';
  if (/\.avi/.test(hint)) return 'video/x-msvideo';
  if (/\.jpe?g/.test(hint)) return 'image/jpeg';
  if (/\.png/.test(hint)) return 'image/png';
  if (/\.gif/.test(hint)) return 'image/gif';
  if (/\.webp/.test(hint)) return 'image/webp';
  return '';
}

function isVideo(rec: CaptureRecord | null | undefined): boolean {
  return mimeOf(rec).startsWith('video/');
}

function resolveUrl(raw: string, client: APIClient): string {
  if (!raw || /^(https?:|blob:|data:)/.test(raw)) return raw;
  const base = String(client.axios.defaults.baseURL ?? window.location.origin)
    .replace(/\/api\/?$/, '').replace(/\/$/, '');
  return base + (raw.startsWith('/') ? raw : `/${raw}`);
}

// Exported so ImageCaptureField's declaration build can name this type (TS4023)
export interface Props {
  value?: CaptureRecord[];
  size?: 'small' | 'default';
}

export const ImageCaptureReadPretty: React.FC<Props> = ({ value, size }) => {
  const { token } = theme.useToken();
  const api = useAPIClient();
  const [modal, setModal] = useState<CaptureRecord | null>(null);

  const getUrl = useCallback(
    (rec: CaptureRecord) => resolveUrl(getRawUrl(rec), api), [api],
  );

  const captures = value ?? [];

  if (captures.length === 0) {
    return size === 'small'
      ? <Text type="secondary">{EM_DASH}</Text>
      : <Empty description="No captures" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  const modalUrl = modal ? getUrl(modal) : '';
  const modalTs = modal?.meta?.timestamp ?? '';
  const modalDur = modal?.meta?.durationMs != null
    ? `${(modal.meta.durationMs / 1000).toFixed(1)}s` : null;

  const videoModal = (
    <Modal
      open={!!modal && isVideo(modal)}
      onCancel={() => setModal(null)}
      footer={null}
      width={720}
      title={
        <Space>
          <VideoCameraOutlined style={{ color: token.colorPrimary }} />
          <Text strong>Video Capture</Text>
          {modalTs && <Text type="secondary" style={{ fontSize: 12 }}><ClockCircleOutlined style={{ marginRight: 4 }} />{modalTs}</Text>}
          {modalDur && <Tag color="purple">{modalDur}</Tag>}
        </Space>
      }
      destroyOnClose
      centered
    >
      {modal && (
        <>
          <video src={modalUrl} controls autoPlay playsInline
            style={{ width: '100%', maxHeight: 500, display: 'block', borderRadius: token.borderRadius, background: '#000' }} />
          <div style={{ marginTop: 10, fontSize: 12, color: token.colorTextSecondary }}>
            {modal.meta?.userName && <div><UserOutlined style={{ marginRight: 4 }} />{modal.meta.userName}</div>}
            {modal.meta?.latitude != null && (
              <div><EnvironmentOutlined style={{ marginRight: 4 }} />{modal.meta.latitude.toFixed(4)}, {modal.meta.longitude?.toFixed(4)}</div>
            )}
          </div>
        </>
      )}
    </Modal>
  );

  if (size === 'small') {
    return (
      <>
        <Space size={4}>
          {captures.map((c, i) => {
            const url = getUrl(c);
            return isVideo(c) ? (
              <Tooltip key={i} title={c.meta?.timestamp ?? c.filename ?? 'Video'}>
                <div onClick={() => setModal(c)} style={{
                  width: 24, height: 24, background: token.colorFillSecondary, borderRadius: 2,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                  border: `1px solid ${token.colorBorder}`,
                }}>
                  <VideoCameraOutlined style={{ fontSize: 11, color: token.colorPrimary }} />
                </div>
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
                    <div style={{ position: 'relative', width: 200, height: 150, cursor: 'pointer' }}
                      onClick={() => setModal(c)}>
                      <video src={url} preload="metadata" muted playsInline
                        style={{ width: 200, height: 150, objectFit: 'cover', display: 'block', background: '#000' }} />
                      <div style={{
                        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                        justifyContent: 'center', background: 'rgba(0,0,0,0.25)',
                      }}>
                        <PlayCircleOutlined style={{ fontSize: 36, color: 'rgba(255,255,255,0.9)' }} />
                      </div>
                    </div>
                  ) : (
                    <Image src={url} width={200} height={150}
                      style={{ objectFit: 'cover', display: 'block' }} preview={{ src: url }} />
                  )}
                  <div style={{ padding: '6px 8px', fontSize: 11, lineHeight: 1.6 }}>
                    <div>
                      <ClockCircleOutlined style={{ marginRight: 4, color: token.colorWarning }} />
                      {c.meta?.timestamp ?? (c.createdAt
                        ? new Date(c.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
                        : EM_DASH)}
                    </div>
                    <div><UserOutlined style={{ marginRight: 4 }} />{c.meta?.userName ?? c.title ?? c.filename ?? EM_DASH}</div>
                    {c.meta?.latitude != null && (
                      <div><EnvironmentOutlined style={{ marginRight: 4 }} />{c.meta.latitude.toFixed(4)}, {c.meta.longitude?.toFixed(4)}</div>
                    )}
                    {vid && c.meta?.durationMs != null && (
                      <div><PlayCircleOutlined style={{ marginRight: 4 }} />{(c.meta.durationMs / 1000).toFixed(1)}s</div>
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
