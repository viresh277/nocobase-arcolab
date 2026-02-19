import React, { useCallback } from 'react';
import { useAPIClient } from '@nocobase/client';
import { Image, Space, Tag, Tooltip, Typography, Empty, theme } from 'antd';
import {
  ClockCircleOutlined, UserOutlined, EnvironmentOutlined,
  VideoCameraOutlined, PlayCircleOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

function getRawUrl(record: any): string {
  if (!record) return '';
  return record.url || record.preview || record.previewUrl || '';
}

function mimeOf(record: any): string {
  return record?.mimeType || record?.mimetype || '';
}

interface Props {
  value?: any[];
  size?: 'small' | 'default';
}

export const ImageCaptureReadPretty: React.FC<Props> = ({ value, size }) => {
  const { token } = theme.useToken();
  const apiClient = useAPIClient();

  /**
   * Resolves an attachment record's URL to an absolute URL.
   * NocoBase frontend (:13000) and file server (:13001) may differ —
   * apiClient.axios.defaults.baseURL gives us the correct server root.
   */
  const resolve = useCallback((record: any): string => {
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
      (apiClient as any)?.axios?.defaults?.baseURL ||
      window.location.origin
    ).replace(/\/api\/?$/, '').replace(/\/$/, '');
    return base + (raw.startsWith('/') ? raw : '/' + raw);
  }, [apiClient]);

  const captures = value || [];

  if (captures.length === 0) {
    if (size === 'small') return <Text type="secondary">\u2014</Text>;
    return <Empty description="No captures" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  // ── SMALL (table / kanban cell) ──
  if (size === 'small') {
    return (
      <Space size={4}>
        {captures.map((c: any, i: number) => {
          const url = resolve(c);
          return mimeOf(c).startsWith('video/') ? (
            <Tooltip key={i} title={c.meta?.timestamp || c.filename || 'Video — click to open'}>
              <div
                style={{
                  width: 24, height: 24, background: token.colorFillSecondary,
                  borderRadius: 2, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', cursor: 'pointer', border: '1px solid ' + token.colorBorder,
                }}
                onClick={() => { if (url) window.open(url, '_blank'); }}
              >
                <VideoCameraOutlined style={{ fontSize: 11, color: token.colorPrimary }} />
              </div>
            </Tooltip>
          ) : (
            <Image
              key={i}
              src={url}
              width={24} height={24}
              style={{ objectFit: 'cover', borderRadius: 2 }}
              preview={{ src: url }}
            />
          );
        })}
      </Space>
    );
  }

  // ── FULL (form detail / read view) ──
  return (
    <div style={{
      border: '1px solid ' + token.colorBorderSecondary,
      borderRadius: token.borderRadius,
      padding: token.paddingSM,
      background: token.colorBgContainer,
    }}>
      <div style={{ marginBottom: 8 }}>
        <Tag color="blue">
          {captures.length} capture{captures.length !== 1 ? 's' : ''}
        </Tag>
      </div>

      <Image.PreviewGroup>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {captures.map((c: any, i: number) => {
            const isVid = mimeOf(c).startsWith('video/');
            const url = resolve(c);
            return (
              <div
                key={i}
                style={{
                  border: '1px solid ' + token.colorBorder,
                  borderRadius: token.borderRadius,
                  overflow: 'hidden',
                  width: 200,
                  background: token.colorBgLayout,
                }}
              >
                {/* Media area */}
                {isVid ? (
                  // Inline video player — controls for play/pause/seek/volume
                  <video
                    src={url}
                    controls
                    playsInline
                    preload="metadata"
                    style={{
                      width: 200, height: 150,
                      display: 'block', objectFit: 'cover',
                      background: '#000',
                    }}
                  />
                ) : (
                  <Image
                    src={url}
                    width={200} height={150}
                    style={{ objectFit: 'cover', display: 'block' }}
                    preview={{ src: url }}
                  />
                )}

                {/* Metadata strip */}
                <div style={{ padding: '6px 8px', fontSize: 11, lineHeight: 1.6 }}>
                  <div>
                    <ClockCircleOutlined style={{ marginRight: 4, color: token.colorWarning }} />
                    {c.meta?.timestamp ||
                      (c.createdAt
                        ? new Date(c.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
                        : '\u2014')}
                  </div>
                  <div>
                    <UserOutlined style={{ marginRight: 4 }} />
                    {c.meta?.userName || c.title || c.filename || '\u2014'}
                  </div>
                  {c.meta?.latitude != null && (
                    <div>
                      <EnvironmentOutlined style={{ marginRight: 4 }} />
                      {c.meta.latitude.toFixed(4)}, {c.meta.longitude?.toFixed(4)}
                    </div>
                  )}
                  {isVid && c.meta?.durationMs != null && (
                    <div>
                      <PlayCircleOutlined style={{ marginRight: 4 }} />
                      {(c.meta.durationMs / 1000).toFixed(1)}s
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Image.PreviewGroup>
    </div>
  );
};
