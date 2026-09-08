import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(cleanup);

// jsdom has no ResizeObserver, and @xyflow/react measures its container with
// one. Stubbed rather than mocked away: the canvas component under test should
// mount for real, and it is the measurement that jsdom cannot do.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

// The same for DOMMatrix, which @xyflow/react uses for its transforms.
vi.stubGlobal('DOMMatrixReadOnly', class {
  m22 = 1;
  constructor(_transform?: string) {}
});

if (!('clipboard' in navigator)) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
}
