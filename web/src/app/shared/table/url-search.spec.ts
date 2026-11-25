import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { convertToParamMap, type ParamMap } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UrlSearch } from './url-search';

const params = signal<ParamMap>(convertToParamMap({}));
const applied: (string | null)[] = [];

@Component({ selector: 'app-host', template: '' })
class Host {
  readonly search = new UrlSearch(params, (q) => applied.push(q), 300);
}

describe('UrlSearch', () => {
  afterEach(() => {
    vi.useRealTimers();
    applied.length = 0;
    params.set(convertToParamMap({}));
  });

  it('applies typed text after a pause and follows the URL when it changes (Back/Forward)', () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(Host);
    const search = fixture.componentInstance.search;
    search.input('ring');
    expect(applied).toEqual([]);
    vi.advanceTimersByTime(300);
    expect(applied).toEqual(['ring']);
    params.set(convertToParamMap({ q: 'ring' }));
    TestBed.tick();
    // Back: the URL goes to an earlier search; the box follows it.
    params.set(convertToParamMap({ q: 'gold' }));
    TestBed.tick();
    expect(search.text()).toBe('gold');
    params.set(convertToParamMap({}));
    TestBed.tick();
    expect(search.text()).toBe('');
  });

  it('never applies a pending search after the page is left', () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.search.input('gold');
    fixture.destroy(); // the person opened a product within the pause
    vi.advanceTimersByTime(1000);
    expect(applied).toEqual([]);
  });

  it('does not overwrite text the person is still typing', () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(Host);
    const search = fixture.componentInstance.search;
    search.input('rin');
    params.set(convertToParamMap({ q: 'other' }));
    TestBed.tick();
    expect(search.text()).toBe('rin');
  });
});
