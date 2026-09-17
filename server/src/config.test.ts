import { describe, expect, it } from 'vitest';

import { loadConfig, ConfigError } from './config.js';

describe('loadConfig', () => {
  it('empty env throws ConfigError', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  it('DEV_MODE=1 makes hardened false, does not throw', () => {
    const config = loadConfig({ DEV_MODE: '1' });
    expect(config.hardened).toBe(false);
  });

  it('AUTH_USER and AUTH_PASSWORD round-trip when hardened', () => {
    const config = loadConfig({
      AUTH_USER: 'testuser',
      AUTH_PASSWORD: 'testpass',
    });
    expect(config.hardened).toBe(true);
    expect(config.authUser).toBe('testuser');
    expect(config.authPassword).toBe('testpass');
  });

  it('AUTH_USER without AUTH_PASSWORD throws', () => {
    expect(() => loadConfig({ AUTH_USER: 'testuser' })).toThrow(ConfigError);
  });

  it('AUTH_PASSWORD without AUTH_USER throws', () => {
    expect(() => loadConfig({ AUTH_PASSWORD: 'testpass' })).toThrow(ConfigError);
  });

  it('bodyLimit defaults to 2mb and can be overridden', () => {
    const defaultConfig = loadConfig({ DEV_MODE: '1' });
    expect(defaultConfig.bodyLimit).toBe('2mb');

    const customConfig = loadConfig({ DEV_MODE: '1', BODY_LIMIT: '5mb' });
    expect(customConfig.bodyLimit).toBe('5mb');
  });

  it('port defaults to 3000 and can be overridden', () => {
    const defaultConfig = loadConfig({ DEV_MODE: '1' });
    expect(defaultConfig.port).toBe(3000);

    const customConfig = loadConfig({ DEV_MODE: '1', PORT: '8080' });
    expect(customConfig.port).toBe(8080);
  });

  it('DEV_MODE=1 with no credentials does not throw, authUser is empty', () => {
    const config = loadConfig({ DEV_MODE: '1' });
    expect(config.authUser).toBe('');
    expect(config.authPassword).toBe('');
  });

  it('allowEmptyStore defaults to false', () => {
    const config = loadConfig({ DEV_MODE: '1' });
    expect(config.allowEmptyStore).toBe(false);
  });

  it('allowEmptyStore is true when ALLOW_EMPTY_STORE=1', () => {
    const config = loadConfig({
      DEV_MODE: '1',
      ALLOW_EMPTY_STORE: '1',
    });
    expect(config.allowEmptyStore).toBe(true);
  });

  it('allowEmptyStore is unaffected by DEV_MODE', () => {
    const devConfig = loadConfig({ DEV_MODE: '1', ALLOW_EMPTY_STORE: '1' });
    expect(devConfig.allowEmptyStore).toBe(true);

    const hardenedConfig = loadConfig({
      AUTH_USER: 'testuser',
      AUTH_PASSWORD: 'testpass',
      ALLOW_EMPTY_STORE: '1',
    });
    expect(hardenedConfig.allowEmptyStore).toBe(true);
  });
});
