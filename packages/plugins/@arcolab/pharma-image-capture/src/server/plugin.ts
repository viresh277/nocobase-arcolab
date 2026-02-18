import { Plugin } from '@nocobase/server';
import { ImageCaptureField } from './fields/ImageCaptureField';
import { ImageCaptureInterface } from './interfaces/ImageCaptureInterface';

export class ImageCapturePlugin extends Plugin {
  beforeLoad() {
    this.db.registerFieldTypes({ imageCapture: ImageCaptureField });
  }

  async load() {
    this.db.interfaceManager.registerInterfaceType('imageCapture', ImageCaptureInterface);

    this.app.resourceManager.define({
      name: 'imageCaptureAudit',
      actions: {
        async create(ctx, next) {
          const repo = ctx.db.getRepository('imageCaptureAudit');
          const values = ctx.action.params.values || {};
          values.serverTimestamp = values.serverTimestamp || new Date().toISOString();
          if (ctx.state && ctx.state.currentUser) {
            values.capturedById = values.capturedById || ctx.state.currentUser.id;
            values.capturedByName = values.capturedByName || ctx.state.currentUser.nickname || ctx.state.currentUser.username || 'Unknown';
          }
          ctx.body = await repo.create({ values: values, context: ctx });
          await next();
        },
        async list(ctx, next) {
          const repo = ctx.db.getRepository('imageCaptureAudit');
          const params = ctx.action.params;
          const page = params.page || 1;
          const pageSize = params.pageSize || 20;
          const result = await repo.findAndCount({
            filter: params.filter,
            sort: params.sort || ['-createdAt'],
            offset: (page - 1) * pageSize,
            limit: pageSize,
            context: ctx,
          });
          ctx.body = result[0];
          ctx.meta = { count: result[1], page: Number(page), pageSize: Number(pageSize), totalPage: Math.ceil(result[1] / pageSize) };
          await next();
        },
        async get(ctx, next) {
          const repo = ctx.db.getRepository('imageCaptureAudit');
          ctx.body = await repo.findOne({ filterByTk: ctx.action.params.filterByTk, context: ctx });
          await next();
        },
        async update(ctx) {
          ctx.throw(403, 'Audit records cannot be modified.');
        },
        async destroy(ctx) {
          ctx.throw(403, 'Audit records cannot be deleted.');
        },
      },
    });

    this.app.acl.allow('imageCaptureAudit', 'create', 'loggedIn');
    this.app.acl.allow('imageCaptureAudit', ['list', 'get'], 'loggedIn');
    this.app.acl.registerSnippet({ name: 'pm.' + this.name, actions: ['imageCaptureAudit:*'] });

    this.db.on('attachments.afterCreate', async (model, options) => {
      try {
        var mimetype = model.get('mimetype') || '';
        var filename = model.get('filename') || '';
        if (!mimetype.startsWith('image/') || !filename.match(/^capture_/)) return;
        var repo = this.db.getRepository('imageCaptureAudit');
        if (!repo) return;
        await repo.create({
          values: {
            attachmentId: model.get('id'),
            capturedAt: new Date().toISOString(),
            serverTimestamp: new Date().toISOString(),
            capturedById: (options && options.context && options.context.state && options.context.state.currentUser) ? options.context.state.currentUser.id : null,
            capturedByName: 'System (auto-audit)',
            action: 'CAPTURE_AUTO',
            metadata: { mimetype: mimetype, filename: filename, size: model.get('size'), autoCreated: true },
          },
        });
      } catch (err) {
        this.log.warn('[image-capture] Auto-audit failed: ' + (err as any).message);
      }
    });

    this.db.on('imageCaptureAudit.beforeUpdate', async (model) => {
      var immutable = ['attachmentId','capturedAt','serverTimestamp','capturedById','capturedByName','latitude','longitude','accuracy','barcode','deviceInfo','captureIndex','imageHash','action'];
      var changed = model.changed() || [];
      var violated = changed.filter(function(f) { return immutable.indexOf(f) >= 0; });
      if (violated.length > 0) {
        throw new Error('FDA 21 CFR Part 11 Compliance Violation: Cannot modify immutable audit fields [' + violated.join(', ') + '].');
      }
    });

    this.db.on('imageCaptureAudit.beforeDestroy', async () => {
      throw new Error('FDA 21 CFR Part 11 Compliance Violation: Audit records cannot be deleted.');
    });

    this.log.info('[image-capture] Plugin loaded.');
  }

  async install() {
    this.log.info('[image-capture] Installed.');
  }

  async remove() {
    this.log.warn('[image-capture] Removed. Audit data retained for compliance.');
  }
}

export default ImageCapturePlugin;
