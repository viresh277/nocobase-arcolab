import React from 'react';
import { Image, Space, Tag, Typography, Empty, theme } from 'antd';
import { ClockCircleOutlined, UserOutlined, EnvironmentOutlined, VideoCameraOutlined } from '@ant-design/icons';

const { Text } = Typography;

function getMediaUrl(record: any): string {
  if (!record) return '';
  if (record.url) return record.url;
  if (record.previewUrl) return record.previewUrl;
  if (record.preview) return record.preview;
  return '';
}

interface Props {
  value?: any[];
  size?: 'small' | 'default';
}

export const ImageCaptureReadPretty: React.FC<Props> = ({ value, size }) => {
  const { token } = theme.useToken();
  const captures = value || [];

  if (captures.length === 0) {
    if (size === 'small') return <Text type="secondary">\u2014</Text>;
    return <Empty description="No captures" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  const mimeOf = (c: any) => c.mimeType || c.mimetype || '';

  if (size === 'small') {
    return (
      <Image.PreviewGroup>
        <Space size={4}>
          {captures.map((c: any, i: number) =>
            mimeOf(c).startsWith('video/') ? (
              <Tag key={i} icon={<VideoCameraOutlined />} color="purple" style={{ margin: 0 }} />
            ) : (
              <Image key={i} src={getMediaUrl(c)} width={24} height={24}
                style={{ objectFit: 'cover', borderRadius: 2 }} />
            ),
          )}
        </Space>
      </Image.PreviewGroup>
    );
  }

  return (
    <div style={{ border: '1px solid ' + token.colorBorderSecondary, borderRadius: token.borderRadius, padding: token.paddingSM, background: token.colorBgContainer }}>
      <div style={{ marginBottom: 8 }}>
        <Tag color="blue">{captures.length} capture(s)</Tag>
      </div>
      <Image.PreviewGroup>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {captures.map((c: any, i: number) => {
            const isVid = mimeOf(c).startsWith('video/');
            return (
              <div key={i} style={{ border: '1px solid ' + token.colorBorder, borderRadius: token.borderRadius, overflow: 'hidden', width: 200 }}>
                {isVid ? (
                  <div style={{ width: 200, height: 150, background: token.colorBgLayout, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                    onClick={() => window.open(getMediaUrl(c), '_blank')}>
                    <VideoCameraOutlined style={{ fontSize: 32, color: token.colorPrimary }} />
                    <Text type="secondary" style={{ fontSize: 11, marginTop: 4 }}>Click to play</Text>
                    {c.meta?.durationMs && (
                      <Text type="secondary" style={{ fontSize: 10 }}>{(c.meta.durationMs / 1000).toFixed(1)}s</Text>
                    )}
                  </div>
                ) : (
                  <Image src={getMediaUrl(c)} width={200} height={150} style={{ objectFit: 'cover', display: 'block' }} />
                )}
                <div style={{ padding: '6px 8px', background: token.colorBgLayout, fontSize: 11 }}>
                  <div>
                    <ClockCircleOutlined style={{ marginRight: 4 }} />
                    {c.meta?.timestamp || (c.createdAt ? new Date(c.createdAt).toLocaleString() : '\u2014')}
                  </div>
                  <div><UserOutlined style={{ marginRight: 4 }} />{c.meta?.userName || c.title || '\u2014'}</div>
                  {c.meta?.latitude != null && (
                    <div><EnvironmentOutlined style={{ marginRight: 4 }} />{c.meta.latitude.toFixed(4)}, {c.meta.longitude?.toFixed(4)}</div>
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
