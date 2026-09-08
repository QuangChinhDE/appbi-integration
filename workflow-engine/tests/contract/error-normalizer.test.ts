/**
 * How an engine failure becomes something a person can act on.
 *
 * The product shows the normalized `message` to whoever opens a failed run, so
 * these are user-facing sentences and not log lines. The one that prompted
 * this file: a DNS failure arrived as "Một bước trong workflow đã thất bại"
 * -- "a step in the workflow failed" -- which is true, useless, and was the
 * only thing on the error screen.
 *
 * The cause was that n8n wraps a transport error in `NodeApiError`, so the
 * errno is not reachable as `code` or `cause.code`; the only surviving
 * evidence is the text of the message. Classifying on errno alone therefore
 * matched nothing in practice while looking correct in the source.
 */

import { describe, expect, it } from 'vitest';

import { normalizeError, scrub } from '../../src/runtime/error-normalizer';

/** How n8n presents a transport failure from an HTTP Request node. */
function nodeApiError(message: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { name: 'NodeApiError' }, extra);
}

describe('network failures', () => {
  it('a DNS failure is classified, and names the host', () => {
    const result = normalizeError(
      nodeApiError('getaddrinfo ENOTFOUND api.acme.com'));

    expect(result.code).toBe('NODE_NETWORK_UNREACHABLE');
    expect(result.category).toBe('NETWORK');
    // The host is the actionable part: "cannot reach api.acme.com" is a
    // sentence somebody can do something about.
    expect(result.message).toContain('api.acme.com');
    expect(result.technical_message).toContain('ENOTFOUND');
  });

  it('a refused connection is classified', () => {
    const result = normalizeError(
      nodeApiError('connect ECONNREFUSED 10.0.0.5:443'));
    expect(result.code).toBe('NODE_NETWORK_UNREACHABLE');
    expect(result.message).toContain('10.0.0.5:443');
  });

  it('the errno is still used when it is reachable', () => {
    // The path that always worked: a bare transport error with `code` set.
    const result = normalizeError(
      Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
    expect(result.code).toBe('NODE_NETWORK_UNREACHABLE');
  });

  it('a network failure with no host still says something', () => {
    const result = normalizeError(
      Object.assign(new Error('read error'), { code: 'ECONNRESET' }));
    expect(result.code).toBe('NODE_NETWORK_UNREACHABLE');
    expect(result.message.length).toBeGreaterThan(10);
  });

  it('does not swallow a timeout, which is a different fault', () => {
    // A timeout means the host answered the connection and then did not
    // reply; unreachable means it never answered. They lead somewhere
    // different, so they must not collapse into one code.
    const result = normalizeError(nodeApiError('timeout of 5000ms exceeded'));
    expect(result.code).toBe('NODE_TIMEOUT');
  });

  it('does not classify an ordinary message that mentions a host', () => {
    // The message match must be specific enough not to fire on prose.
    const result = normalizeError(
      nodeApiError('The response from api.acme.com was not valid JSON'));
    expect(result.code).not.toBe('NODE_NETWORK_UNREACHABLE');
  });
});

describe('the technical message', () => {
  it('never carries a credential', () => {
    // Everything here reaches the product, and the product shows it behind
    // "technical details" -- which people copy into support tickets.
    const result = normalizeError(nodeApiError(
      'Request failed with Authorization: Bearer sk-live-abcdef0123456789'));
    expect(result.technical_message).not.toContain('sk-live-abcdef0123456789');
    expect(result.technical_message).toContain('***');
  });

  it('never carries an api key from a query string', () => {
    expect(scrub('GET https://api.acme.com/v1?api_key=super-secret-value'))
      .not.toContain('super-secret-value');
  });

  it('is bounded, because an engine stack trace is not', () => {
    const result = normalizeError(nodeApiError('x'.repeat(50_000)));
    expect(result.technical_message?.length ?? 0).toBeLessThan(5_000);
  });
});

describe('the fallback', () => {
  it('an unrecognised failure still produces a usable envelope', () => {
    const result = normalizeError(new Error('something entirely new'));
    expect(result.code).toBeTruthy();
    expect(result.category).toBeTruthy();
    expect(result.message).toBeTruthy();
    // The original text survives for support even when the class does not.
    expect(result.technical_message).toContain('something entirely new');
  });

  it('a thrown non-error does not crash the normalizer', () => {
    // n8n nodes throw strings and objects. Losing the run's outcome because
    // the error was the wrong shape would be worse than the original failure.
    for (const thrown of ['a string', { message: 'an object' }, null, 42]) {
      const result = normalizeError(thrown);
      expect(result.code).toBeTruthy();
      expect(result.message).toBeTruthy();
    }
  });
});
