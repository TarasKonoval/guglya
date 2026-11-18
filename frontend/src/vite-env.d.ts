/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_AWS_REGION: string;
  readonly VITE_COGNITO_USER_POOL_ID: string;
  readonly VITE_COGNITO_CLIENT_ID: string;
  readonly VITE_API_URL: string;
  readonly VITE_COGNITO_DOMAIN?: string;
  readonly VITE_GOOGLE_ENABLED?: string;
  readonly VITE_DONATE_URL?: string;
  readonly VITE_ASSET_BASE_URL?: string;
  readonly VITE_AGENT_URL?: string;
}
