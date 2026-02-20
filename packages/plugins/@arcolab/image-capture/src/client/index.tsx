import { Plugin } from '@nocobase/client';
import { ImageCaptureFieldInterface } from './interfaces/ImageCaptureFieldInterface';
import { ImageCaptureField } from './components/ImageCaptureField';
import { ImageCaptureReadPretty } from './components/ImageCaptureReadPretty';
import { useImageCaptureFieldProps } from './hooks/useImageCaptureFieldProps';

export class ImageCapturePlugin extends Plugin {
  async load() {
    // @ts-ignore -- Plugin.app type may not resolve during declaration build (peer dep)
    this.app.dataSourceManager.addFieldInterfaces([ImageCaptureFieldInterface]);

    // @ts-ignore
    this.app.addComponents({
      ImageCaptureField,
      ImageCaptureReadPretty,
    });

    // @ts-ignore
    this.app.addScopes({
      useImageCaptureFieldProps,
    });
  }
}

export default ImageCapturePlugin;
