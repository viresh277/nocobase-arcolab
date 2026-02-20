import { ISchema } from '@formily/react';
import { uid } from '@formily/shared';
import { CollectionFieldInterface } from '@nocobase/client';
import { tval } from '../locale';

interface FieldShape {
  uiSchema?: {
    'x-component-props'?: Record<string, unknown>;
  };
}

export class ImageCaptureFieldInterface extends CollectionFieldInterface {
  name = 'imageCapture';
  type = 'object';
  group = 'media';
  order = 2;
  title = tval('Image / Video Capture');
  description = tval('Capture image or video with automatic timestamp');
  isAssociation = true;

  default = {
    type: 'belongsToMany',
    target: 'attachments',
    uiSchema: {
      type: 'array',
      'x-component': 'ImageCaptureField',
      'x-use-component-props': 'useImageCaptureFieldProps',
      'x-component-props': {
        mode: 'image',
        maxCaptures: 5,
        enableGeolocation: true,
      },
    },
  };

  availableTypes = ['belongsToMany'];

  schemaInitialize(schema: ISchema, { block, field }: { block: string; field: FieldShape }) {
    if (!schema['x-component-props']) {
      schema['x-component-props'] = {};
    }
    const fp = field?.uiSchema?.['x-component-props'] ?? {};
    schema['x-component-props'].mode = fp.mode ?? 'image';
    schema['x-component-props'].maxCaptures = fp.maxCaptures ?? 5;
    schema['x-component-props'].enableGeolocation = fp.enableGeolocation ?? true;
    if (['Table', 'Kanban'].includes(block)) {
      schema['x-component-props'].size = 'small';
      schema['x-component'] = 'ImageCaptureField.ReadPretty';
    }
    schema['x-use-component-props'] = 'useImageCaptureFieldProps';
  }

  initialize(values: Record<string, string>) {
    if (!values.through) values.through = `t_${uid()}`;
    if (!values.foreignKey) values.foreignKey = `f_${uid()}`;
    if (!values.otherKey) values.otherKey = `f_${uid()}`;
    if (!values.sourceKey) values.sourceKey = 'id';
    if (!values.targetKey) values.targetKey = 'id';
  }

  properties = {
    // Standard field display name and field name — inlined from NocoBase's internal defaultProps
    // (defaultProps is NOT exported from @nocobase/client; this is the correct approach for plugins)
    'uiSchema.title': {
      type: 'string',
      title: '{{t("Field display name")}}',
      required: true,
      'x-decorator': 'FormItem',
      'x-component': 'Input',
    },
    name: {
      type: 'string',
      title: '{{t("Field name")}}',
      required: true,
      'x-disabled': '{{ !createOnly }}',
      'x-decorator': 'FormItem',
      'x-component': 'Input',
      'x-validator': 'uid',
      description:
        "{{t('Randomly generated and can be modified. Support letters, numbers and underscores, must start with an letter.')}}",
    },
    'uiSchema.x-component-props.mode': {
      type: 'string',
      title: tval('Capture Mode'),
      'x-decorator': 'FormItem',
      'x-component': 'Radio.Group',
      default: 'image',
      'x-component-props': { optionType: 'button', buttonStyle: 'solid' },
      enum: [
        { label: 'Image', value: 'image' },
        { label: 'Video', value: 'video' },
      ],
    },
    'uiSchema.x-component-props.maxCaptures': {
      type: 'number',
      title: tval('Max Captures'),
      'x-decorator': 'FormItem',
      'x-component': 'InputNumber',
      'x-component-props': { min: 1, max: 20 },
      default: 5,
    },
    'uiSchema.x-component-props.enableGeolocation': {
      type: 'boolean',
      title: tval('Enable GPS Location'),
      'x-decorator': 'FormItem',
      'x-component': 'Checkbox',
      default: true,
    },
  };

  filterable = {
    children: [
      {
        name: 'id',
        value: 'id',
        title: '{{t("Exists")}}',
        label: '{{t("Exists")}}',
        operators: [
          { label: '{{t("exists")}}', value: '$exists', noValue: true },
          { label: '{{t("not exists")}}', value: '$notExists', noValue: true },
        ],
        schema: { title: '{{t("Exists")}}', type: 'string', 'x-component': 'Input' },
      },
    ],
  };
}
