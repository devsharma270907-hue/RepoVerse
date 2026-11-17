import { describe, expect, it, vi } from 'vitest';
import { tokenStore, __resetTokenStore } from '@/auth/tokenStore';

describe('tokenStore', () => {
  it('holds the access token in memory only', () => {
    __resetTokenStore();
    expect(tokenStore.get()).toBeNull();
    tokenStore.set('abc');
    expect(tokenStore.get()).toBe('abc');
    tokenStore.clear();
    expect(tokenStore.get()).toBeNull();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('notifies subscribers and supports unsubscribe', () => {
    __resetTokenStore();
    const listener = vi.fn();
    const unsubscribe = tokenStore.subscribe(listener);

    tokenStore.set('one');
    tokenStore.set(null);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, 'one');
    expect(listener).toHaveBeenNthCalledWith(2, null);

    unsubscribe();
    tokenStore.set('two');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
