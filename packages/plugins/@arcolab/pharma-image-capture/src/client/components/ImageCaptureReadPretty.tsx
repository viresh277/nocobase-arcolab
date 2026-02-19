import React, { useCallback, useState } from 'react';
import { useAPIClient } from '@nocobase/client';
import { Image, Modal, Space, Tag, Tooltip, Typography, Empty, theme } from 'antd';
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
  const [modalRecord, setModalRecord] = useState<any>(null);

  const resolve = useCallback((record: any): string => {
    const raw = getRawUrl(record);
    if (!raw) return '';
    if (
      raw.startsWith('http://') ||
      raw.startsWith('https://') ||
      raw.startsWith('blob:') ||
      raw.startsWith('data:')
    ) return raw;
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

  const modalUrl = modalRecord ? resolve(modalRecord) : '';
  const modalTs = modalRecord?.meta?.timestamp || '';
  const modalDur = modalRecord?.meta?.durationMs != null
    ? (modalRecord.meta.durationMs / 1000).toFixed(1) + 's'
    : null;

  // ── SMALL (table / kanban cell) ──
  if (size === 'small') {
    return (
      <>
        <Space size={4}>
          {captures.map((c: any, i: number) => {
            const url = resolve(c);
            return mimeOf(c).startsWith('video/') ? (
              <Tooltip key={i} title={c.meta?.timestamp || 'Click to play video'}>
                <div
                  onClick={() => setModalRecord(c)}
                  style={{
                    width: 24, height: 24,
                    background: token.colorFillSecondary,
                    borderRadius: 2,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer',
                    border: '1px solid ' + token.colorBorder,
                  }}
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

        {/* Inline video modal */}
        <Modal
          open={!!modalRecord && mimeOf(modalRecord).startsWith('video/')}
          onCancel={() => setModalRecord(null)}
          footer={null}
          width={680}
          title={
            <Space>
              <VideoCameraOutlined style={{ color: token.colorPrimary }} />
              <Text strong>Video Capture</Text>
              {modalTs && (
                <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                  <ClockCircleOutlined style={{ marginRight: 4 }} />{modalTs}
                </Text>
              )}
              {modalDur && (
                <Tag color="purple" style={{ fontWeight: 400 }}>{modalDur}</Tag>
              )}
            </Space>
          }
          destroyOnClose
          centered
        >
          {modalRecord && (
            <>
              <video
                src={modalUrl}
                controls
                autoPlay
                playsInline
                style={{ width: '100%', maxHeight: 480, display: 'block', borderRadius: token.borderRadius, background: '#000' }}
              />
              <div style={{ marginTop: 10, fontSize: 12, color: token.colorTextSecondary }}>
                {modalRecord.meta?.userName && (
                  <div><UserOutlined style={{ marginRight: 4 }} />{modalRecord.meta.userName}</div>
                )}
                {modalRecord.meta?.latitude != null && (
                  <div><EnvironmentOutlined style={{ marginRight: 4 }} />{modalRecord.meta.latitude.toFixed(4)}, {modalRecord.meta.longitude?.toFixed(4)}</div>
                )}
              </div>
            </>
          )}
        </Modal>
      </>
    );
  }

  // ── FULL (form detail / read view) ──
  return (
    <>
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
                  {isVid ? (
                    // Thumbnail with play-icon overlay — click opens modal
                    <div
                      style={{ position: 'relative', width: 200, height: 150, cursor: 'pointer' }}
                      onClick={() => setModalRecord(c)}
                    >
                      <video
                        src={url}
                        preload="metadata"
                        muted
                        playsInline
                        style={{ width: 200, height: 150, objectFit: 'cover', display: 'block', background: '#000' }}
                      />
                      <div style={{
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(0,0,0,0.25)',
                      }}>
                        <PlayCircleOutlined style={{ fontSize: 36, color: 'rgba(255,255,255,0.9)' }} />
                      </div>
                    </div>
                  ) : (
                    <Image
                      src={url}
                      width={200} height={150}
                      style={{ objectFit: 'cover', display: 'block' }}
                      preview={{ src: url }}
                    />
                  )}

                  <div style={{ padding: '6px 8px', fontSize: 11, lineHeight: 1.6 }}>
                    <div>
                      <ClockCircleOutlined style={{ marginRight: 4, color: token.colorWarning }} />
                      {c.meta?.timestamp ||
                        (c.createdAt
                          ? new Date(c.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
                          : '\u2014')}
                    </div>
                    <div><UserOutlined style={{ marginRight: 4 }} />{c.meta?.userName || c.title || c.filename || '\u2014'}</div>
                    {c.meta?.latitude != null && (
                      <div><EnvironmentOutlined style={{ marginRight: 4 }} />{c.meta.latitude.toFixed(4)}, {c.meta.longitude?.toFixed(4)}</div>
                    )}
                    {isVid && c.meta?.durationMs != null && (
                      <div><PlayCircleOutlined style={{ marginRight: 4 }} />{(c.meta.durationMs / 1000).toFixed(1)}s</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Image.PreviewGroup>
      </div>

      {/* Shared inline video modal for full view */}
      <Modal
        open={!!modalRecord && mimeOf(modalRecord).startsWith('video/')}
        onCancel={() => setModalRecord(null)}
        footer={null}
        width={720}
        title={
          <Space>
            <VideoCameraOutlined style={{ color: token.colorPrimary }} />
            <Text strong>Video Capture</Text>
            {modalRecord?.meta?.timestamp && (
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                <ClockCircleOutlined style={{ marginRight: 4 }} />{modalRecord.meta.timestamp}
              </Text>
            )}
            {modalRecord?.meta?.durationMs != null && (
              <Tag color="purple" style={{ fontWeight: 400 }}>
                {(modalRecord.meta.durationMs / 1000).toFixed(1)}s
              </Tag>
            )}
          </Space>
        }
        destroyOnClose
        centered
      >
        {modalRecord && (
          <>
            <video
              src={modalUrl}
              controls
              autoPlay
              playsInline
              style={{ width: '100%', maxHeight: 500, display: 'block', borderRadius: token.borderRadius, background: '#000' }}
            />
            <div style={{ marginTop: 10, fontSize: 12, color: token.colorTextSecondary }}>
              {modalRecord.meta?.userName && <div><UserOutlined style={{ marginRight: 4 }} />{modalRecord.meta.userName}</div>}
              {modalRecord.meta?.latitude != null && (
                <div><EnvironmentOutlined style={{ marginRight: 4 }} />{modalRecord.meta.latitude.toFixed(4)}, {modalRecord.meta.longitude?.toFixed(4)}</div>
              )}
            </div>
          </>
        )}
      </Modal>
    </>
  );
};
