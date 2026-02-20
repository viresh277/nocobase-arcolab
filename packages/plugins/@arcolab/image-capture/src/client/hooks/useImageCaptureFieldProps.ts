import { useAPIClient, useCurrentUserContext } from '@nocobase/client';

interface UserInfo {
  id?: number;
  nickname?: string;
  username?: string;
}

export function useImageCaptureFieldProps() {
  const apiClient = useAPIClient();
  const ctx = useCurrentUserContext();

  // ctx.data?.data is the authenticated user record from NocoBase's auth context.
  // useCurrentUserContext returns ahooks Result<any>, so we narrow at the boundary.
  const raw: unknown = ctx?.data?.data;
  const currentUser: UserInfo | undefined =
    raw && typeof raw === 'object' ? (raw as UserInfo) : undefined;

  return { apiClient, currentUser };
}
