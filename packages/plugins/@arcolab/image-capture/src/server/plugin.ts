import { Plugin } from '@nocobase/server';

export class ImageCapturePlugin extends Plugin {
  async load() {
    this.app.resourceManager.define({
      name: 'imageCaptureAudit',
      actions: {
        async create(ctx, next) {
          const values = ctx.action?.params?.values;
          ctx.app.logger.info('[image-capture] Audit:', JSON.stringify(values));
          ctx.body = { success: true };
          await next();
        },
      },
    });

    this.app.acl.allow('imageCaptureAudit', 'create', 'loggedIn');

    this.db.on('attachments.afterCreate', async (model) => {
      const filename = String(model.get('filename') ?? '');
      if (!filename.startsWith('capture_') && !filename.startsWith('video_')) return;
      const action = filename.startsWith('video_') ? 'VIDEO_CAPTURE' : 'IMAGE_CAPTURE';
      this.app.logger.info(`[image-capture] ${action}: ${filename}`);
    });

    this.app.logger.info('[image-capture] Plugin loaded.');
  }

  async install() {}
  async afterEnable() {}
  async afterDisable() {}
  async remove() {}
}

export default ImageCapturePlugin;
