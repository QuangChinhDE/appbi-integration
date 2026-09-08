/**
 * The engine's internal HTTP surface (SRS 26.1, guardrail 15).
 *
 * Internal-only, in three senses: it binds to loopback by default, it requires
 * a shared token on every route, and it has no route a browser would ever call.
 * The product's API and worker are its only clients.
 *
 * Routes are deliberately few. Everything a client can ask is: are you well,
 * what can you do, does this graph compile, run it, how is it going, stop it.
 */

import express from 'express';
import type { NextFunction, Request, Response } from 'express';

import { compile } from './compiler/compiler';
import { config } from './config';
import {
	CONTRACT_VERSION,
	COMPILER_VERSION,
	type CapabilitiesDto,
	type ExecutionRequest,
	type HealthDto,
	type ValidationResponse,
} from './contracts/engine-dto';
import { initN8nLogger, log } from './logger';
import { MAPPERS } from './compiler/node-mappers';
import { nodeTypes } from './nodes/registry-loader';
import { registerBinaryDataService } from './runtime/binary-data';
import { installEgressGuard } from './runtime/egress-guard';
import {
	activeCount,
	cancelExecution,
	CompileFailedError,
	EngineBusyError,
	findByIdempotencyKey,
	startExecution,
	statusOf,
} from './runtime/execution-manager';

function envelope(
	code: string,
	message: string,
	category: string,
	technical?: string,
): { error: { code: string; message: string; category: string; technical_message?: string } } {
	return {
		error: { code, message, category, ...(technical ? { technical_message: technical } : {}) },
	};
}

export function createApp() {
	const app = express();

	// A large webhook body has already been capped by the product's gateway; the
	// engine's own limit exists so a misbehaving internal client cannot exhaust
	// memory here either.
	app.use(express.json({ limit: '4mb' }));

	app.use((request: Request, response: Response, next: NextFunction) => {
		const token = request.header('X-Engine-Token');
		if (token !== config.token) {
			// No detail, and no timing difference worth measuring: an unauthorised
			// caller learns only that it was refused.
			log.warn('auth.rejected', { path: request.path });
			response
				.status(401)
				.json(envelope('ENGINE_UNAUTHORIZED', 'Unauthorized', 'AUTHENTICATION'));
			return;
		}
		next();
	});

	// ── health ───────────────────────────────────────────────────────────────
	app.get('/internal/healthz', (_request, response) => {
		const types = nodeTypes();
		const body: HealthDto = {
			// DEGRADED rather than OFFLINE when a node failed to load: the engine
			// can still run graphs that do not use it, and the product's health
			// banner should say so instead of stopping every run.
			status: types.complete ? 'HEALTHY' : 'DEGRADED',
			contract_version: CONTRACT_VERSION,
			compiler_version: COMPILER_VERSION,
			engine_version: config.engineVersion,
			loaded_nodes: types.loadedTypes,
			active_executions: activeCount(),
			...(types.complete
				? {}
				: {
					message: `Missing node types: ${types.expectedTypes
						.filter((type) => !types.loadedTypes.includes(type))
						.join(', ')}`,
				}),
		};
		response.json(body);
	});

	app.get('/internal/readyz', (_request, response) => {
		const types = nodeTypes();
		if (!types.complete) {
			response.status(503).json(
				envelope(
					'ENGINE_INCOMPLETE',
					'Not every allowlisted node loaded',
					'ENGINE',
					types.expectedTypes.filter((t) => !types.loadedTypes.includes(t)).join(','),
				),
			);
			return;
		}
		response.json({ status: 'ready', active_executions: activeCount() });
	});

	app.get('/internal/capabilities', (_request, response) => {
		const body: CapabilitiesDto = {
			contract_version: CONTRACT_VERSION,
			compiler_version: COMPILER_VERSION,
			engine_version: config.engineVersion,
			// The product node keys this engine can compile. Drift between this
			// and the product's registry is what the compatibility screen shows.
			supported_node_keys: Object.keys(MAPPERS).sort(),
			features: {
				// Every one of these is a documented "no" for V1, reported rather
				// than implied so an operator can see it (compatibility.yaml).
				wait_resume: false,
				code_node: false,
				community_nodes: false,
				sub_workflows: false,
				binary_data: false,
				cancellation: true,
				expressions: true,
			},
		};
		response.json(body);
	});

	// ── validate: compile dry-run, no execution ──────────────────────────────
	app.post('/internal/validate', (request, response) => {
		const payload = request.body as ExecutionRequest;
		// Identity and type are kept, values are dropped. Dropping the whole
		// list -- which this did at first -- leaves every credential reference
		// unresolvable, so the compiler reports CREDENTIAL_REQUIRED and no
		// workflow that authenticates to anything can ever be published. Doing
		// it here rather than trusting the caller means a dry run cannot leak a
		// secret even if the product sends one.
		const result = compile({
			...payload,
			credentials: (payload.credentials ?? []).map((credential) => ({
				credential_id: credential.credential_id,
				credential_type: credential.credential_type,
				data: {},
			})),
		});
		const body: ValidationResponse = {
			ok: result.ok,
			diagnostics: result.diagnostics,
			compiled_hash: result.compiledHash,
			compiler_version: COMPILER_VERSION,
		};
		response.json(body);
	});

	// ── executions ───────────────────────────────────────────────────────────
	app.post('/internal/executions', (request, response) => {
		const payload = request.body as ExecutionRequest;
		if (!payload?.execution_id || !payload?.graph) {
			response
				.status(400)
				.json(envelope('ENGINE_BAD_REQUEST', 'execution_id and graph are required', 'VALIDATION'));
			return;
		}

		try {
			const started = startExecution(payload);
			response.status(202).json(started);
		} catch (error) {
			if (error instanceof EngineBusyError) {
				// 503 with a retryable code: the product's worker leaves the
				// execution QUEUED and tries again rather than failing the run.
				response
					.status(503)
					.json(envelope('ENGINE_UNAVAILABLE', 'Engine đang quá tải.', 'ENGINE', error.message));
				return;
			}
			if (error instanceof CompileFailedError) {
				response.status(422).json({
					...envelope('WORKFLOW_INVALID', 'Workflow không biên dịch được.', 'VALIDATION'),
					diagnostics: error.diagnostics,
				});
				return;
			}
			log.error('execution.dispatch_failed', {
				execution_id: payload.execution_id,
				error: error instanceof Error ? error.message : String(error),
			});
			response
				.status(500)
				.json(
					envelope(
						'ENGINE_OPERATION_FAILED',
						'Engine không khởi chạy được workflow.',
						'ENGINE',
						error instanceof Error ? error.message : String(error),
					),
				);
		}
	});

	app.get('/internal/executions/:ref', (request, response) => {
		const status = statusOf(request.params.ref);
		if (!status) {
			// 404 means "this engine has no such run", which the product reads as
			// a lost execution and reconciles to ENGINE_INTERRUPTED. Distinct from
			// an unreachable engine, which is a transport failure.
			response
				.status(404)
				.json(envelope('ENGINE_EXECUTION_UNKNOWN', 'Unknown execution ref', 'ENGINE'));
			return;
		}
		response.json(status);
	});

	app.post('/internal/executions/:ref/cancel', (request, response) => {
		const status = cancelExecution(request.params.ref);
		if (!status) {
			response
				.status(404)
				.json(envelope('ENGINE_EXECUTION_UNKNOWN', 'Unknown execution ref', 'ENGINE'));
			return;
		}
		response.json(status);
	});

	app.get('/internal/idempotency/:key', (request, response) => {
		const ref = findByIdempotencyKey(request.params.key);
		response.json({ ref });
	});

	app.use((_request, response) => {
		response.status(404).json(envelope('ENGINE_NOT_FOUND', 'No such route', 'NOT_FOUND'));
	});

	return app;
}

export async function bootstrap() {
	initN8nLogger();
	installEgressGuard({
		allow_private_networks: process.env.EGRESS_ALLOW_PRIVATE_NETWORKS === 'true',
	});
	// Before any execution: n8n reaches for this service on every HTTP response
	// body, binary or not.
	await registerBinaryDataService();
	// Load the node registry at boot, not on the first request: a node that
	// cannot load should show up in /healthz before any user presses Run.
	nodeTypes();
	return createApp();
}

if (require.main === module) {
	bootstrap()
		.then((app) => {
			app.listen(config.port, config.host, () => {
				log.info('engine.listening', {
					host: config.host,
					port: config.port,
					engine_version: config.engineVersion,
					contract_version: CONTRACT_VERSION,
				});
			});
		})
		.catch((error) => {
			// A bootstrap failure must not leave a process listening and answering
			// health checks it cannot honour.
			log.error('engine.bootstrap_failed', {
				error: error instanceof Error ? error.message : String(error),
			});
			process.exit(1);
		});
}
