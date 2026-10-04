// Authorization server metadata (RFC 8414), served at
// /.well-known/oauth-authorization-server. Not OpenID Connect discovery:
// identity issues no id_token, so it publishes no openid-configuration.
import { SCOPES } from '../schema';

export function authorizationServerMetadata(issuer: string) {
	return {
		issuer,
		authorization_endpoint: `${issuer}/oauth/authorize`,
		token_endpoint: `${issuer}/oauth/token`,
		userinfo_endpoint: `${issuer}/oauth/userinfo`,
		revocation_endpoint: `${issuer}/oauth/revoke`,
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code', 'client_credentials'],
		token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
		revocation_endpoint_auth_methods_supported: ['none'],
		scopes_supported: SCOPES,
		service_documentation: `${issuer}/docs`
	};
}
