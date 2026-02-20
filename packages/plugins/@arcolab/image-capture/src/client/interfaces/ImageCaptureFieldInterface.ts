import { ISchema } from '@formily/react';
import { uid } from '@formily/shared';
import { CollectionFieldInterface, interfacesProperties } from '@nocobase/client';
import { tval } from '../locale';

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

  schemaInitialize(schema: ISchema, { block, field }: { block: string; field: any }) {
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

  initialize(values: any) {
    if (!values.through) values.through = `t_${uid()}`;
    if (!values.foreignKey) values.foreignKey = `f_${uid()}`;
    if (!values.otherKey) values.otherKey = `f_${uid()}`;
    if (!values.sourceKey) values.sourceKey = 'id';
    if (!values.targetKey) values.targetKey = 'id';
  }

  properties = {
    ...interfacesProperties.defaultProps,
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
