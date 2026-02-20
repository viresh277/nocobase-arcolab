import { Plugin } from '@nocobase/client';
import { ImageCaptureFieldInterface } from './interfaces/ImageCaptureFieldInterface';
import { ImageCaptureField } from './components/ImageCaptureField';
import { ImageCaptureReadPretty } from './components/ImageCaptureReadPretty';
import { useImageCaptureFieldProps } from './hooks/useImageCaptureFieldProps';

export class ImageCapturePlugin extends Plugin {
  async load() {
    this.app.dataSourceManager.addFieldInterfaces([ImageCaptureFieldInterface]);

    this.app.addComponents({
      ImageCaptureField,
      ImageCaptureReadPretty,
    });

    this.app.addScopes({
      useImageCaptureFieldProps,
    });
  }
}

export default ImageCapturePlugin;
