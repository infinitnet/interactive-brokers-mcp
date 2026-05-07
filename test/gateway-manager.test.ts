// test/gateway-manager.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import { IBGatewayManager } from '../src/gateway-manager.js';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof fs>('fs');
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
  };
});

describe('IBGatewayManager.isMuslLibc', () => {
  const originalPlatform = process.platform;
  const originalReport = (process as unknown as { report?: unknown }).report;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    Object.defineProperty(process, 'report', { configurable: true, value: originalReport });
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
      // Default: nothing exists unless a test opts in.
      return false;
    });
  });

  it('returns false on non-Linux platforms without consulting libc', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    vi.mocked(fs.existsSync).mockReturnValue(true); // would lie if consulted
    expect(IBGatewayManager.isMuslLibc()).toBe(false);
  });

  it('returns false on Linux when process.report exposes a glibc runtime version', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    Object.defineProperty(process, 'report', { configurable: true, value: {
      getReport: () => ({ header: { glibcVersionRuntime: '2.36' } }),
    } });
    expect(IBGatewayManager.isMuslLibc()).toBe(false);
  });

  it('returns true on Linux when glibcVersionRuntime is missing and the musl loader is on disk', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    Object.defineProperty(process, 'report', { configurable: true, value: {
      getReport: () => ({ header: {} }),
    } });
    vi.mocked(fs.existsSync).mockImplementation(
      (p: fs.PathLike) => p === '/lib/ld-musl-x86_64.so.1',
    );
    expect(IBGatewayManager.isMuslLibc()).toBe(true);
  });

  it('returns true when only the aarch64 musl loader is present', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    Object.defineProperty(process, 'report', { configurable: true, value: {
      getReport: () => ({ header: {} }),
    } });
    vi.mocked(fs.existsSync).mockImplementation(
      (p: fs.PathLike) => p === '/lib/ld-musl-aarch64.so.1',
    );
    expect(IBGatewayManager.isMuslLibc()).toBe(true);
  });

  it('returns false when neither glibc nor a musl loader is detectable', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    Object.defineProperty(process, 'report', { configurable: true, value: {
      getReport: () => ({ header: {} }),
    } });
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(IBGatewayManager.isMuslLibc()).toBe(false);
  });

  it('falls back to the filesystem check if process.report.getReport throws', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    Object.defineProperty(process, 'report', { configurable: true, value: {
      getReport: () => {
        throw new Error('not available');
      },
    } });
    vi.mocked(fs.existsSync).mockImplementation(
      (p: fs.PathLike) => p === '/lib/ld-musl-x86_64.so.1',
    );
    expect(IBGatewayManager.isMuslLibc()).toBe(true);
  });
});
