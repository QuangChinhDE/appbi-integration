/**
 * Credentials at runtime (SRS 12.5, ADR-006).
 *
 * n8n expects an `ICredentialsHelper` that reads from its own credentials
 * database. There is no such database here. This implementation serves the
 * payloads the product resolved for *this one execution*, from memory, and
 * forgets them when the run ends.
 *
 * Three things it deliberately cannot do:
 *
 * * fetch a credential the product did not send;
 * * write a credential back (`updateCredentials` is a no-op — an OAuth refresh
 *   that silently persisted into engine memory would be a credential the
 *   product does not know it has);
 * * log anything it holds.
 */

import { ICredentialsHelper } from 'n8n-workflow';
import type {
	ICredentialDataDecryptedObject,
	ICredentials,
	IHttpRequestOptions,
	INodeCredentialsDetails,
} from 'n8n-workflow';

export class RuntimeCredentialsHelper extends ICredentialsHelper {
	/** n8n generic auth type -> the payload the corresponding node expects. */
	constructor(private readonly table: Map<string, Record<string, unknown>>) {
		super();
	}

	getParentTypes(): string[] {
		// Credential type inheritance is a feature of n8n's credential registry,
		// which this engine does not have. Every type the compiler emits is
		// concrete.
		return [];
	}

	async getCredentials(
		_nodeCredentials: INodeCredentialsDetails,
		_type: string,
	): Promise<ICredentials> {
		// Only reached by code paths that want the encrypted wrapper object. The
		// execution path uses `getDecrypted`, so arriving here means something is
		// asking the engine to behave like n8n's credentials service.
		throw new Error('Encrypted credential objects are not available in this engine');
	}

	async getDecrypted(
		_additionalData: unknown,
		_nodeCredentials: INodeCredentialsDetails,
		type: string,
	): Promise<ICredentialDataDecryptedObject> {
		const found = this.table.get(type);
		if (!found) {
			// The message names the type, never the value, and never lists what is
			// available -- an error message is not a place to enumerate secrets.
			throw new Error(`No runtime credential supplied for type "${type}"`);
		}
		return found as ICredentialDataDecryptedObject;
	}

	async preAuthentication(): Promise<undefined> {
		// Pre-authentication is the hook OAuth-style credentials use to mint a
		// token before the request. V1 has no OAuth credential type
		// (compatibility.yaml marks OAUTH2 as BLOCKED), so there is nothing to do.
		return undefined;
	}

	async authenticate(
		_credentials: ICredentialDataDecryptedObject,
		_typeName: string,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		// The HTTP Request node applies generic auth itself from the payload
		// `getDecrypted` returned (basic auth, a header, a query parameter), so
		// there is nothing left to inject here. Kept explicit rather than
		// abstract: a future node that relies on `authenticate` should fail
		// visibly in a contract test rather than silently send no credential.
		return requestOptions;
	}

	async updateCredentials(): Promise<void> {
		/* The engine never writes a credential back. See the class docstring. */
	}
}
