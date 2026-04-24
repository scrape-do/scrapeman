export { applyAuth, needsTokenAcquisition } from './apply.js';
export type { ApplyAuthOptions } from './apply.js';
export {
  OAuth2Client,
  generatePkce,
  runAuthCodeFlow,
  decodeJwt,
  fetchOidcDiscovery,
} from './oauth2.js';
export type {
  OAuth2ClientCredentialsConfig,
  OAuth2AuthCodeConfig,
  OidcDiscoveryDocument,
  PkceParams,
  TokenResponse,
} from './oauth2.js';
export { signAwsSigV4 } from './sigv4.js';
export type { SigV4Credentials } from './sigv4.js';
