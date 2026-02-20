import { useTranslation } from 'react-i18next';

export const NAMESPACE = 'image-capture';

export function usePluginTranslation() {
  return useTranslation(NAMESPACE);
}

export function tval(text: string) {
  return `{{t("${text}", { ns: "${NAMESPACE}" })}}`;
}
