/**
 * Registering n8n's BinaryDataService (SRS 26.5, ADR-012).
 *
 * `WorkflowExecute` looks this service up through n8n's DI container even for a
 * plain JSON response: HTTP Request calls `helpers.binaryToBuffer` on every
 * body it reads. Without a registered instance the container throws, and the
 * first symptom is a JSON API call failing with a TypeError from inside typedi
 * — which is exactly the kind of "the runtime needs more of the application
 * than expected" that Phase A exists to find (SRS 26.5).
 *
 * It is registered in `default` mode: binary payloads stay in memory and
 * nothing is written to disk. V1 does not support binary data, and giving the
 * service a filesystem path would quietly create a store nobody cleans up.
 */

import Container from 'typedi';
// Deep import, not `from 'n8n-core'`. The package's entry point statically
// requires `ObjectStore/ObjectStore.service.ee` -- Enterprise-licensed source
// -- so importing anything from the root loads it into the process, whatever
// binary-data mode we register. `BinaryData.service` on its own does not:
// there the EE module sits behind `if (availableModes.includes('s3'))`, and we
// pass `['default']`. Verified by a contract test that runs a real execution
// and asserts nothing matching `.ee.` is in `require.cache`.
import { BinaryDataService } from 'n8n-core/dist/BinaryData/BinaryData.service';

import { log } from '../logger';

let registered = false;

export async function registerBinaryDataService(): Promise<void> {
	if (registered) return;

	const service = new BinaryDataService();
	await service.init({
		mode: 'default',
		availableModes: ['default'],
		// Unused in `default` mode. Set to a path that does not exist rather than
		// a temp directory, so a future change that starts writing files fails
		// loudly instead of filling somebody's disk.
		localStoragePath: '',
	});
	Container.set(BinaryDataService, service);
	registered = true;
	log.info('binary_data.registered', { mode: 'default' });
}
