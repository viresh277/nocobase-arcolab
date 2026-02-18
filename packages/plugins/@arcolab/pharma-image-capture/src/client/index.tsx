import { Plugin } from '@nocobase/client';
import { ImageCaptureFieldInterface } from './interfaces/ImageCaptureFieldInterface';
import { ImageCaptureField } from './components/ImageCaptureField';
import { ImageCaptureReadPretty } from './components/ImageCaptureReadPretty';
import { ImageCaptureSettings } from './components/ImageCaptureSettings';
import { useImageCaptureFieldProps } from './hooks/useImageCaptureFieldProps';
import { NAMESPACE, tval } from './locale';

export class PharmaImageCapturePlugin extends Plugin {
  async load() {
    this.app.dataSourceManager.addFieldInterfaces([ImageCaptureFieldInterface]);

    this.app.addComponents({
      ImageCaptureField,
      ImageCaptureReadPretty,
      ImageCaptureSettings,
    });

    this.app.addScopes({
      useImageCaptureFieldProps,
    });

    this.app.pluginSettingsManager.add(NAMESPACE, {
      title: tval('Pharma Image Capture Settings'),
      icon: 'CameraOutlined',
      Component: ImageCaptureSettings,
    });
  }
}

export default PharmaImageCapturePlugin;
